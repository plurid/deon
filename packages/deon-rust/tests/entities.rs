//! The entity inventory: what a document declares, and what each would demand if it were called.
//!
//! An entity's parameters are exactly the interpolation names it carries (specification 11). That is
//! a rule of the *language*, so it is asserted here rather than left to whatever asks the question —
//! an editor, or a prompt server, which must not answer it a second time and drift.

use deon::{entities, EntityKind};

const LIBRARY: &str = "\
import base from ./base.deon

review `Review this #{language} code, focusing on #{focus}:

#{code}`

plain a value with no interpolation

envy `Uses #{$HOME}, which is the environment, and #{real}, which is not.`

nested {
    a `one #{alpha}`
    b [`two #{beta}`, `three #{alpha}`]
}

tabled <id, note> [
    1, `note #{gamma}`
]

{
    review Review code for quality and bugs
}
";

#[test]
fn an_entity_reports_the_arguments_it_would_demand() {
    let found = entities(LIBRARY, "<memory>").expect("the document is valid");

    let named = |name: &str| {
        found
            .iter()
            .find(|entity| entity.name == name)
            .unwrap_or_else(|| panic!("no entity '{name}'"))
            .clone()
    };

    // In the order they are written, so a prompt's arguments do not shuffle between runs.
    assert_eq!(named("review").parameters, ["language", "focus", "code"]);
    assert_eq!(named("review").kind, EntityKind::Scalar);

    // An entity with no interpolation takes no arguments: it is a value, not a template.
    assert!(named("plain").parameters.is_empty());

    // An environment name is read from the environment rather than passed in, so it is not a
    // parameter. This is the one that a naive `#{...}` scan gets wrong.
    assert_eq!(named("envy").parameters, ["real"]);

    // The walk goes through maps, lists, and structures, and a name carried twice is one parameter.
    assert_eq!(named("nested").parameters, ["alpha", "beta"]);
    assert_eq!(named("nested").kind, EntityKind::Map);
    assert_eq!(named("tabled").parameters, ["gamma"]);
    assert_eq!(named("tabled").kind, EntityKind::Structure);

    // A resource shares the one declaration namespace, so leaving it out would make the list a lie
    // about which names are taken.
    assert_eq!(named("base").kind, EntityKind::Resource);
    assert!(named("base").parameters.is_empty());
}

/// Reading a document is not the same as running it: this is syntactic, so it grants nothing and can
/// reach nothing. Pointing it at a file whose imports you have not agreed to must be safe.
#[test]
fn the_inventory_needs_no_capabilities() {
    let source = "import secret from https://example.invalid/x.deon\n\ngreet `Hi #{name}`\n\n{\n    a b\n}\n";

    // `parse` would refuse this document outright, because it may not reach the network.
    assert!(deon::parse(source).is_err());

    // Reading what it declares does not need to reach anything at all.
    let found = entities(source, "<memory>").expect("the syntax is fine");

    assert_eq!(found.len(), 2);
    assert_eq!(found[0].name, "secret");
    assert_eq!(found[1].parameters, ["name"]);
}
