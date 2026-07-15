//! Typing a document against a declared contract (specification 14.1).
//!
//! The conservative typer of §14 guesses from the value, so it has to refuse whenever a guess could
//! be wrong: `007` stays a string, because a postal code that becomes the number 7 is a bug. A
//! contract is the other half. It supplies the intent the value cannot carry, and `007` becomes `7`
//! exactly where somebody declared it a number — and nowhere else.
//!
//! ```datasign
//! data Account {
//!     id: string;
//!     age: number;
//!     nickname?: string;
//! }
//! ```
//!
//! The `?` is the whole of the optionality: a field that is declared, not optional, and not present
//! is an error, and a key the contract never mentions passes through untouched rather than being
//! dropped. A contract describes what it knows about, and silence is not a claim.

use std::collections::HashMap;

use crate::diagnostic::{resource_err, DResult, DiagnosticCode};
use crate::typer::Typed;
use crate::value::Value;

/// What a diagnostic points at when there is nowhere to point: typing happens after evaluation, and
/// no source token survives it.
pub const DATASIGN_SOURCE: &str = "<datasign>";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    pub declared: String,
    pub required: bool,
}

/// An entity name, and the fields it declares.
pub type Signatures = HashMap<String, Vec<Field>>;

// #region reading a contract
/// `.datasign` source, as the shape it declares.
///
/// Only the shape is taken. An annotation (`@graphql ID`) and a comment describe the type to some
/// other tool and say nothing about what the data must look like, so both are skipped.
pub fn parse_datasign(source: &str) -> Signatures {
    let mut signatures: Signatures = HashMap::new();
    let mut open: Option<String> = None;

    for line in source.split('\n') {
        let trimmed = line.trim_start();

        if trimmed.starts_with("//")
            || trimmed.starts_with("/*")
            || trimmed.starts_with('*')
            || trimmed.starts_with('@')
        {
            continue;
        }

        // A trailing comment on a field line is trivia in the same way.
        let value = match line.find("//") {
            Some(at) => &line[..at],
            None => line,
        };

        if value.trim().is_empty() {
            continue;
        }

        if let Some(name) = entity_start(value) {
            signatures.insert(name.clone(), Vec::new());
            open = Some(name);

            continue;
        }

        if value.trim_start().starts_with('}') {
            open = None;

            continue;
        }

        let Some(entity) = open.as_ref() else {
            continue;
        };

        let Some(separator) = value.find(':') else {
            continue;
        };

        // A `?` *anywhere* on the line marks the field optional, which is datasign's own rule and not
        // a tidier one invented here: `nickname?: string` and `nickname: string?` are both optional to
        // the compiler that owns the format, and an adapter that read only the first would demand a
        // field that datasign says may be absent.
        let optional = value.contains('?');

        let name = value[..separator].trim().replace('?', "");
        let declared = value[separator + 1..]
            .trim()
            .trim_end_matches(';')
            .trim()
            .replace('?', "");

        if name.is_empty() || declared.is_empty() {
            continue;
        }

        signatures
            .get_mut(entity)
            .expect("the open entity was inserted when it opened")
            .push(Field {
                name,
                declared,
                required: !optional,
            });
    }

    signatures
}

/// `data <name> {`, and the name it opens.
fn entity_start(line: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix("data")?;

    // `database {` is not `data base {`: the keyword has to end.
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }

    let rest = rest.trim_start();
    let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();

    if name.is_empty() || !rest[name.len()..].trim_start().starts_with('{') {
        return None;
    }

    Some(name)
}

/// Every contract as one. A repeated entity takes its fields from the last source to declare it.
pub fn read_datasign(sources: &[String]) -> Signatures {
    let mut signatures: Signatures = HashMap::new();

    for source in sources {
        signatures.extend(parse_datasign(source));
    }

    signatures
}
// #endregion reading a contract

// #region numbers
/// A string as a number, or `None` if it is not one.
///
/// Deliberately not `str::parse::<f64>()`: §14.1 fixes the grammar as ECMAScript's, and Rust's is a
/// different one. Rust parses `inf` and `NaN`, both of which are a mismatch here, and rejects `0x10`,
/// which is 16. A contract has to mean the same thing in every implementation, so the grammar is
/// written out rather than delegated to the host.
pub fn numeric(text: &str) -> Option<f64> {
    let trimmed = text.trim();

    if trimmed.is_empty() {
        return None;
    }

    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = trimmed.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).ok().map(|number| number as f64);
        }
    }

    if !is_decimal(trimmed) {
        return None;
    }

    trimmed.parse::<f64>().ok().filter(|number| number.is_finite())
}

/// `[+-]? ( digits [.] digits? | . digits ) ( [eE] [+-]? digits )?`
///
/// Written by hand because the point is to *exclude* what the host would accept: `inf`, `NaN`, and a
/// digit separator all parse in Rust and are none of them numbers here.
fn is_decimal(text: &str) -> bool {
    let mut characters = text.chars().peekable();

    if matches!(characters.peek(), Some('+' | '-')) {
        characters.next();
    }

    let integral = take_digits(&mut characters);
    let mut fractional = 0;

    if characters.peek() == Some(&'.') {
        characters.next();

        fractional = take_digits(&mut characters);
    }

    // `.` alone is not a number, and neither is `+`.
    if integral == 0 && fractional == 0 {
        return false;
    }

    if matches!(characters.peek(), Some('e' | 'E')) {
        characters.next();

        if matches!(characters.peek(), Some('+' | '-')) {
            characters.next();
        }

        if take_digits(&mut characters) == 0 {
            return false;
        }
    }

    characters.next().is_none()
}

fn take_digits(characters: &mut std::iter::Peekable<std::str::Chars>) -> usize {
    let mut seen = 0;

    while matches!(characters.peek(), Some(c) if c.is_ascii_digit()) {
        characters.next();

        seen += 1;
    }

    seen
}
// #endregion numbers

// #region applying a contract
fn describe(value: &Value) -> &'static str {
    match value {
        Value::String(_) => "a string",
        Value::List(_) => "a list",
        Value::Map(_) => "a map",
    }
}

fn mismatch<T>(message: String) -> DResult<T> {
    resource_err(DiagnosticCode::TypeMismatch, message, DATASIGN_SOURCE)
}

/// A value the contract said nothing about, carried across unchanged.
///
/// Emphatically *not* [`crate::typed`]: a key the contract does not mention has not been declared to
/// be anything, and §14's guessing is exactly what a contract exists to replace. `007` stays `"007"`.
fn verbatim(value: &Value) -> Typed {
    match value {
        Value::String(text) => Typed::String(text.clone()),
        Value::List(items) => Typed::List(items.iter().map(verbatim).collect()),
        Value::Map(entries) => Typed::Map(
            entries
                .iter()
                .map(|(key, item)| (key.clone(), verbatim(item)))
                .collect(),
        ),
    }
}

/// One evaluated value, as the type its contract declares.
pub fn type_datasign(
    value: &Value,
    declared: &str,
    signatures: &Signatures,
    path: &str,
) -> DResult<Typed> {
    let declared = declared.trim();

    if let Some(item) = declared.strip_suffix("[]") {
        let Value::List(items) = value else {
            return mismatch(format!(
                "Expected '{path}' to be a list for '{declared}', found {}.",
                describe(value),
            ));
        };

        let item = item.trim();
        let mut typed = Vec::with_capacity(items.len());

        for (index, entry) in items.iter().enumerate() {
            typed.push(type_datasign(entry, item, signatures, &format!("{path}[{index}]"))?);
        }

        return Ok(Typed::List(typed));
    }

    if matches!(declared, "string" | "number" | "boolean") {
        let Value::String(text) = value else {
            return mismatch(format!(
                "Expected '{path}' to be a string for '{declared}', found {}.",
                describe(value),
            ));
        };

        return match declared {
            "string" => Ok(Typed::String(text.clone())),

            "boolean" => match text.as_str() {
                "true" => Ok(Typed::Bool(true)),
                "false" => Ok(Typed::Bool(false)),
                _ => mismatch(format!(
                    "Expected '{path}' to be 'true' or 'false' for 'boolean', found '{text}'.",
                )),
            },

            _ => match numeric(text) {
                Some(number) => Ok(Typed::Number(number)),
                None => mismatch(format!("Expected '{path}' to be a number, found '{text}'.")),
            },
        };
    }

    let Some(entity) = signatures.get(declared) else {
        // A type defined somewhere else. Datasign does not describe it, so neither does this — and a
        // value is not to be guessed at merely because its type was not found.
        return Ok(verbatim(value));
    };

    let Value::Map(entries) = value else {
        return mismatch(format!(
            "Expected '{path}' to be a map for '{declared}', found {}.",
            describe(value),
        ));
    };

    let fields: HashMap<&str, &Field> =
        entity.iter().map(|field| (field.name.as_str(), field)).collect();

    let mut typed: Vec<(String, Typed)> = Vec::new();

    // The write order of §5 is kept, and a key the contract does not mention passes through untyped
    // rather than being dropped.
    for (key, entry) in entries.iter() {
        let converted = match fields.get(key.as_str()) {
            Some(field) => {
                type_datasign(entry, &field.declared, signatures, &format!("{path}.{key}"))?
            }
            None => verbatim(entry),
        };

        typed.push((key.clone(), converted));
    }

    for field in entity {
        if field.required && !entries.contains_key(field.name.as_str()) {
            return mismatch(format!(
                "Required field '{path}.{}' of '{declared}' is missing.",
                field.name,
            ));
        }
    }

    Ok(Typed::Map(typed))
}

/// An evaluated root, with each named root key converted to the type declared for it.
///
/// A key named in the map and absent from the data is skipped rather than invented, and a key in the
/// data and not in the map is left exactly as it was parsed.
pub fn apply_datasign(
    root: &Value,
    signatures: &Signatures,
    map: &HashMap<String, String>,
) -> DResult<Typed> {
    if map.is_empty() {
        return Ok(verbatim(root));
    }

    let Value::Map(entries) = root else {
        return mismatch(format!(
            "A datasign map requires a root map, found {}.",
            describe(root),
        ));
    };

    let mut typed: Vec<(String, Typed)> = Vec::new();

    for (key, entry) in entries.iter() {
        let converted = match map.get(key) {
            Some(declared) => type_datasign(entry, declared, signatures, key)?,
            None => verbatim(entry),
        };

        typed.push((key.clone(), converted));
    }

    Ok(Typed::Map(typed))
}
// #endregion applying a contract

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_numeric_grammar_is_ecmascripts_and_not_rusts() {
        for (text, expected) in [
            ("42", 42.0),
            ("007", 7.0),
            ("1.50", 1.5),
            (" 12 ", 12.0),
            ("0x10", 16.0),
            ("0b11", 3.0),
            ("0o7", 7.0),
            ("1e3", 1000.0),
            ("+5", 5.0),
            (".5", 0.5),
            ("5.", 5.0),
        ] {
            assert_eq!(numeric(text), Some(expected), "{text}");
        }

        // Every one of these parses as an `f64` in Rust, and none of them is a number here.
        for text in ["1_000", "", "   ", "Infinity", "inf", "NaN", "1,2", "true", "0x", "12px"] {
            assert_eq!(numeric(text), None, "{text}");
        }
    }

    #[test]
    fn an_optional_field_loses_its_question_mark() {
        let signatures = parse_datasign("data A {\n    a: string;\n    b?: number;\n}");
        let fields = &signatures["A"];

        assert_eq!(fields[0], Field { name: "a".into(), declared: "string".into(), required: true });
        assert_eq!(fields[1], Field { name: "b".into(), declared: "number".into(), required: false });
    }

    #[test]
    fn the_last_source_wins_on_a_repeated_entity() {
        let signatures = read_datasign(&[
            "data A {\n    x: string;\n}".to_string(),
            "data A {\n    x: number;\n}".to_string(),
        ]);

        assert_eq!(signatures["A"][0].declared, "number");
    }
}
