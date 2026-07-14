//! Reads JSON into the Deon data model, where everything is a string, a list, or a map.
//!
//! A general JSON parser cannot be used for this, which is why the crate has no dependencies. A JSON
//! number must arrive as the spelling it was written with (specification 9.1), and a parser has
//! already turned it into a host number by the time anyone could ask: `1.50` would come back as
//! `1.5`, and `9007199254740993` as something that is not the digits the document said. So the
//! source is read directly, and a number is carried across as the characters it was written as.

use crate::text::json_number_length;
use crate::typer::Typed;
use crate::value::{Map, Value};

/// Writes JSON, indented by four spaces.
///
/// Every Deon value is a string, a list, or a map, so this only ever writes a string, an array, or an
/// object. A number or a boolean can only appear once the conservative typer has been through
/// (specification 14), which is what [`write_typed_json`] is for.
pub fn write_json(value: &Value) -> String {
    let mut out = String::new();

    write_value(value, 0, &mut out);
    out.push('\n');

    out
}

fn write_value(value: &Value, level: usize, out: &mut String) {
    match value {
        Value::String(text) => write_json_string(text, out),
        Value::List(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }

            out.push_str("[\n");

            for (index, item) in items.iter().enumerate() {
                indent(level + 1, out);
                write_value(item, level + 1, out);

                if index + 1 < items.len() {
                    out.push(',');
                }

                out.push('\n');
            }

            indent(level, out);
            out.push(']');
        }
        Value::Map(entries) => {
            if entries.is_empty() {
                out.push_str("{}");
                return;
            }

            out.push_str("{\n");

            for (index, (key, entry)) in entries.iter().enumerate() {
                indent(level + 1, out);
                write_json_string(key, out);
                out.push_str(": ");
                write_value(entry, level + 1, out);

                if index + 1 < entries.len() {
                    out.push(',');
                }

                out.push('\n');
            }

            indent(level, out);
            out.push('}');
        }
    }
}

/// The typed view, where a string that could only have meant a number or a boolean has become one.
pub fn write_typed_json(value: &Typed) -> String {
    let mut out = String::new();

    write_typed(value, 0, &mut out);
    out.push('\n');

    out
}

fn write_typed(value: &Typed, level: usize, out: &mut String) {
    match value {
        Typed::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Typed::Number(number) => out.push_str(&format_number(*number)),
        Typed::String(text) => write_json_string(text, out),
        Typed::List(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }

            out.push_str("[\n");

            for (index, item) in items.iter().enumerate() {
                indent(level + 1, out);
                write_typed(item, level + 1, out);

                if index + 1 < items.len() {
                    out.push(',');
                }

                out.push('\n');
            }

            indent(level, out);
            out.push(']');
        }
        Typed::Map(entries) => {
            if entries.is_empty() {
                out.push_str("{}");
                return;
            }

            out.push_str("{\n");

            for (index, (key, entry)) in entries.iter().enumerate() {
                indent(level + 1, out);
                write_json_string(key, out);
                out.push_str(": ");
                write_typed(entry, level + 1, out);

                if index + 1 < entries.len() {
                    out.push(',');
                }

                out.push('\n');
            }

            indent(level, out);
            out.push('}');
        }
    }
}

/// A whole number is written without a fractional part, so `1` does not come back as `1.0`. The typer
/// only ever produces a finite number, so there is no infinity to write.
fn format_number(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e21 {
        format!("{number:.0}")
    } else {
        format!("{number}")
    }
}

fn indent(level: usize, out: &mut String) {
    for _ in 0..level {
        out.push_str("    ");
    }
}

fn write_json_string(text: &str, out: &mut String) {
    out.push('"');

    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            character if (character as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => out.push(character),
        }
    }

    out.push('"');
}

pub fn parse_json(source: &str) -> Result<Value, String> {
    let mut reader = JsonReader {
        source,
        bytes: source.as_bytes(),
        index: 0,
    };

    let value = reader.value()?;

    reader.whitespace();

    if reader.index != reader.bytes.len() {
        return reader.fail("Unexpected trailing input");
    }

    Ok(value)
}

struct JsonReader<'a> {
    source: &'a str,
    bytes: &'a [u8],
    index: usize,
}

impl JsonReader<'_> {
    fn value(&mut self) -> Result<Value, String> {
        self.whitespace();

        match self.bytes.get(self.index) {
            Some(b'"') => self.string().map(Value::String),
            Some(b'[') => self.array(),
            Some(b'{') => self.object(),
            _ => {
                if self.starts_with("true") {
                    self.index += 4;
                    return Ok(Value::string("true"));
                }

                if self.starts_with("false") {
                    self.index += 5;
                    return Ok(Value::string("false"));
                }

                // There is no null in the data model, and an absent value is the empty string.
                if self.starts_with("null") {
                    self.index += 4;
                    return Ok(Value::string(""));
                }

                match json_number_length(&self.source[self.index..]) {
                    // The number is kept exactly as it was written.
                    Some(length) if length > 0 => {
                        let number = &self.source[self.index..self.index + length];
                        self.index += length;

                        Ok(Value::string(number))
                    }
                    _ => self.fail("Expected a JSON value"),
                }
            }
        }
    }

    /// The escapes of a JSON string, decoded here rather than handed to a host that already knows
    /// them. A `\uXXXX` pair naming a surrogate is the one that earns its keep: it is two escapes
    /// that together mean one character, and a lone half of one means nothing at all.
    fn string(&mut self) -> Result<String, String> {
        self.index += 1;

        let mut value = String::new();

        while let Some(byte) = self.bytes.get(self.index).copied() {
            match byte {
                b'"' => {
                    self.index += 1;
                    return Ok(value);
                }

                b'\\' => {
                    self.index += 1;

                    let Some(escape) = self.bytes.get(self.index).copied() else {
                        return self.fail("Unterminated escape");
                    };

                    self.index += 1;

                    match escape {
                        b'"' => value.push('"'),
                        b'\\' => value.push('\\'),
                        b'/' => value.push('/'),
                        b'b' => value.push('\u{8}'),
                        b'f' => value.push('\u{c}'),
                        b'n' => value.push('\n'),
                        b'r' => value.push('\r'),
                        b't' => value.push('\t'),
                        b'u' => value.push(self.unicode()?),
                        _ => return self.fail("Invalid escape in string"),
                    }
                }

                byte if byte < 0x20 => {
                    return self.fail("Unescaped control character in string");
                }

                _ => {
                    // Bytes, not characters: a multi-byte character is copied across whole, and the
                    // index only ever lands on a boundary because every branch above consumes one.
                    let start = self.index;

                    self.index += 1;

                    while self
                        .bytes
                        .get(self.index)
                        .is_some_and(|byte| (byte & 0xC0) == 0x80)
                    {
                        self.index += 1;
                    }

                    value.push_str(&self.source[start..self.index]);
                }
            }
        }

        self.fail("Unterminated JSON string")
    }

    /// The four hex digits of a `\u` escape, and the second escape it may need to mean a character
    /// outside the basic plane.
    fn unicode(&mut self) -> Result<char, String> {
        let first = self.hex4()?;

        if !(0xD800..=0xDBFF).contains(&first) {
            return match char::from_u32(first) {
                Some(character) => Ok(character),
                // A trailing surrogate on its own names half of a character.
                None => self.fail("Invalid unicode escape"),
            };
        }

        if self.bytes.get(self.index) != Some(&b'\\')
            || self.bytes.get(self.index + 1) != Some(&b'u')
        {
            return self.fail("Unpaired leading surrogate in string");
        }

        self.index += 2;

        let second = self.hex4()?;

        if !(0xDC00..=0xDFFF).contains(&second) {
            return self.fail("Unpaired leading surrogate in string");
        }

        let combined = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);

        match char::from_u32(combined) {
            Some(character) => Ok(character),
            None => self.fail("Invalid unicode escape"),
        }
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let Some(digits) = self.source.get(self.index..self.index + 4) else {
            return self.fail("Truncated unicode escape");
        };

        match u32::from_str_radix(digits, 16) {
            Ok(value) => {
                self.index += 4;
                Ok(value)
            }
            Err(_) => self.fail("Invalid unicode escape"),
        }
    }

    fn array(&mut self) -> Result<Value, String> {
        let mut result: Vec<Value> = Vec::new();

        self.index += 1;
        self.whitespace();

        if self.take(b']') {
            return Ok(Value::List(result));
        }

        loop {
            result.push(self.value()?);
            self.whitespace();

            if self.take(b']') {
                return Ok(Value::List(result));
            }

            self.expect(b',')?;
        }
    }

    fn object(&mut self) -> Result<Value, String> {
        let mut result = Map::new();

        self.index += 1;
        self.whitespace();

        if self.take(b'}') {
            return Ok(Value::Map(result));
        }

        loop {
            self.whitespace();

            if self.bytes.get(self.index) != Some(&b'"') {
                return self.fail("Expected a quoted object key");
            }

            let key = self.string()?;

            self.whitespace();
            self.expect(b':')?;

            let value = self.value()?;

            // A repeated member follows the last-write-wins rule of a Deon map, and so moves to the
            // position of its final write. `Map::insert` is that rule, so there is nothing to do.
            result.insert(key, value);

            self.whitespace();

            if self.take(b'}') {
                return Ok(Value::Map(result));
            }

            self.expect(b',')?;
        }
    }

    fn whitespace(&mut self) {
        while matches!(self.bytes.get(self.index), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.index += 1;
        }
    }

    fn starts_with(&self, literal: &str) -> bool {
        self.source[self.index..].starts_with(literal)
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        self.whitespace();

        if self.take(byte) {
            return Ok(());
        }

        self.fail(&format!("Expected '{}'", byte as char))
    }

    fn take(&mut self, byte: u8) -> bool {
        if self.bytes.get(self.index) != Some(&byte) {
            return false;
        }

        self.index += 1;

        true
    }

    fn fail<T>(&self, message: &str) -> Result<T, String> {
        Err(format!("{message} at offset {}.", self.index))
    }
}
