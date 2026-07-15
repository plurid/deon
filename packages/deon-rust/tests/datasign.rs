//! Typing a document against a declared contract (specification 14.1).

use std::collections::HashMap;

use deon::{DiagnosticCode, ParseOptions, Typed};

const CONTRACT: &str = "
// The shape of an account.
@graphql
data Account {
    id: string;
    age: number;
    admin: boolean;
    nickname?: string;      // optional
}

data Team {
    name: string;
    members: Account[];
}
";

fn options(map: &[(&str, &str)]) -> ParseOptions {
    let mut options = ParseOptions::new();

    options
        .resources
        .insert("account.datasign".to_string(), CONTRACT.to_string());

    options.datasign_files = vec!["account.datasign".to_string()];
    options.datasign_map = map
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();

    options
}

fn field<'a>(value: &'a Typed, path: &[&str]) -> &'a Typed {
    let mut current = value;

    for key in path {
        let Typed::Map(entries) = current else {
            panic!("'{key}' is not in a map");
        };

        current = &entries
            .iter()
            .find(|(name, _)| name == key)
            .unwrap_or_else(|| panic!("no '{key}'"))
            .1;
    }

    current
}

#[test]
fn a_declaration_beats_a_guess() {
    // The whole point. `007` stays a string to the conservative typer, which cannot know what it is;
    // a contract knows.
    let value = deon::parse_signed(
        "{\n    account {\n        id 007\n        age 007\n        admin true\n    }\n}",
        &options(&[("account", "Account")]),
    )
    .expect("it types");

    assert_eq!(field(&value, &["account", "id"]), &Typed::String("007".into()));
    assert_eq!(field(&value, &["account", "age"]), &Typed::Number(7.0));
    assert_eq!(field(&value, &["account", "admin"]), &Typed::Bool(true));
}

#[test]
fn an_optional_field_may_be_absent_and_an_unknown_key_passes_through() {
    let value = deon::parse_signed(
        "{\n    account {\n        id a\n        age 30\n        admin false\n        extra kept\n    }\n}",
        &options(&[("account", "Account")]),
    )
    .expect("it types");

    let Typed::Map(entries) = field(&value, &["account"]) else {
        panic!("the account is a map");
    };

    assert!(entries.iter().all(|(name, _)| name != "nickname"));

    // A contract describes what it knows about, and silence is not a claim.
    assert_eq!(field(&value, &["account", "extra"]), &Typed::String("kept".into()));

    // And the write order of the document is what survives.
    let names: Vec<&str> = entries.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["id", "age", "admin", "extra"]);
}

#[test]
fn a_list_of_a_nested_entity() {
    let value = deon::parse_signed(
        "{\n    team {\n        name Ops\n        members [\n            { id a, age 30, admin true }\n            { id b, age 40, admin false }\n        ]\n    }\n}",
        &options(&[("team", "Team")]),
    )
    .expect("it types");

    let Typed::List(members) = field(&value, &["team", "members"]) else {
        panic!("the members are a list");
    };

    assert_eq!(field(&members[1], &["age"]), &Typed::Number(40.0));
    assert_eq!(field(&members[1], &["admin"]), &Typed::Bool(false));
}

#[test]
fn a_value_that_contradicts_its_contract() {
    let failure = deon::parse_signed(
        "{\n    account {\n        id a\n        age thirty\n        admin true\n    }\n}",
        &options(&[("account", "Account")]),
    )
    .expect_err("it does not type");

    assert_eq!(failure.code, DiagnosticCode::TypeMismatch);

    // No token survives evaluation, so the path through the data is what makes it actionable.
    assert!(failure.message.contains("account.age"), "{}", failure.message);
}

#[test]
fn a_missing_required_field() {
    let failure = deon::parse_signed(
        "{\n    account {\n        id a\n        admin true\n    }\n}",
        &options(&[("account", "Account")]),
    )
    .expect_err("it does not type");

    assert_eq!(failure.code, DiagnosticCode::TypeMismatch);
}

#[test]
fn an_unknown_type_leaves_its_value_alone() {
    // Datasign permits types defined elsewhere, and a value is not to be guessed at merely because
    // its type was not found.
    let value = deon::parse_signed("{\n    when 2024-01-01\n}", &options(&[("when", "Date")]))
        .expect("it types");

    assert_eq!(field(&value, &["when"]), &Typed::String("2024-01-01".into()));
}

#[test]
fn no_map_leaves_everything_a_string() {
    let value = deon::parse_signed("{\n    age 30\n}", &options(&[])).expect("it types");

    // Not `typed`, which would guess this into a number. Nobody declared it.
    assert_eq!(field(&value, &["age"]), &Typed::String("30".into()));
}

#[test]
fn reading_a_contract_needs_the_filesystem() {
    // A contract on a disk is filesystem access like any other (§9). A raw string handed to `parse`
    // grants nothing, so it may not go and read one.
    let mut options = ParseOptions::new();

    options.datasign_files = vec!["account.datasign".to_string()];
    options.datasign_map =
        HashMap::from([("account".to_string(), "Account".to_string())]);

    let failure = deon::parse_signed("{ account { id a } }", &options)
        .expect_err("it may not read the contract");

    assert_eq!(failure.code, DiagnosticCode::CapabilityDenied);
}

#[test]
fn a_contract_that_was_allowed_and_could_not_be_read() {
    // Allowed and failed is not the same as never allowed, and the codes must not be confused.
    let mut options = ParseOptions::new().allow_filesystem(true);

    options.datasign_files = vec!["nowhere.datasign".to_string()];
    options.datasign_map =
        HashMap::from([("account".to_string(), "Account".to_string())]);

    let failure = deon::parse_signed("{ account { id a } }", &options)
        .expect_err("there is no contract there");

    assert_eq!(failure.code, DiagnosticCode::ResourceIo);
}
