//! The conservative typer (specification 14).
//!
//! Typing is outside the Deon data model, where everything is a string. The conversion is therefore
//! deliberately conservative: a value is only given a type when there is exactly one type it could
//! have meant, and the string it was written as can be recovered from it.

use crate::text::{is_typer_decimal, is_typer_integer};
use crate::value::Value;

/// A Deon value once it has been read as the host would read it. This is the only place the three
/// cases of the data model become four.
#[derive(Clone, Debug, PartialEq)]
pub enum Typed {
    Bool(bool),
    Number(f64),
    String(String),
    List(Vec<Typed>),
    Map(Vec<(String, Typed)>),
}

/// The largest integer that still stands for the digits it was written with.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

pub fn typed(value: &Value) -> Typed {
    match value {
        Value::String(text) => type_string(text),
        Value::List(items) => Typed::List(items.iter().map(typed).collect()),
        Value::Map(entries) => Typed::Map(
            entries
                .iter()
                .map(|(key, entry)| (key.clone(), typed(entry)))
                .collect(),
        ),
    }
}

pub fn type_string(value: &str) -> Typed {
    if value == "true" {
        return Typed::Bool(true);
    }

    if value == "false" {
        return Typed::Bool(false);
    }

    if is_typer_integer(value) {
        let number: f64 = match value.parse() {
            Ok(number) => number,
            Err(_) => return Typed::String(value.to_string()),
        };

        // Beyond the safe range the number no longer stands for the digits that were written, so
        // the digits are kept instead.
        return if number.is_finite() && number.abs() <= MAX_SAFE_INTEGER {
            Typed::Number(number)
        } else {
            Typed::String(value.to_string())
        };
    }

    // A decimal is only a decimal when it is written as one: the integer forms are taken above.
    if is_typer_decimal(value) && (value.contains('.') || value.contains(['e', 'E'])) {
        let number: f64 = match value.parse() {
            Ok(number) => number,
            Err(_) => return Typed::String(value.to_string()),
        };

        return if number.is_finite() {
            Typed::Number(number)
        } else {
            Typed::String(value.to_string())
        };
    }

    Typed::String(value.to_string())
}
