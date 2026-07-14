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
pub mod sha;
pub mod stringifier;
pub mod syntax;
pub mod text;
pub mod token;
pub mod typer;
pub mod url;
pub mod value;

/// Reaching a remote target. Requires the `network` feature, which is off by default — so a build
/// that never asks for it cannot open a socket, and `cargo tree` shows nothing to audit.
#[cfg(feature = "network")]
pub mod cache;
#[cfg(feature = "network")]
pub mod network;

#[cfg(feature = "network")]
pub use network::parse_link;

pub use diagnostic::{DResult, DeonError, Diagnostic, DiagnosticCode, Severity, Span};
pub use options::{ParseOptions, StringifyOptions};
pub use syntax::Document;
pub use typer::Typed;
pub use value::{Map, Value};

use interpreter::Interpreter;
use parser::{lint_document, Parser};
use resources::{DenyAll, Host};
use scanner::Scanner;
use stringifier::Stringifier;

/// Reads a document, granting it nothing. A document that imports is denied.
pub fn parse(source: &str) -> DResult<Value> {
    parse_with(source, &ParseOptions::default())
}

/// Reads a document with the capabilities and the surroundings the caller decides.
pub fn parse_with(source: &str, options: &ParseOptions) -> DResult<Value> {
    parse_with_loader(source, options, &Host)
}

/// Reads a document, reaching for its resources through a loader of the caller's own.
///
/// This is the seam for a host that wants a resource from somewhere this crate does not know about:
/// an archive, a database, an HTTP client it already trusts. It needs no feature flag.
pub fn parse_with_loader(
    source: &str,
    options: &ParseOptions,
    loader: &dyn resources::ResourceLoader,
) -> DResult<Value> {
    let document = parse_syntax(source, &options.source_name)?;

    Interpreter::new(loader).interpret(&document, options)
}

/// Reads a file, and grants the filesystem to it and to whatever it imports.
///
/// Naming a file is asking for it to be read, so this is the one entry point that grants a capability
/// on the caller's behalf. A caller who wants to read a file *without* letting its imports reach the
/// disk should use [`read_file`] and [`parse_with`], and say so — which is what the command-line tool
/// does, because `--filesystem false` has to mean something.
pub fn parse_file(file: &str, options: &ParseOptions) -> DResult<Value> {
    let source = read_file(file)?;

    let mut options = options.clone();
    options.source_name = file.to_string();
    options.filebase = resources::directory_of(file).to_string();
    options.allow_filesystem = true;

    parse_with(&source, &options)
}

/// The text of a file, as a diagnostic rather than an `io::Error` if it cannot be read.
pub fn read_file(file: &str) -> DResult<String> {
    match std::fs::read_to_string(file) {
        Ok(source) => Ok(source),
        Err(error) => diagnostic::resource_err(
            DiagnosticCode::ResourceIo,
            format!("Unable to read '{file}': {error}."),
            file,
        ),
    }
}

/// The tree, without evaluating it. Nothing is loaded, so nothing is reached.
pub fn parse_syntax(source: &str, source_name: &str) -> DResult<Document> {
    let tokens = Scanner::new(source, source_name).scan()?;

    Parser::new(tokens, source_name).parse()
}

/// A key written twice is valid, and the last write is the one that holds, but it is almost always a
/// mistake, so the linter says so.
pub fn lint(source: &str, source_name: &str) -> DResult<Vec<Diagnostic>> {
    Ok(lint_document(&parse_syntax(source, source_name)?))
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

/// A declaration, and the arguments it would demand if it were called.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entity {
    pub name: String,

    /// Exactly the interpolation names the entity carries, in the order it carries them
    /// (specification 11). An environment name is read from the environment rather than passed in,
    /// so it is not one of these.
    pub parameters: Vec<String>,

    pub kind: EntityKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntityKind {
    Scalar,
    Map,
    List,
    Structure,
    Link,
    Call,
    Resource,
}

/// The entities a document declares.
///
/// This is *syntactic*: it reads the document and does not evaluate it, so it grants nothing and can
/// reach nothing. That is what makes it safe to point at a file whose imports you have not agreed to.
///
/// An entity with parameters is a template — call it with `#name(parameter value)` and the
/// interpolations are filled in. Which makes a `.deon` file a prompt library, and this the thing that
/// says what a prompt's arguments are.
pub fn entities(source: &str, source_name: &str) -> DResult<Vec<Entity>> {
    let document = parse_syntax(source, source_name)?;

    Ok(document
        .declarations
        .iter()
        .map(|declaration| match declaration {
            syntax::Declaration::Leaflink(leaflink) => Entity {
                name: leaflink.name.clone(),
                parameters: evaluator::Evaluator::parameters(&leaflink.value),
                kind: match &leaflink.value {
                    syntax::ValueNode::Scalar { .. } => EntityKind::Scalar,
                    syntax::ValueNode::Map { .. } => EntityKind::Map,
                    syntax::ValueNode::List { .. } => EntityKind::List,
                    syntax::ValueNode::Structure { .. } => EntityKind::Structure,
                    syntax::ValueNode::Link { .. } => EntityKind::Link,
                    syntax::ValueNode::Call { .. } => EntityKind::Call,
                },
            },

            // A resource is a declaration too, and it shares the one namespace, so leaving it out
            // would make the list a lie about what names are taken.
            syntax::Declaration::Resource(resource) => Entity {
                name: resource.name.clone(),
                parameters: Vec::new(),
                kind: EntityKind::Resource,
            },
        })
        .collect())
}
