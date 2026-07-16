//! Tokens into a tree.

use std::rc::Rc;

use crate::diagnostic::{err, DResult, Diagnostic, DiagnosticCode, Span};
use crate::scanner::{decode_minimal, finalize_name};
use crate::syntax::{
    CallArgument, Declaration, Document, Leaflink, ListItem, MapItem, Resource, ResourceKind,
    ValueNode,
};
use crate::text::is_bare_name;
use crate::token::{Literal, Token, TokenType};

/// Where an unquoted value ends. It runs to a separator or to the delimiter of whatever encloses it,
/// so the enclosing group is what decides.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stops {
    Declaration,
    Map,
    List,
    Call,
}

impl Stops {
    fn holds(self, ty: TokenType) -> bool {
        if matches!(ty, TokenType::Newline | TokenType::Comma) {
            return true;
        }

        match self {
            Stops::Declaration => ty == TokenType::Eof,
            Stops::Map => ty == TokenType::RightCurly,
            Stops::List => ty == TokenType::RightSquare,
            Stops::Call => ty == TokenType::RightParen,
        }
    }
}

/// How deeply a document may nest before the parser refuses to follow it.
///
/// Both the parser and the evaluator recurse on the nesting, and a host that dies on hostile input is
/// not a library. The refusal must be a diagnostic, carrying a code and a position — a caller can act
/// on a `DEON_PARSE_EXPECTED`, and can do nothing at all with a stack overflow.
///
/// The number is what a *2 MiB* stack will bear, which is what a spawned thread gets by default and
/// so the least a caller is likely to have. A debug build overflowed such a stack somewhere past 400
/// frames, which left 512 — the first choice here — with no margin at all and made the guard a
/// decoration. 128 has a wide margin, and is far past any nesting a person would write; it is also
/// what `serde_json` limits itself to, for exactly this reason.
///
/// The `JavaScript` implementation keeps the same number, so that a document is either read by both
/// or refused by both.
pub(crate) const MAX_DEPTH: usize = 128;

pub struct Parser {
    tokens: Vec<Token>,
    source_name: Rc<str>,
    current: usize,
    depth: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>, source_name: &str) -> Self {
        Self {
            tokens,
            source_name: Rc::from(source_name),
            current: 0,
            depth: 0,
        }
    }

    /// A document is any number of declarations around exactly one root. They may be written in any
    /// order, so the root is not known to be missing until the end.
    pub fn parse(mut self) -> DResult<Document> {
        let mut declarations: Vec<Declaration> = Vec::new();
        let mut root: Option<ValueNode> = None;

        self.skip_separators();

        while !self.check(TokenType::Eof) {
            if self.check(TokenType::Import) || self.check(TokenType::Inject) {
                let resource = self.resource()?;
                declarations.push(resource);
            } else if self.check(TokenType::LeftCurly) || self.check(TokenType::LeftSquare) {
                if root.is_some() {
                    return self.fail(
                        DiagnosticCode::ParseRoot,
                        "A document may contain only one root map or list.",
                    );
                }

                root = Some(if self.check(TokenType::LeftCurly) {
                    self.map()?
                } else {
                    self.list()?
                });
            } else {
                let leaflink = self.leaflink()?;
                declarations.push(leaflink);
            }

            self.skip_separators();
        }

        let Some(root) = root else {
            return self.fail(
                DiagnosticCode::ParseRoot,
                "A document requires one root map or list.",
            );
        };

        Ok(Document {
            declarations,
            root,
            source: self.source_name,
        })
    }

    fn resource(&mut self) -> DResult<Declaration> {
        let keyword = self.advance();
        let name = self.name("Expected a resource declaration name.")?;

        self.consume(TokenType::From, "Expected 'from' in resource declaration.")?;

        let target = self.atom("Expected a resource target.")?;

        let authenticator = if self.matches(TokenType::With) {
            Some(self.value(Stops::Declaration)?)
        } else {
            None
        };

        Ok(Declaration::Resource(Resource {
            kind: if keyword.ty == TokenType::Import {
                ResourceKind::Import
            } else {
                ResourceKind::Inject
            },
            name: name.value().to_string(),
            target: target.value().to_string(),
            authenticator,
            span: keyword.span,
        }))
    }

    fn leaflink(&mut self) -> DResult<Declaration> {
        let name = self.name("Expected a leaflink declaration name.")?;

        // A top-level declaration is `name, required-space, value` (specification 4, deon.ebnf): a
        // space or tab separates the name from its value, and a value follows. The trivia before the
        // next token is what stands between the two — a value abutting the name, or a comment or
        // newline where the space was due, is `DEON_PARSE_EXPECTED`, and so is a name with no value.
        // Only a map entry may hold a bare name; a declaration may not.
        let separated = self.peek().leading.starts_with(|c: char| matches!(c, ' ' | '\t'));
        if !separated {
            return self.fail(DiagnosticCode::ParseExpected, "A space was expected here.");
        }
        if self.peek().ty.is_boundary() || self.check(TokenType::Eof) {
            return self.fail(DiagnosticCode::ParseExpected, "A value was expected here.");
        }

        let value = self.value(Stops::Declaration)?;

        Ok(Declaration::Leaflink(Leaflink {
            name: name.value().to_string(),
            value,
            span: name.span,
        }))
    }

    fn map(&mut self) -> DResult<ValueNode> {
        let open = self
            .consume(TokenType::LeftCurly, "Expected '{'.")?
            .span
            .clone();

        let mut entries: Vec<MapItem> = Vec::new();

        // Newlines and blank lines lead into the first entry, but a comma does not: a comma falls
        // between two items, so one before the first has no item before it and is an error at the
        // comma, which the entry parser raises when it meets it (specification 4.1).
        self.skip_newlines();

        while !self.check(TokenType::RightCurly) && !self.check(TokenType::Eof) {
            if self.matches(TokenType::Spread) {
                let token = self.previous();

                entries.push(MapItem::Spread {
                    reference: token.reference(),
                    span: token.span.clone(),
                });
            } else if self.matches(TokenType::Link) {
                // The shortened form: the link names the key it is received under.
                let token = self.previous();
                let span = token.span.clone();

                let link = ValueNode::Link {
                    reference: token.reference(),
                    span: span.clone(),
                };

                let value = if self.check(TokenType::LeftParen) {
                    self.call(link)?
                } else {
                    link
                };

                entries.push(MapItem::Link { value, span });
            } else {
                let name = self.name("Expected a map key.")?;

                let value = if self.check(TokenType::LeftAngle) {
                    self.structure()?
                } else if self.peek().ty.is_boundary() || self.check(TokenType::RightCurly) {
                    ValueNode::scalar("", name.span.clone())
                } else {
                    self.value(Stops::Map)?
                };

                entries.push(MapItem::Entry {
                    name: name.value().to_string(),
                    value,
                    span: name.span,
                });
            }

            if !self.check(TokenType::RightCurly) {
                self.require_boundary("map entry")?;
            }

            self.skip_separators();
        }

        self.consume(TokenType::RightCurly, "Expected '}' after map.")?;

        Ok(ValueNode::Map { entries, span: open })
    }

    fn list(&mut self) -> DResult<ValueNode> {
        let open = self
            .consume(TokenType::LeftSquare, "Expected '['.")?
            .span
            .clone();

        let mut items: Vec<ListItem> = Vec::new();

        // A leading comma has no item before it, so it is an error rather than trivia to skip past
        // (specification 4.1); only newlines lead into the first item.
        self.skip_newlines();

        while !self.check(TokenType::RightSquare) && !self.check(TokenType::Eof) {
            if self.matches(TokenType::Spread) {
                let token = self.previous();

                items.push(ListItem::Spread {
                    reference: token.reference(),
                    span: token.span.clone(),
                });
            } else {
                let value = self.value(Stops::List)?;
                items.push(ListItem::Value(value));
            }

            if !self.check(TokenType::RightSquare) {
                self.require_boundary("list item")?;
            }

            self.skip_separators();
        }

        self.consume(TokenType::RightSquare, "Expected ']' after list.")?;

        Ok(ValueNode::List { items, span: open })
    }

    /// A structure is a signature and the rows under it. A row ends at a newline, so a cell may hold
    /// anything that does not itself cross one.
    fn structure(&mut self) -> DResult<ValueNode> {
        let open = self
            .consume(TokenType::LeftAngle, "Expected '<'.")?
            .span
            .clone();

        let mut fields: Vec<String> = Vec::new();

        self.skip_newlines();

        while !self.check(TokenType::RightAngle) && !self.check(TokenType::Eof) {
            let field = self.name("Expected a structure field.")?;
            fields.push(field.value().to_string());

            self.skip_newlines();

            if !self.matches(TokenType::Comma) {
                break;
            }

            self.skip_newlines();
        }

        self.consume(
            TokenType::RightAngle,
            "Expected '>' after structure signature.",
        )?;

        self.skip_newlines();

        self.consume(
            TokenType::LeftSquare,
            "Expected '[' after structure signature.",
        )?;

        let mut rows: Vec<Vec<ValueNode>> = Vec::new();

        self.skip_newlines();

        while !self.check(TokenType::RightSquare) && !self.check(TokenType::Eof) {
            let mut row: Vec<ValueNode> = vec![self.value(Stops::List)?];

            while self.matches(TokenType::Comma) {
                // A comma separates cells within a logical row, and a row ends at a newline (§8). So a
                // comma followed by a newline, the closing ']', or the end is a trailing comma that
                // contributes no cell — it must not cross the newline and draw the next row's cells
                // into this one. Only inline trivia (already dropped by the scanner) may sit between a
                // cell-separating comma and the next cell.
                if self.check(TokenType::Newline)
                    || self.check(TokenType::RightSquare)
                    || self.check(TokenType::Eof)
                {
                    break;
                }

                row.push(self.value(Stops::List)?);
            }

            rows.push(row);

            if !self.check(TokenType::RightSquare) && !self.check(TokenType::Newline) {
                return self.fail(
                    DiagnosticCode::ParseExpected,
                    "Expected a newline after a structure row.",
                );
            }

            self.skip_newlines();
        }

        self.consume(TokenType::RightSquare, "Expected ']' after structure rows.")?;

        Ok(ValueNode::Structure {
            fields,
            rows,
            span: open,
        })
    }

    fn value(&mut self, stops: Stops) -> DResult<ValueNode> {
        self.depth += 1;

        if self.depth > MAX_DEPTH {
            self.depth -= 1;

            return self.fail(
                DiagnosticCode::ParseExpected,
                "The document nests more deeply than the parser will follow.",
            );
        }

        let result = self.value_inner(stops);
        self.depth -= 1;

        result
    }

    fn value_inner(&mut self, stops: Stops) -> DResult<ValueNode> {
        if self.check(TokenType::LeftCurly) {
            return self.map();
        }

        if self.check(TokenType::LeftSquare) {
            return self.list();
        }

        if self.check(TokenType::LeftAngle) {
            return self.structure();
        }

        if self.matches(TokenType::Link) {
            let token = self.previous();

            let link = ValueNode::Link {
                reference: token.reference(),
                span: token.span.clone(),
            };

            return if self.check(TokenType::LeftParen) {
                self.call(link)
            } else {
                Ok(link)
            };
        }

        self.scalar(stops)
    }

    fn call(&mut self, link: ValueNode) -> DResult<ValueNode> {
        let ValueNode::Link { reference, .. } = link else {
            unreachable!("a call is only ever built from a link");
        };

        let open = self
            .consume(TokenType::LeftParen, "Expected '('.")?
            .span
            .clone();

        let mut arguments: Vec<CallArgument> = Vec::new();

        // As with a map or a list, a comma before the first argument has no item before it and is an
        // error, not trivia (specification 4.1).
        self.skip_newlines();

        while !self.check(TokenType::RightParen) && !self.check(TokenType::Eof) {
            let name = self.name("Expected an entity argument name.")?;

            let value = if self.peek().ty.is_boundary() || self.check(TokenType::RightParen) {
                ValueNode::scalar("", name.span.clone())
            } else {
                self.value(Stops::Call)?
            };

            arguments.push(CallArgument {
                name: name.value().to_string(),
                value,
                span: name.span,
            });

            if !self.check(TokenType::RightParen) {
                self.require_boundary("entity argument")?;
            }

            self.skip_separators();
        }

        self.consume(
            TokenType::RightParen,
            "Expected ')' after entity arguments.",
        )?;

        Ok(ValueNode::Call {
            reference,
            arguments,
            span: open,
        })
    }

    /// An unquoted value is made of every token up to its boundary, put back together with the
    /// whitespace that separated them, so that `two words` stays two words.
    fn scalar(&mut self, stops: Stops) -> DResult<ValueNode> {
        // A value that begins with a quote is a quoted string. One whose opening quote never closed is
        // an unterminated string — but it is an error precisely because the quote is the value's first
        // character. The scanner cannot know that, so it deferred the judgment to here (4.3).
        if self.check(TokenType::Unterminated) {
            return self.fail(DiagnosticCode::LexUnterminated, "Unterminated string.");
        }

        // A string is quoted only when the value begins with the quote. Anywhere else the quote is
        // an ordinary character of an unquoted string, which runs to the boundary (4.3).
        if self.check(TokenType::String) {
            let quoted = self.advance();

            return Ok(ValueNode::scalar(quoted.value(), quoted.span.clone()));
        }

        let mut fragments = String::new();
        let mut span: Option<Span> = None;

        while !self.check(TokenType::Eof)
            && !stops.holds(self.peek().ty)
            && self.peek().ty.is_value()
        {
            let token = self.advance();

            // `leading` is the whitespace read before the token, and the first token of a value has
            // none of its own: what came before it separated it from the key.
            if span.is_some() {
                fragments.push_str(&token.leading);
            }

            fragments.push_str(&token.lexeme);

            if span.is_none() {
                span = Some(token.span.clone());
            }
        }

        let Some(span) = span else {
            return self.fail(DiagnosticCode::ParseExpected, "Expected a value.");
        };

        Ok(ValueNode::scalar(decode_minimal(&fragments, None), span))
    }

    /// A name is a bare word or a singlequoted string. A backticked string may span lines, which a
    /// name may not.
    fn name(&mut self, message: &str) -> DResult<Token> {
        // A name may be a singlequoted string; one whose quote never closed is an unterminated string,
        // which the scanner left for the parser to place (4.3).
        if self.check(TokenType::Unterminated) {
            return self.fail(DiagnosticCode::LexUnterminated, "Unterminated string.");
        }

        if !self.peek().ty.is_value() || self.check(TokenType::Interpolate) {
            return self.fail(DiagnosticCode::ParseExpected, message);
        }

        let mut token = self.advance();

        let singlequoted = token.ty == TokenType::String && token.lexeme.starts_with('\'');
        let bare = token.ty != TokenType::String && is_bare_name(token.value());

        if singlequoted || bare {
            // A name is never interpolated (§4.4), so the escaped-interpolation sentinel that a `\#{`
            // decodes to — which only the interpolation pass, run over a value, turns back into `#{`
            // — is resolved here, or it would surface inside a key. A bare name holds no backslash and
            // so carries none; the finalize is a no-op there.
            token.literal = Literal::String(finalize_name(token.value()));
            return Ok(token);
        }

        err(
            DiagnosticCode::LexInvalid,
            format!("Invalid unquoted name '{}'.", token.value()),
            &token.span,
        )
    }

    /// A resource target is one token, and it may not be a backticked string, whose trimming would
    /// make the target something other than what was written.
    fn atom(&mut self, message: &str) -> DResult<Token> {
        // A target may be a singlequoted string; an unterminated one is the same lexical error here as
        // anywhere a quote opens a value (4.3).
        if self.check(TokenType::Unterminated) {
            return self.fail(DiagnosticCode::LexUnterminated, "Unterminated string.");
        }

        if !self.peek().ty.is_value() || self.check(TokenType::Interpolate) {
            return self.fail(DiagnosticCode::ParseExpected, message);
        }

        let token = self.advance();

        if token.ty != TokenType::String || token.lexeme.starts_with('\'') {
            return Ok(token);
        }

        err(
            DiagnosticCode::LexInvalid,
            "A resource target cannot be a multiline string.",
            &token.span,
        )
    }

    fn require_boundary(&mut self, entity: &str) -> DResult<()> {
        if self.peek().ty.is_boundary() {
            return Ok(());
        }

        // A quote standing where a separator was due opens a string; when that string never closed, the
        // failure is the unterminated quote at its opening character, not the missing separator (4.3).
        if self.check(TokenType::Unterminated) {
            return self.fail(DiagnosticCode::LexUnterminated, "Unterminated string.");
        }

        self.fail(
            DiagnosticCode::ParseExpected,
            format!("Expected a comma or newline after {entity}."),
        )
    }

    fn consume(&mut self, ty: TokenType, message: &str) -> DResult<Token> {
        if self.check(ty) {
            return Ok(self.advance());
        }

        self.fail(DiagnosticCode::ParseExpected, message)
    }

    fn skip_separators(&mut self) {
        while self.matches(TokenType::Newline) || self.matches(TokenType::Comma) {
            // The separators carry no meaning of their own.
        }
    }

    fn skip_newlines(&mut self) {
        while self.matches(TokenType::Newline) {
            // As above.
        }
    }

    fn matches(&mut self, ty: TokenType) -> bool {
        if !self.check(ty) {
            return false;
        }

        self.advance();

        true
    }

    fn check(&self, ty: TokenType) -> bool {
        self.peek().ty == ty
    }

    /// The tokens are handed out by value. A token is small, parsing is linear, and the alternative
    /// is threading a borrow of `self` through every rule that also needs to advance it.
    fn advance(&mut self) -> Token {
        if !self.check(TokenType::Eof) {
            self.current += 1;
        }

        self.tokens[self.current - 1].clone()
    }

    fn previous(&self) -> Token {
        self.tokens[self.current - 1].clone()
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.current]
    }

    fn fail<T>(&self, code: DiagnosticCode, message: impl Into<String>) -> DResult<T> {
        err(code, message, &self.peek().span)
    }
}

/// A key written twice is valid, and the last write is the one that holds, but it is almost always a
/// mistake, so the linter says so. A key replaced by a spread is not reported.
fn lint_value(value: &ValueNode, diagnostics: &mut Vec<Diagnostic>) {
    match value {
        ValueNode::Map { entries, .. } => {
            let mut names: Vec<&str> = Vec::new();

            for entry in entries {
                let (name, span) = match entry {
                    MapItem::Entry { name, span, .. } => (name.as_str(), span),
                    MapItem::Link { value, span } => {
                        let name = match value {
                            ValueNode::Link { reference, .. }
                            | ValueNode::Call { reference, .. } => reference.receiving_key(),
                            _ => "",
                        };

                        (name, span)
                    }
                    // A key replaced by a spread is not reported.
                    MapItem::Spread { .. } => continue,
                };

                if names.contains(&name) {
                    diagnostics.push(Diagnostic::new(
                        DiagnosticCode::LintDuplicateKey,
                        format!("Map key '{name}' is written more than once."),
                        span.clone(),
                    ));
                }

                names.push(name);

                match entry {
                    MapItem::Entry { value, .. } => lint_value(value, diagnostics),
                    MapItem::Link {
                        value: ValueNode::Call { arguments, .. },
                        ..
                    } => {
                        for argument in arguments {
                            lint_value(&argument.value, diagnostics);
                        }
                    }
                    _ => {}
                }
            }
        }
        ValueNode::List { items, .. } => {
            for item in items {
                if let ListItem::Value(value) = item {
                    lint_value(value, diagnostics);
                }
            }
        }
        ValueNode::Structure { rows, .. } => {
            for row in rows {
                for cell in row {
                    lint_value(cell, diagnostics);
                }
            }
        }
        ValueNode::Call { arguments, .. } => {
            for argument in arguments {
                lint_value(&argument.value, diagnostics);
            }
        }
        ValueNode::Scalar { .. } | ValueNode::Link { .. } => {}
    }
}

pub fn lint_document(document: &Document) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    lint_value(&document.root, &mut diagnostics);

    for declaration in &document.declarations {
        if let Declaration::Leaflink(leaflink) = declaration {
            lint_value(&leaflink.value, &mut diagnostics);
        }
    }

    diagnostics
}
