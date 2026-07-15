//! What went wrong, and exactly where.

use std::fmt;
use std::rc::Rc;

/// The diagnostic catalogue. A conforming implementation reports these codes, and these positions,
/// for an invalid document, so they belong to the specification rather than to this port
/// (specification 15, `spec/diagnostics.md`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum DiagnosticCode {
    CapabilityDenied,
    Cycle,
    DuplicateDeclaration,
    EntityArgument,
    LexInvalid,
    LexUnterminated,
    LintDuplicateKey,
    ParseExpected,
    ParseRoot,
    ResourceFormat,
    ResourceIo,
    StructureArity,
    TypeMismatch,
    UnresolvedLink,
}

impl DiagnosticCode {
    /// The wire name. The conformance manifest names these, so they are normative.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CapabilityDenied => "DEON_CAPABILITY_DENIED",
            Self::Cycle => "DEON_CYCLE",
            Self::DuplicateDeclaration => "DEON_DUPLICATE_DECLARATION",
            Self::EntityArgument => "DEON_ENTITY_ARGUMENT",
            Self::LexInvalid => "DEON_LEX_INVALID",
            Self::LexUnterminated => "DEON_LEX_UNTERMINATED",
            Self::LintDuplicateKey => "DEON_LINT_DUPLICATE_KEY",
            Self::ParseExpected => "DEON_PARSE_EXPECTED",
            Self::ParseRoot => "DEON_PARSE_ROOT",
            Self::ResourceFormat => "DEON_RESOURCE_FORMAT",
            Self::ResourceIo => "DEON_RESOURCE_IO",
            Self::StructureArity => "DEON_STRUCTURE_ARITY",
            Self::TypeMismatch => "DEON_TYPE_MISMATCH",
            Self::UnresolvedLink => "DEON_UNRESOLVED_LINK",
        }
    }

    /// A lint is advice; everything else stops the evaluation.
    pub fn severity(self) -> Severity {
        match self {
            Self::LintDuplicateKey => Severity::Warning,
            _ => Severity::Error,
        }
    }
}

impl fmt::Display for DiagnosticCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

/// Where a diagnostic points.
///
/// The offsets are bytes, for a host that wants to slice the source; the line and the column are
/// one-based Unicode code points, for a host that wants to show it. Both index the *normalized*
/// source, in which a carriage return before a newline has already been folded away.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub source: Rc<str>,
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

impl Span {
    /// The beginning of a source that was never read, for an error about a resource rather than
    /// about something written inside a document.
    pub fn head(source: impl Into<Rc<str>>) -> Self {
        Self {
            source: source.into(),
            start: 0,
            end: 0,
            line: 1,
            column: 1,
            end_line: 1,
            end_column: 1,
        }
    }
}

/// What went wrong, and exactly where. An editor reads the span to underline the offending text.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub severity: Severity,
    pub message: String,
    pub span: Span,
}

impl Diagnostic {
    pub fn new(code: DiagnosticCode, message: impl Into<String>, span: Span) -> Self {
        Self {
            code,
            severity: code.severity(),
            message: message.into(),
            span,
        }
    }
}

/// Evaluation is atomic: the first error ends it, carrying its diagnostics out with it
/// (specification 11.7).
#[derive(Clone, Debug)]
pub struct DeonError {
    pub code: DiagnosticCode,
    pub message: String,
    pub diagnostics: Vec<Diagnostic>,
}

impl DeonError {
    pub fn new(code: DiagnosticCode, message: impl Into<String>, span: Span) -> Self {
        let message = message.into();

        Self {
            code,
            message: message.clone(),
            diagnostics: vec![Diagnostic::new(code, message, span)],
        }
    }
}

impl fmt::Display for DeonError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.diagnostics.first() {
            Some(diagnostic) => write!(
                formatter,
                "{} at {}:{}:{} — {}",
                self.code,
                diagnostic.span.source,
                diagnostic.span.line,
                diagnostic.span.column,
                self.message,
            ),
            None => write!(formatter, "{} — {}", self.code, self.message),
        }
    }
}

impl std::error::Error for DeonError {}

pub type DResult<T> = Result<T, DeonError>;

/// Raises an error about something written in a document, pointing at where it was written.
///
/// The reference implementation throws, which narrows the control flow after the call for free.
/// Rust has no such idiom, so this returns the `Err` and the caller writes `return err(...)` or
/// `err(...)?` — the one place the port reads differently from the original.
pub fn err<T>(code: DiagnosticCode, message: impl Into<String>, span: &Span) -> DResult<T> {
    Err(DeonError::new(code, message, span.clone()))
}

/// Raises an error about a resource rather than about something written inside a document: a link
/// that may not be reached, a status that was not a success. There is no span to point at, because
/// nothing was read, so it points at the beginning of the resource it names.
pub fn resource_err<T>(code: DiagnosticCode, message: impl Into<String>, source: &str) -> DResult<T> {
    Err(DeonError::new(code, message, Span::head(source)))
}
