//! The URL resolver, checked against the semantics it is a port of.
//!
//! Every expectation below was produced by Node's `new URL(reference, base).href` — the very call the
//! reference implementation makes in `Interpreter.resourceTarget`. They are not what I think the
//! answer is; they are what the reference actually does.

use deon::url::Url;

/// A resource's canonical identity is what the cycle check compares, so two spellings of one remote
/// document must fold to one string.
#[test]
fn resolution_agrees_with_the_reference() {
    let cases: &[(&str, &str, &str)] = &[
        ("https://example.com/a/b.deon", "./c.deon", "https://example.com/a/c.deon"),
        ("https://example.com/a/b.deon", "c.deon", "https://example.com/a/c.deon"),
        ("https://example.com/a/b.deon", "../c.deon", "https://example.com/c.deon"),
        ("https://example.com/a/b.deon", "../../c.deon", "https://example.com/c.deon"),
        ("https://example.com/a/b.deon", "/c.deon", "https://example.com/c.deon"),
        ("https://example.com/a/b/", "c.deon", "https://example.com/a/b/c.deon"),
        ("https://example.com/a/b/", "./x/../c.deon", "https://example.com/a/b/c.deon"),
        ("https://example.com/", "c.deon", "https://example.com/c.deon"),
        ("https://example.com", "c.deon", "https://example.com/c.deon"),
        ("https://example.com/a/b.deon", "https://other.org/z.deon", "https://other.org/z.deon"),
        ("https://example.com/a/b.deon", "//other.org/z.deon", "https://other.org/z.deon"),
        ("https://example.com/a/b.deon?q=1", "c.deon", "https://example.com/a/c.deon"),
        ("https://example.com/a/b.deon", "c.deon?rev=2", "https://example.com/a/c.deon?rev=2"),
        ("https://example.com/a/b.deon", "c.deon#frag", "https://example.com/a/c.deon#frag"),
        ("https://EXAMPLE.COM/a/b.deon", "c.deon", "https://example.com/a/c.deon"),
        ("https://example.com:443/a/b.deon", "c.deon", "https://example.com/a/c.deon"),
        ("http://example.com:80/a/b.deon", "c.deon", "http://example.com/a/c.deon"),
        ("https://example.com:8443/a/b.deon", "c.deon", "https://example.com:8443/a/c.deon"),
        ("https://user:pw@example.com/a/b.deon", "c.deon", "https://user:pw@example.com/a/c.deon"),
        ("https://example.com/a/b.deon", "./", "https://example.com/a/"),
        ("https://example.com/a/b.deon", "../", "https://example.com/"),
        ("https://example.com/a/./b/../c.deon", "d.deon", "https://example.com/a/d.deon"),
        ("https://example.com/a/b.deon", "?only=query", "https://example.com/a/b.deon?only=query"),
        ("https://example.com/a/b.deon", "#onlyfrag", "https://example.com/a/b.deon#onlyfrag"),
    ];

    let mut failures = Vec::new();

    for (base, reference, expected) in cases {
        let url = Url::parse(base).expect("the base is absolute");
        let got = url.join(reference).href();

        if got != *expected {
            failures.push(format!(
                "  {reference:?} against {base}\n    expected: {expected}\n    got:      {got}"
            ));
        }
    }

    assert!(failures.is_empty(), "\n{}\n", failures.join("\n"));
}

/// The port a scheme already implies must not be written down: `example.com:443` and `example.com`
/// are one host, and a cycle check that thought otherwise would be wrong.
#[test]
fn a_default_port_is_not_an_identity() {
    assert_eq!(
        Url::parse("https://example.com:443/a").unwrap().href(),
        Url::parse("https://example.com/a").unwrap().href(),
    );
    assert_eq!(
        Url::parse("http://EXAMPLE.com:80/a").unwrap().href(),
        Url::parse("http://example.com/a").unwrap().href(),
    );

    // A port that is not the default is part of the identity.
    assert_ne!(
        Url::parse("https://example.com:8443/a").unwrap().href(),
        Url::parse("https://example.com/a").unwrap().href(),
    );
}

/// The `authorization` option is keyed by an exact lowercase hostname — no port, no path.
#[test]
fn a_hostname_carries_neither_port_nor_case() {
    assert_eq!(Url::parse("https://EXAMPLE.com:8443/a/b").unwrap().hostname(), "example.com");
    assert_eq!(Url::parse("http://user:pw@Example.COM/x").unwrap().hostname(), "example.com");
}

#[test]
fn what_is_not_a_url() {
    assert!(Url::parse("./relative.deon").is_none());
    assert!(Url::parse("/absolute.deon").is_none());
    assert!(Url::parse("C:/windows/path").is_none());
    assert!(Url::parse("1http://example.com").is_none(), "a scheme starts with a letter");
}
