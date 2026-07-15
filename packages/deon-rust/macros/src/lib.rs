//! The compile-time macros for `deon`.
//!
//! `deon!("…")` parses a Deon document written inline, and `include_deon!("path")` parses one from a
//! file, both *while the crate compiles*. The parser they run is the real one — `deon-core`, the same
//! code the `deon` facade re-exports — so a malformed document is a compile error carrying the
//! diagnostic's code and position, not a runtime `Err` discovered later. The expansion is the value
//! itself, built with the crate's own constructors and referring to the value types through `::deon`.
//!
//! The input is a single string literal because a Deon document is whitespace-significant — newlines
//! and commas separate its entries, and an unquoted value keeps its spaces — and a Rust macro's token
//! stream has already thrown that away. A string literal survives verbatim; a raw string (`r#"…"#`)
//! is the pleasant way to write a multi-line document without escaping.

use proc_macro::{TokenStream, TokenTree};

/// Parses an inline Deon document at compile time, expanding to the `deon::Value` it evaluates to.
#[proc_macro]
pub fn deon(input: TokenStream) -> TokenStream {
    match string_literal(input) {
        Ok(source) => expand(&source),
        Err(message) => compile_error(&message),
    }
}

/// Reads a Deon document from a file, relative to the crate root (`CARGO_MANIFEST_DIR`), and parses it
/// at compile time — the counterpart of `include_str!`, but yielding an evaluated `deon::Value`.
#[proc_macro]
pub fn include_deon(input: TokenStream) -> TokenStream {
    let path = match string_literal(input) {
        Ok(path) => path,
        Err(message) => return compile_error(&message),
    };
    let resolved = if std::path::Path::new(&path).is_absolute() {
        path.clone()
    } else {
        let base = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        format!("{base}/{path}")
    };
    match std::fs::read_to_string(&resolved) {
        Ok(source) => expand(&source),
        Err(error) => compile_error(&format!("include_deon!: cannot read '{path}': {error}")),
    }
}

/// Parses the source with the real parser, and either emits code that rebuilds the value or a compile
/// error carrying the diagnostic. The parse grants nothing — a document that imports is denied at
/// compile time, which is the honest outcome for a literal that cannot ask for a capability.
fn expand(source: &str) -> TokenStream {
    match deon_core::parse(source) {
        Ok(value) => {
            let mut code = String::new();
            emit(&value, &mut code);
            code.parse().expect("the generated value is valid Rust")
        }
        Err(error) => {
            let span = &error.diagnostics[0].span;
            compile_error(&format!(
                "deon: {} at {}:{}",
                error.code.as_str(),
                span.line,
                span.column
            ))
        }
    }
}

/// Writes the Rust that reconstructs a value. Maps and lists are built imperatively so that an empty
/// one needs no type annotation, and every path is absolute (`::deon`, `::std`) so the expansion does
/// not depend on what the call site has imported.
fn emit(value: &deon_core::Value, out: &mut String) {
    match value {
        deon_core::Value::String(text) => {
            out.push_str("::deon::Value::string(");
            out.push_str(&format!("{text:?}"));
            out.push(')');
        }
        deon_core::Value::List(items) => {
            out.push_str("{let mut __list=::std::vec::Vec::<::deon::Value>::new();");
            for item in items {
                out.push_str("__list.push(");
                emit(item, out);
                out.push_str(");");
            }
            out.push_str("::deon::Value::List(__list)}");
        }
        deon_core::Value::Map(map) => {
            out.push_str("{let mut __map=::deon::Map::new();");
            for (key, item) in map.iter() {
                out.push_str("__map.insert(");
                out.push_str(&format!("{key:?}"));
                out.push(',');
                emit(item, out);
                out.push_str(");");
            }
            out.push_str("::deon::Value::Map(__map)}");
        }
    }
}

/// The value of a single string literal, decoded — the normal form with its escapes, or a raw string
/// taken verbatim. Anything else (no token, more than one, a non-string) is a usage error.
fn string_literal(input: TokenStream) -> Result<String, String> {
    let mut trees = input.into_iter();
    let first = trees
        .next()
        .ok_or_else(|| "expected a single string literal".to_string())?;
    if trees.next().is_some() {
        return Err("expected a single string literal".to_string());
    }
    let literal = match first {
        TokenTree::Literal(literal) => literal.to_string(),
        _ => return Err("expected a string literal".to_string()),
    };
    unescape(&literal).ok_or_else(|| "expected a string literal".to_string())
}

/// Decodes a Rust string-literal token into the string it denotes. Handles the normal form with the
/// common escapes and the raw form `r#"…"#`; a byte string, a numeric literal, or an unknown escape is
/// rejected (returns `None`), which the caller turns into a compile error.
fn unescape(literal: &str) -> Option<String> {
    let bytes = literal.as_bytes();

    if bytes.first() == Some(&b'r') {
        // A raw string: r, some hashes, a quote, the verbatim content, the quote, the same hashes.
        let mut index = 1;
        let mut hashes = 0;
        while literal[index..].starts_with('#') {
            hashes += 1;
            index += 1;
        }
        if !literal[index..].starts_with('"') {
            return None;
        }
        index += 1;
        let closing = format!("\"{}", "#".repeat(hashes));
        let rest = &literal[index..];
        let end = rest.rfind(&closing)?;
        return Some(rest[..end].to_string());
    }

    if !literal.starts_with('"') || !literal.ends_with('"') || literal.len() < 2 {
        return None;
    }

    let inner: Vec<char> = literal[1..literal.len() - 1].chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < inner.len() {
        let c = inner[i];
        i += 1;
        if c != '\\' {
            out.push(c);
            continue;
        }
        let escape = *inner.get(i)?;
        i += 1;
        match escape {
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            '\\' => out.push('\\'),
            '"' => out.push('"'),
            '\'' => out.push('\''),
            '0' => out.push('\0'),
            'x' => {
                let hi = *inner.get(i)?;
                let lo = *inner.get(i + 1)?;
                i += 2;
                let code = u8::from_str_radix(&format!("{hi}{lo}"), 16).ok()?;
                out.push(code as char);
            }
            'u' => {
                if *inner.get(i)? != '{' {
                    return None;
                }
                i += 1;
                let mut hex = String::new();
                while *inner.get(i)? != '}' {
                    hex.push(inner[i]);
                    i += 1;
                }
                i += 1;
                out.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
            }
            '\n' => {
                // A backslash before a newline continues the line: the newline and the run of
                // whitespace that follows it are dropped.
                while i < inner.len() && inner[i].is_whitespace() {
                    i += 1;
                }
            }
            _ => return None,
        }
    }
    Some(out)
}

/// A `compile_error!` invocation carrying the message, as an expression so it fits wherever the macro
/// was called.
fn compile_error(message: &str) -> TokenStream {
    format!("::core::compile_error!({message:?})")
        .parse()
        .expect("the generated compile_error is valid Rust")
}
