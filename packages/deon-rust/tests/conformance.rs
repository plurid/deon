//! The normative conformance suite. An implementation conforms to Deon 1.0 only when it passes
//! every required fixture in `spec/conformance/cases.json` (specification 15).
//!
//! The fixtures are language-neutral and shared by every implementation, so they are read from the
//! repository rather than copied in here, where they could drift away from it. A case that needs a
//! resource is given the manifest's virtual files, so nothing here touches a network.

use deon::{DiagnosticCode, ParseOptions, StringifyOptions, Typed, Value};
use serde_json::Value as Json;

/// Included at compile time, so there is no working directory to get right, and touching the
/// manifest rebuilds the test.
const MANIFEST: &str = include_str!("../../../spec/conformance/cases.json");

#[test]
fn conformance() {
    let manifest: Json = serde_json::from_str(MANIFEST).expect("the manifest is not valid JSON");

    let cases = manifest["cases"]
        .as_array()
        .expect("the manifest has no cases");

    assert!(!cases.is_empty(), "the conformance manifest is empty");

    let mut failures: Vec<String> = Vec::new();
    let mut checked = Checked::default();

    for case in cases {
        let id = case["id"].as_str().unwrap_or("<unnamed>");

        if let Err(why) = run(case, &mut checked) {
            failures.push(format!("  {id}: {why}"));
        }
    }

    assert!(
        failures.is_empty(),
        "\n{}\n\n{} of {} fixtures failed.\n",
        failures.join("\n"),
        failures.len(),
        cases.len(),
    );

    // The guard above catches a fixture that asserts nothing. It does not catch a *harness* that
    // quietly reads none of a field it was given, because another assertion on the same fixture
    // would carry it. So what was actually checked is counted, and compared against what the
    // manifest holds: if a field stops being read, these stop agreeing.
    let declared = declared_counts(cases);

    assert_eq!(
        checked, declared,
        "\nthe harness did not check everything the manifest declares\n  checked:  {checked:?}\n  declared: {declared:?}\n",
    );
}

/// How many of each kind of assertion the harness actually performed.
#[derive(Debug, Default, PartialEq, Eq)]
struct Checked {
    expected: usize,
    error: usize,
    position: usize,
    canonical: usize,
    stringify: usize,
    typed: usize,
    lint: usize,
}

fn declared_counts(cases: &[Json]) -> Checked {
    let mut declared = Checked::default();

    let present = |case: &Json, field: &str| !case[field].is_null();

    for case in cases {
        declared.expected += usize::from(present(case, "expected"));
        declared.error += usize::from(present(case, "error"));
        declared.position += usize::from(present(case, "position"));
        declared.canonical += usize::from(present(case, "canonical"));
        declared.stringify += usize::from(present(case, "stringify"));
        declared.typed += usize::from(present(case, "typed"));
        declared.lint += usize::from(present(case, "lint"));
    }

    declared
}

fn run(case: &Json, checked: &mut Checked) -> Result<(), String> {
    let source = source_of(case)?;
    let options = options_of(case);

    if !case["error"].is_null() {
        let expected = case["error"]
            .as_str()
            .ok_or_else(|| "the fixture's error is not a code".to_string())?;

        let Err(error) = deon::parse_with(&source, &options) else {
            return Err(format!(
                "expected {expected}, but the document evaluated successfully",
            ));
        };

        if error.code.as_str() != expected {
            return Err(format!("expected {expected}, got {}", error.code));
        }

        checked.error += 1;

        // Conformance requires the position of a diagnostic, and not only its code
        // (specification 15).
        if !case["position"].is_null() {
            let position = &case["position"];
            let span = &error.diagnostics[0].span;

            let line = position["line"].as_u64().unwrap_or(0) as usize;
            let column = position["column"].as_u64().unwrap_or(0) as usize;

            if span.line != line || span.column != column {
                return Err(format!(
                    "{expected} expected at {line}:{column}, reported at {}:{}",
                    span.line, span.column,
                ));
            }

            checked.position += 1;
        }

        return Ok(());
    }

    let mut asserted = false;

    if !case["canonical"].is_null() {
        let expected = case["canonical"]
            .as_str()
            .ok_or_else(|| "the fixture's canonical is not a string".to_string())?;

        let canonical = deon::canonical_source(&source).map_err(|error| error.to_string())?;

        if canonical != expected {
            return Err(format!("canonical: expected {expected:?}, got {canonical:?}"));
        }

        checked.canonical += 1;
        asserted = true;
    }

    if !case["stringify"].is_null() {
        let stringify = &case["stringify"];

        let value = deon::parse_with(&source, &options).map_err(|error| error.to_string())?;

        let expected = stringify["expected"]
            .as_str()
            .ok_or_else(|| "the fixture's stringify has no expected".to_string())?;

        let written = deon::stringify(&value, &stringify_options_of(&stringify["options"]));

        if written != expected {
            return Err(format!("stringify: expected {expected:?}, got {written:?}"));
        }

        checked.stringify += 1;
        asserted = true;
    }

    if !case["typed"].is_null() {
        let value = deon::parse_with(&source, &options).map_err(|error| error.to_string())?;
        let typed = deon::typed(&value);

        if !typed_matches(&typed, &case["typed"]) {
            return Err(format!("typed: expected {}, got {typed:?}", case["typed"]));
        }

        checked.typed += 1;
        asserted = true;
    }

    if !case["expected"].is_null() {
        let value = deon::parse_with(&source, &options).map_err(|error| error.to_string())?;

        if !value_matches(&value, &case["expected"]) {
            return Err(format!("expected {}, got {value:?}", case["expected"]));
        }

        checked.expected += 1;
        asserted = true;
    }

    if !case["lint"].is_null() {
        let expected = case["lint"]
            .as_array()
            .ok_or_else(|| "the fixture's lint is not a list".to_string())?;

        let diagnostics = deon::lint(&source, "<memory>").map_err(|error| error.to_string())?;

        let codes: Vec<&str> = diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.as_str())
            .collect();

        for wanted in expected {
            let wanted = wanted.as_str().unwrap_or_default();

            if !codes.contains(&wanted) {
                return Err(format!(
                    "expected lint {wanted}, got [{}]",
                    if codes.is_empty() {
                        "none".to_string()
                    } else {
                        codes.join(", ")
                    },
                ));
            }
        }

        checked.lint += 1;
        asserted = true;
    }

    // A fixture that asserts nothing would pass no matter what the implementation did.
    if !asserted {
        return Err("the fixture asserts nothing".to_string());
    }

    Ok(())
}

fn source_of(case: &Json) -> Result<String, String> {
    match case["file"].as_str() {
        Some(file) => case["files"][file]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("the manifest has no file '{file}'")),
        None => case["source"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "the fixture has no source".to_string()),
    }
}

fn options_of(case: &Json) -> ParseOptions {
    let mut options = ParseOptions::default();

    // A resource case is served entirely from the manifest, with the host denied.
    if let (Some(file), Some(files)) = (case["file"].as_str(), case["files"].as_object()) {
        for (target, data) in files {
            options
                .resources
                .insert(target.clone(), data.as_str().unwrap_or_default().to_string());
        }

        options.source_name = file.to_string();
        options.filebase = deon::resources::directory_of(file).to_string();
        options.allow_filesystem = false;
        options.allow_network = false;
    }

    if let Some(environment) = case["environment"].as_object() {
        for (name, value) in environment {
            options
                .environment
                .insert(name.clone(), value.as_str().unwrap_or_default().to_string());
        }
    }

    let Some(overrides) = case["options"].as_object() else {
        return options;
    };

    if let Some(paths) = overrides.get("absolutePaths").and_then(Json::as_object) {
        for (from, to) in paths {
            options
                .absolute_paths
                .insert(from.clone(), to.as_str().unwrap_or_default().to_string());
        }
    }

    if let Some(allow) = overrides.get("allowFilesystem").and_then(Json::as_bool) {
        options.allow_filesystem = allow;
    }

    if let Some(allow) = overrides.get("allowNetwork").and_then(Json::as_bool) {
        options.allow_network = allow;
    }

    if let Some(name) = overrides.get("sourceName").and_then(Json::as_str) {
        options.source_name = name.to_string();
    }

    if let Some(filebase) = overrides.get("filebase").and_then(Json::as_str) {
        options.filebase = filebase.to_string();
    }

    options
}

fn stringify_options_of(json: &Json) -> StringifyOptions {
    let mut options = StringifyOptions::default();

    let Some(given) = json.as_object() else {
        return options;
    };

    if let Some(value) = given.get("canonical").and_then(Json::as_bool) {
        options.canonical = value;
    }

    if let Some(value) = given.get("readable").and_then(Json::as_bool) {
        options.readable = value;
    }

    if let Some(value) = given.get("indentation").and_then(Json::as_u64) {
        options.indentation = value as usize;
    }

    if let Some(value) = given.get("leaflinks").and_then(Json::as_bool) {
        options.leaflinks = value;
    }

    if let Some(value) = given.get("leaflinkLevel").and_then(Json::as_u64) {
        options.leaflink_level = value as usize;
    }

    if let Some(value) = given.get("leaflinkShortening").and_then(Json::as_bool) {
        options.leaflink_shortening = value;
    }

    if let Some(value) = given.get("generatedHeader").and_then(Json::as_bool) {
        options.generated_header = value;
    }

    if let Some(value) = given.get("generatedComments").and_then(Json::as_bool) {
        options.generated_comments = value;
    }

    options
}

/// A JSON string is a Deon string, a JSON array a Deon list, a JSON object a Deon map. Map order is
/// presentation rather than data (specification 2), so keys are matched by lookup; where order is
/// meant, the `canonical` and `stringify` fixtures are what assert it.
fn value_matches(value: &Value, expected: &Json) -> bool {
    match (value, expected) {
        (Value::String(text), Json::String(wanted)) => text == wanted,
        (Value::List(items), Json::Array(wanted)) => {
            items.len() == wanted.len()
                && items
                    .iter()
                    .zip(wanted)
                    .all(|(item, wanted)| value_matches(item, wanted))
        }
        (Value::Map(entries), Json::Object(wanted)) => {
            entries.len() == wanted.len()
                && wanted.iter().all(|(key, wanted)| {
                    entries
                        .get(key)
                        .is_some_and(|entry| value_matches(entry, wanted))
                })
        }
        _ => false,
    }
}

/// The typer is the one place a Deon value becomes something other than a string, so the comparison
/// needs a value notion that has booleans and numbers in it. A JSON `1000` and a typed `1e3` are the
/// same number, so numbers compare numerically — which is also the only comparison the reference,
/// whose numbers are all doubles, could have been making.
fn typed_matches(value: &Typed, expected: &Json) -> bool {
    match (value, expected) {
        (Typed::Bool(value), Json::Bool(wanted)) => value == wanted,
        (Typed::Number(value), Json::Number(wanted)) => {
            wanted.as_f64().is_some_and(|wanted| *value == wanted)
        }
        (Typed::String(text), Json::String(wanted)) => text == wanted,
        (Typed::List(items), Json::Array(wanted)) => {
            items.len() == wanted.len()
                && items
                    .iter()
                    .zip(wanted)
                    .all(|(item, wanted)| typed_matches(item, wanted))
        }
        (Typed::Map(entries), Json::Object(wanted)) => {
            entries.len() == wanted.len()
                && wanted.iter().all(|(key, wanted)| {
                    entries
                        .iter()
                        .find(|(name, _)| name == key)
                        .is_some_and(|(_, entry)| typed_matches(entry, wanted))
                })
        }
        _ => false,
    }
}

/// Reading a canonical form back must give the value it was written from (specification 13). No
/// fixture asserts this across the whole suite, so it is asserted here, over every value the suite
/// produces.
#[test]
fn canonical_round_trip() {
    let manifest: Json = serde_json::from_str(MANIFEST).expect("the manifest is not valid JSON");
    let cases = manifest["cases"].as_array().expect("the manifest has no cases");

    let mut checked = 0;
    let mut failures: Vec<String> = Vec::new();

    for case in cases {
        if !case["error"].is_null() {
            continue;
        }

        let id = case["id"].as_str().unwrap_or("<unnamed>");

        let Ok(source) = source_of(case) else {
            continue;
        };

        let Ok(value) = deon::parse_with(&source, &options_of(case)) else {
            continue;
        };

        let canonical = deon::canonical(&value);

        match deon::parse(&canonical) {
            Ok(reparsed) if reparsed == value => checked += 1,
            Ok(reparsed) => failures.push(format!(
                "  {id}: parse(canonical(v)) != v\n    canonical: {canonical:?}\n    got: {reparsed:?}",
            )),
            Err(error) => failures.push(format!(
                "  {id}: canonical form does not parse: {error}\n    canonical: {canonical:?}",
            )),
        }
    }

    assert!(failures.is_empty(), "\n{}\n", failures.join("\n"));
    assert!(checked > 0, "no value was round-tripped");
}

/// A repeated key is last-write-wins, and it moves to the position of its final write
/// (specification 5). No fixture asserts the move directly, so this does.
#[test]
fn a_rewritten_key_moves_to_its_final_position() {
    let value = deon::parse("{\n    a 1\n    b 2\n    a 3\n}\n").expect("the document is valid");

    let Value::Map(map) = &value else {
        panic!("the root is a map");
    };

    assert_eq!(map.keys().collect::<Vec<_>>(), vec!["b", "a"]);
    assert_eq!(map.get("a"), Some(&Value::string("3")));

    // And the order is what the readable output writes, rather than only what the map remembers.
    assert_eq!(
        deon::stringify(&value, &StringifyOptions::default()),
        "{\n    b 2\n    a 3\n}\n",
    );
}

/// The scanner indexes by code point and slices by byte, so a document that is not ASCII must be
/// read rather than panicked on. The old Rust byte-indexed a `&str` and panicked outright.
#[test]
fn a_document_outside_ascii_is_read() {
    let value = deon::parse("{\n    'ключ' значение\n    emoji 😀\n}\n").expect("the document is valid");

    let Value::Map(map) = &value else {
        panic!("the root is a map");
    };

    assert_eq!(map.get("ключ"), Some(&Value::string("значение")));
    assert_eq!(map.get("emoji"), Some(&Value::string("😀")));
}

/// A bare name is ASCII (`[A-Za-z0-9_-]+`), so a key outside it must be quoted. The refusal is the
/// specified one, at the position the key was written, rather than a panic.
///
/// The *end* of the span is asserted too, and deliberately: no fixture checks it, because
/// conformance asks only where a diagnostic starts. But it is what an editor underlines with, and it
/// is the one number that tells a column counting code points apart from a column counting bytes —
/// `ключ` is four characters and eight bytes.
#[test]
fn a_bare_name_outside_ascii_is_refused_where_it_is_written() {
    let error = deon::parse("{\n    ключ значение\n}\n").expect_err("a bare key must be ASCII");

    assert_eq!(error.code, DiagnosticCode::LexInvalid);
    assert_eq!(error.message, "Invalid unquoted name 'ключ'.");

    let span = &error.diagnostics[0].span;

    assert_eq!((span.line, span.column), (2, 5));
    assert_eq!((span.end_line, span.end_column), (2, 9));

    // The offsets, by contrast, are byte offsets into the source, and index the four bytes of the
    // leading `{\n` plus the four spaces.
    assert_eq!((span.start, span.end), (6, 14));
}

/// The column of a diagnostic counts code points, so a character outside ASCII counts as one.
#[test]
fn a_column_counts_code_points() {
    let error = deon::parse("{\n    ключ 'unterminated\n}\n").expect_err("the string is unterminated");

    assert_eq!(error.code, DiagnosticCode::LexUnterminated);
    assert_eq!(error.diagnostics[0].span.line, 2);
    assert_eq!(error.diagnostics[0].span.column, 10);
}
