//! The cross-implementation harness adapter (`spec/harness/README.md`).
//!
//! A filter: newline-delimited JSON in, newline-delimited JSON out.
//!
//! It uses Deon's *own* JSON reader and writer, so it needs no dependency to take part — which is
//! the reason the protocol carries every value as a string. A Deon value is a string (specification
//! 2), so a request decoded by `deon::json::parse_json` is already exactly what an adapter needs,
//! and nobody had to agree on a decoder first.

use std::io::{self, BufRead, Write};

use deon::json::{parse_json, write_json, write_typed_json};
use deon::value::{Map, Value};
use deon::{ParseOptions, StringifyOptions};

fn text<'a>(request: &'a Map, key: &str) -> &'a str {
    match request.get(key) {
        Some(Value::String(value)) => value,
        _ => "",
    }
}

fn flag(request: &Map, key: &str, fallback: bool) -> bool {
    match request.get(key) {
        Some(Value::String(value)) => value == "true",
        _ => fallback,
    }
}

fn number(request: &Map, key: &str, fallback: usize) -> usize {
    match request.get(key) {
        Some(Value::String(value)) => value.parse().unwrap_or(fallback),
        _ => fallback,
    }
}

fn table<'a>(request: &'a Map, key: &str) -> Vec<(&'a str, &'a str)> {
    match request.get(key) {
        Some(Value::Map(entries)) => entries
            .iter()
            .filter_map(|(name, value)| match value {
                Value::String(item) => Some((name.as_str(), item.as_str())),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn options_of(request: &Map) -> ParseOptions {
    let mut options = ParseOptions::new()
        .source_name(text(request, "sourceName"))
        .filebase(text(request, "filebase"))
        .allow_filesystem(flag(request, "allowFilesystem", false))
        .allow_network(flag(request, "allowNetwork", false));

    if text(request, "sourceName").is_empty() {
        options = options.source_name("<memory>");
    }

    for (target, data) in table(request, "files") {
        options = options.resource(target, data);
    }

    for (from, to) in table(request, "absolutePaths") {
        options = options.absolute_path(from, to);
    }

    for (name, value) in table(request, "environment") {
        options = options.environment_variable(name, value);
    }

    // The contracts of specification 14.1, when the request carries any. The files themselves arrive
    // through `files`, like every other resource, so no adapter reaches a disk.
    if let Some(Value::List(files)) = request.get("datasignFiles") {
        options.datasign_files = files
            .iter()
            .filter_map(|file| file.as_str().map(str::to_string))
            .collect();
    }

    for (key, declared) in table(request, "datasignMap") {
        options
            .datasign_map
            .insert(key.to_string(), declared.to_string());
    }

    options
}

fn stringify_options_of(request: &Map) -> StringifyOptions {
    let given = match request.get("stringifyOptions") {
        Some(Value::Map(entries)) => entries.clone(),
        _ => Map::new(),
    };

    StringifyOptions {
        canonical: flag(&given, "canonical", false),
        readable: flag(&given, "readable", true),
        indentation: number(&given, "indentation", 4),
        leaflinks: flag(&given, "leaflinks", false),
        leaflink_level: number(&given, "leaflinkLevel", 1),
        leaflink_shortening: flag(&given, "leaflinkShortening", true),
        generated_header: flag(&given, "generatedHeader", false),
        generated_comments: flag(&given, "generatedComments", false),
    }
}

fn kind_of(kind: deon::EntityKind) -> &'static str {
    match kind {
        deon::EntityKind::Scalar => "scalar",
        deon::EntityKind::Map => "map",
        deon::EntityKind::List => "list",
        deon::EntityKind::Structure => "structure",
        deon::EntityKind::Link => "link",
        deon::EntityKind::Call => "call",
        deon::EntityKind::Resource => "resource",
    }
}

fn run(request: &Map) -> deon::DResult<String> {
    let operation = text(request, "op");
    let source = text(request, "source");
    let options = options_of(request);

    match operation {
        "entities" => {
            let found = deon::entities(source, &options.source_name)?;

            let list = Value::List(
                found
                    .into_iter()
                    .map(|entity| {
                        let mut map = Map::new();

                        map.insert("name", Value::String(entity.name));
                        map.insert(
                            "parameters",
                            Value::List(entity.parameters.into_iter().map(Value::String).collect()),
                        );
                        map.insert("kind", Value::String(kind_of(entity.kind).into()));

                        Value::Map(map)
                    })
                    .collect(),
            );

            Ok(write_json(&list))
        }
        "lint" => {
            let diagnostics = deon::lint(source, "<memory>")?;

            let list = Value::List(
                diagnostics
                    .into_iter()
                    .map(|diagnostic| {
                        let mut map = Map::new();

                        map.insert("code", Value::String(diagnostic.code.to_string()));
                        map.insert("line", Value::String(diagnostic.span.line.to_string()));
                        map.insert(
                            "column",
                            Value::String(diagnostic.span.column.to_string()),
                        );

                        Value::Map(map)
                    })
                    .collect(),
            );

            Ok(write_json(&list))
        }
        _ => {
            let value = deon::parse_with(source, &options)?;

            match operation {
                "canonical" => deon::canonical(&value),
                "stringify" => deon::stringify(&value, &stringify_options_of(request)),
                "typed" => Ok(write_typed_json(&deon::typed(&value)?)),
                "datasign" => Ok(write_typed_json(&deon::sign(&value, &options)?)),
                other => panic!("unknown operation '{other}'"),
            }
        }
    }
}

/// A JSON string, on one line.
///
/// The crate's own `write_json` indents, which is the right thing for a document and the wrong thing
/// for a protocol that is one response per line. The envelope is therefore written by hand; the
/// *payload* is still whatever the crate produced, carried across as a string.
fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);

    out.push('"');

    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }

    out.push('"');

    out
}

fn answer(id: &str, result: deon::DResult<String>) -> String {
    match result {
        Ok(text) => format!(
            "{{{}:{},{}:{},{}:{}}}",
            quote("id"),
            quote(id),
            quote("ok"),
            quote("true"),
            quote("result"),
            quote(&text),
        ),
        Err(failure) => {
            let diagnostic = &failure.diagnostics[0];
            let span = &diagnostic.span;

            // The secondary positions, each a [start, line, column] triple of strings, exactly the
            // three measures the primary carries. Built by hand like the rest of the envelope, so a
            // diagnostic with nothing else to point at emits `[]`.
            let related = format!(
                "[{}]",
                diagnostic
                    .related
                    .iter()
                    .map(|related_span| format!(
                        "[{},{},{}]",
                        quote(&related_span.start.to_string()),
                        quote(&related_span.line.to_string()),
                        quote(&related_span.column.to_string()),
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            );

            format!(
                "{{{}:{},{}:{},{}:{},{}:{},{}:{},{}:{},{}:{},{}:{}}}",
                quote("id"),
                quote(id),
                quote("ok"),
                quote("false"),
                quote("code"),
                quote(&failure.code.to_string()),
                quote("severity"),
                quote("error"),
                quote("start"),
                quote(&span.start.to_string()),
                quote("line"),
                quote(&span.line.to_string()),
                quote("column"),
                quote(&span.column.to_string()),
                quote("related"),
                related,
            )
        }
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = line.expect("stdin should be readable");

        if line.trim().is_empty() {
            continue;
        }

        let request = match parse_json(&line) {
            Ok(Value::Map(map)) => map,
            _ => panic!("a request must be a JSON object"),
        };

        let id = text(&request, "id").to_string();

        writeln!(stdout, "{}", answer(&id, run(&request))).expect("stdout should be writable");
        stdout.flush().expect("stdout should flush");
    }
}
