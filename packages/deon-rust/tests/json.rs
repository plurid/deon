//! The JSON reader, which the crate has to own because a JSON number must survive as the spelling it
//! was written with (specification 9.1) and every general parser has already destroyed it.
//!
//! The escape decoding is the part the reference implementation could delegate to its host and this
//! one cannot, so it is the part most likely to be quietly wrong. None of it is reached by a
//! conformance fixture.

use deon::json::parse_json;
use deon::value::Value;

fn map_of(source: &str) -> Vec<(String, String)> {
    let Ok(Value::Map(map)) = parse_json(source) else {
        panic!("expected a map from {source:?}");
    };

    map.iter()
        .map(|(key, value)| {
            let Value::String(value) = value else {
                panic!("expected a string");
            };

            (key.clone(), value.clone())
        })
        .collect()
}

/// The whole reason the reader exists.
#[test]
fn a_number_keeps_the_spelling_it_was_written_with() {
    let entries = map_of(
        r#"{ "a": 1.50, "b": 1e3, "c": 1.0, "d": 9007199254740993, "e": -0.0, "f": 1E+2 }"#,
    );

    assert_eq!(
        entries,
        vec![
            ("a".to_string(), "1.50".to_string()),
            ("b".to_string(), "1e3".to_string()),
            ("c".to_string(), "1.0".to_string()),
            ("d".to_string(), "9007199254740993".to_string()),
            ("e".to_string(), "-0.0".to_string()),
            ("f".to_string(), "1E+2".to_string()),
        ],
    );
}

/// There is no null, no boolean, and no number in the data model, so each becomes the string it can
/// be written back from — and null, which stands for nothing, becomes nothing.
#[test]
fn the_types_json_has_and_deon_does_not() {
    assert_eq!(
        map_of(r#"{ "t": true, "f": false, "n": null }"#),
        vec![
            ("t".to_string(), "true".to_string()),
            ("f".to_string(), "false".to_string()),
            ("n".to_string(), String::new()),
        ],
    );
}

/// A `\u` pair naming a surrogate is two escapes that together mean one character. The reference
/// handed this to `JSON.parse`; here it is written out, so here it is tested.
///
/// The escape is built from a backslash rather than written as one, so that what reaches the reader
/// is the six characters `\uD83D` and not an emoji that some earlier layer already decoded — which
/// would test the multi-byte copy path instead, and pass while the decoder was broken.
#[test]
fn a_surrogate_pair_is_one_character() {
    // Built from a backslash rather than written as one, so that what reaches the reader is the six
    // characters \uD83D and not an emoji some earlier layer already decoded.
    let b = '\\';
    let source = format!(
        "{{ \"emoji\": \"{b}uD83D{b}uDE00\", \"bmp\": \"{b}u00e9\", \
         \"clef\": \"{b}uD834{b}uDD1E\", \"mixed\": \"a{b}uD83D{b}uDE00b\", \
         \"nul\": \"{b}u0000\" }}"
    );

    assert!(source.contains(r"\uD83D"), "the source must hold the escape, not the character");

    let entries = map_of(&source);

    assert_eq!(entries[0].1, "\u{1F600}");
    assert_eq!(entries[0].1.chars().count(), 1, "a pair is one character, not two");
    assert_eq!(entries[1].1, "\u{e9}");
    assert_eq!(entries[2].1, "\u{1D11E}");
    assert_eq!(entries[3].1, "a\u{1F600}b");
    assert_eq!(entries[4].1, "\u{0}");
}

/// Half of a character is not a character.
#[test]
fn a_lone_surrogate_is_refused() {
    assert!(parse_json(r#"{ "a": "\uD83D" }"#).is_err(), "a lone leading surrogate");
    assert!(parse_json(r#"{ "a": "\uDE00" }"#).is_err(), "a lone trailing surrogate");
    assert!(parse_json(r#"{ "a": "\uD83Dx" }"#).is_err(), "a leading surrogate followed by text");
    assert!(parse_json(r#"{ "a": "\uD83DA" }"#).is_err(), "a leading surrogate followed by an ordinary escape");
}

#[test]
fn the_ordinary_escapes() {
    let entries = map_of(r#"{ "a": "\" \\ \/ \b \f \n \r \t" }"#);

    assert_eq!(entries[0].1, "\" \\ / \u{8} \u{c} \n \r \t");
}

/// A repeated member is last-write-wins, and moves to the position of its final write, exactly as a
/// Deon map does (specification 5).
#[test]
fn a_repeated_member_moves_to_its_final_position() {
    assert_eq!(
        map_of(r#"{ "a": "1", "b": "2", "a": "3" }"#),
        vec![
            ("b".to_string(), "2".to_string()),
            ("a".to_string(), "3".to_string()),
        ],
    );
}

/// A multi-byte character that was written as itself, rather than as an escape, is copied across
/// whole. The reader walks bytes, so this is where it would split one.
#[test]
fn a_literal_multibyte_character_survives() {
    let entries = map_of("{ \"a\": \"héllo 😀 мир\" }");

    assert_eq!(entries[0].1, "héllo 😀 мир");
}

#[test]
fn what_is_not_json() {
    for source in [
        "{ \"a\": 01 }",        // a leading zero is not a JSON number
        "{ \"a\": +1 }",
        "{ \"a\": .5 }",
        "{ \"a\": 'b' }",       // JSON has no singlequoted string
        "{ a: 1 }",             // an unquoted key
        "{ \"a\": 1 } trailing",
        "{ \"a\": \"unterminated }",
        "{ \"a\": \"\u{1}\" }", // an unescaped control character
    ] {
        assert!(parse_json(source).is_err(), "{source:?} is not JSON");
    }
}
