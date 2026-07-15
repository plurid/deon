//! The examples in the README, run. A README that documents an API the crate does not have is how
//! the previous implementation of this crate came to claim things that were not true.

#[test]
fn the_capabilities_example() -> Result<(), deon::DeonError> {
    let options = deon::ParseOptions::new()
        .allow_filesystem(true)
        .absolute_path("absolute/path/*", "/real/path/on/disk");

    // Granted, but the file is not there, so it fails as an absent file rather than a denial.
    let error = deon::parse_with("import a from absolute/path/a\n\n{\n    #a\n}\n", &options)
        .expect_err("the file does not exist");

    assert_eq!(error.code, deon::DiagnosticCode::ResourceIo);

    Ok(())
}

#[test]
fn the_virtual_resource_example() -> Result<(), deon::DeonError> {
    let options = deon::ParseOptions::new()
        .source_name("main.deon")
        .resource("other.deon", "{\n    name The Name\n}\n");

    let data = deon::parse_with(
        "import other from ./other\n\n{\n    #other.name\n}\n",
        &options,
    )?;

    assert_eq!(
        data,
        deon::Value::Map(
            [("name".to_string(), deon::Value::string("The Name"))]
                .into_iter()
                .collect(),
        ),
    );

    Ok(())
}

/// The README's headline example: every leaf is a string, and the leaflink is spliced into the root.
#[test]
fn the_headline_example() -> Result<(), deon::DeonError> {
    let source = "\
{
    entities [
        {
            id 01
            name One
            active true
        }
    ]
    #time
}

time 1598439736
";

    let data = deon::parse(source)?;

    let deon::Value::Map(root) = &data else {
        panic!("the root is a map");
    };

    assert_eq!(root.get("time"), Some(&deon::Value::string("1598439736")));

    let Some(deon::Value::List(entities)) = root.get("entities") else {
        panic!("entities is a list");
    };

    let deon::Value::Map(first) = &entities[0] else {
        panic!("an entity is a map");
    };

    // Everything is a string, including what a host would call a number or a boolean.
    assert_eq!(first.get("id"), Some(&deon::Value::string("01")));
    assert_eq!(first.get("active"), Some(&deon::Value::string("true")));

    // The typer is where a host says what its own types make of them.
    let deon::Typed::Map(typed) = deon::typed(&data).expect("the value types") else {
        panic!("the root is a map");
    };

    let (_, deon::Typed::List(typed_entities)) =
        typed.iter().find(|(key, _)| key == "entities").expect("entities")
    else {
        panic!("entities is a list");
    };

    let deon::Typed::Map(first) = &typed_entities[0] else {
        panic!("an entity is a map");
    };

    // `01` has a leading zero, so it is not a number it could be written back from.
    assert_eq!(
        first.iter().find(|(key, _)| key == "id").map(|(_, value)| value),
        Some(&deon::Typed::String("01".to_string())),
    );
    assert_eq!(
        first.iter().find(|(key, _)| key == "active").map(|(_, value)| value),
        Some(&deon::Typed::Bool(true)),
    );

    Ok(())
}

/// The error example, and the promise it makes about where a diagnostic points.
#[test]
fn the_error_example() {
    let error = deon::parse("{\n    key 'unterminated\n}\n").expect_err("the string is unterminated");

    let span = &error.diagnostics[0].span;

    assert_eq!(error.code.as_str(), "DEON_LEX_UNTERMINATED");
    assert_eq!((span.line, span.column), (2, 9));
}
