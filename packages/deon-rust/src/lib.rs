//! Deon — the DeObject Notation Format of Structured Strings.
//!
//! A Deon value is exactly one of three things: a string, an ordered list, or an ordered map. There
//! is no null, no boolean, and no number (specification 2); [`typed`] is where a host says what its
//! own types make of them.
//!
//! Nothing here reaches the filesystem or the network unless it is asked to. Calling [`parse`]
//! grants neither: a document that imports will be told it may not (specification 9).
//!
//! ```
//! let value = deon::parse("{\n    greeting hello\n}\n").unwrap();
//!
//! assert_eq!(value, deon::Value::Map(
//!     [("greeting".to_string(), deon::Value::string("hello"))].into_iter().collect(),
//! ));
//! ```

#![forbid(unsafe_code)]

pub mod diagnostic;
pub mod evaluator;
pub mod interpreter;
pub mod json;
pub mod options;
pub mod parser;
pub mod resources;
pub mod scanner;
pub mod stringifier;
pub mod syntax;
pub mod text;
pub mod token;
pub mod typer;
pub mod value;

pub use diagnostic::{DResult, DeonError, Diagnostic, DiagnosticCode, Severity, Span};
pub use options::{ParseOptions, StringifyOptions};
pub use syntax::Document;
pub use typer::Typed;
pub use value::{Map, Value};

use interpreter::Interpreter;
use parser::{lint_document, Parser};
use resources::{DenyAll, Filesystem};
use scanner::Scanner;
use stringifier::Stringifier;

/// Reads a document, granting it nothing. A document that imports is denied.
pub fn parse(source: &str) -> DResult<Value> {
    parse_with(source, &ParseOptions::default())
}

/// Reads a document with the capabilities and the surroundings the caller decides.
pub fn parse_with(source: &str, options: &ParseOptions) -> DResult<Value> {
    let document = parse_syntax(source, &options.source_name)?;

    // The filesystem loader refuses on its own unless `allow_filesystem` says otherwise, so the
    // capability is enforced in one place rather than at every call.
    let filesystem = Filesystem;
    let deny = DenyAll;

    let loader: &dyn resources::ResourceLoader = if options.allow_filesystem {
        &filesystem
    } else {
        &deny
    };

    Interpreter::new(loader).interpret(&document, options)
}

/// Reads a file. Doing so grants the filesystem, to this document and to what it imports, unless the
/// caller says otherwise.
pub fn parse_file(file: &str, options: &ParseOptions) -> DResult<Value> {
    let source = match std::fs::read_to_string(file) {
        Ok(source) => source,
        Err(error) => {
            return diagnostic::resource_err(
                DiagnosticCode::ResourceIo,
                format!("Unable to read '{file}': {error}."),
                file,
            );
        }
    };

    let mut options = options.clone();
    options.source_name = file.to_string();
    options.allow_filesystem = true;

    parse_with(&source, &options)
}

/// The tree, without evaluating it. Nothing is loaded, so nothing is reached.
pub fn parse_syntax(source: &str, source_name: &str) -> DResult<Document> {
    let tokens = Scanner::new(source, source_name).scan()?;

    Parser::new(tokens, source_name).parse()
}

/// A key written twice is valid, and the last write is the one that holds, but it is almost always a
/// mistake, so the linter says so.
pub fn lint(source: &str) -> DResult<Vec<Diagnostic>> {
    Ok(lint_document(&parse_syntax(source, "<memory>")?))
}

/// The evaluated declaration namespace. Editor tooling reads this to drive leaflink completion.
pub fn leaflinks(source: &str, options: &ParseOptions) -> DResult<Map> {
    let document = parse_syntax(source, &options.source_name)?;

    Interpreter::new(&DenyAll).leaflinks(&document, options)
}

pub fn stringify(value: &Value, options: &StringifyOptions) -> String {
    Stringifier::new(options.clone()).stringify(value)
}

/// The one output two implementations must agree on, character for character. Reading it back must
/// give the value it was written from (specification 13).
pub fn canonical(value: &Value) -> String {
    Stringifier::new(StringifyOptions::canonical()).stringify(value)
}

/// The canonical form of a document, read and written back.
pub fn canonical_source(source: &str) -> DResult<String> {
    Ok(canonical(&parse(source)?))
}

/// Applies the conservative typer to an evaluated value (specification 14).
pub fn typed(value: &Value) -> Typed {
    typer::typed(value)
}
