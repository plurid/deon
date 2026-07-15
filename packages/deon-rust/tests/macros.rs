//! The compile-time macros. That these compile at all is half the test: a malformed document inside
//! `deon!` would fail this crate's build, not an assertion.

use deon::{deon, include_deon, Value};

#[test]
fn parses_an_inline_document() {
    let value = deon!("{\n    a one\n    b [x, y]\n}\n");

    assert_eq!(
        value,
        Value::Map(
            [
                ("a".to_string(), Value::string("one")),
                (
                    "b".to_string(),
                    Value::List(vec![Value::string("x"), Value::string("y")]),
                ),
            ]
            .into_iter()
            .collect(),
        ),
    );
}

#[test]
fn a_raw_string_is_the_pleasant_form() {
    let value = deon!(r#"{
    greeting hello
    nested {
        inner value
    }
}
"#);

    let Value::Map(root) = value else {
        panic!("the root is a map");
    };
    assert_eq!(root.get("greeting"), Some(&Value::string("hello")));
}

#[test]
fn everything_is_a_string() {
    // `1.50` and `true` are strings, exactly as the runtime parser has them.
    let value = deon!("{ n 1.50\nb true }");

    let Value::Map(root) = value else {
        panic!("the root is a map");
    };
    assert_eq!(root.get("n"), Some(&Value::string("1.50")));
    assert_eq!(root.get("b"), Some(&Value::string("true")));
}

#[test]
fn empty_shapes_need_no_annotation() {
    assert_eq!(deon!("{}"), Value::Map(Default::default()));
    assert_eq!(deon!("[]"), Value::List(Vec::new()));
}

#[test]
fn matches_the_runtime_parser() {
    let source = "{\n    x [1, 2, 3]\n    y { z w }\n}\n";
    assert_eq!(deon!("{\n    x [1, 2, 3]\n    y { z w }\n}\n"), deon::parse(source).unwrap());
}

#[test]
fn unicode_escape_with_underscore_separator() {
    // Rust permits `\u{1_F600}`; the macro must decode it rather than reject it as a bad literal.
    let value = deon!("{ emoji \u{1_F600} }");
    let Value::Map(root) = value else {
        panic!("the root is a map");
    };
    assert_eq!(root.get("emoji"), Some(&Value::string("\u{1F600}")));
}

#[test]
fn includes_a_document_from_a_file() {
    // tests/fixtures/config.deon, relative to the crate root.
    let value = include_deon!("tests/fixtures/config.deon");

    let Value::Map(root) = value else {
        panic!("the root is a map");
    };
    assert_eq!(root.get("port"), Some(&Value::string("8080")));
}
