<p align="center">
    <a target="_blank" href="https://deon.plurid.com">
        <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
    </a>
    <br />
    <br />
    <a target="_blank" href="https://github.com/plurid/deon/blob/master/LICENSE">
        <img src="https://img.shields.io/badge/license-DEL-blue.svg?colorB=1380C3&style=for-the-badge" alt="License: DEL">
    </a>
</p>



<h1 align="center">
    deon
</h1>


<h3 align="center">
    DeObject Notation Format
</h3>



<br />



The `Rust` implementation of `deon`. It has **zero dependencies** in the default build — `cargo tree` shows nothing but the crate itself — and it is `#![forbid(unsafe_code)]` throughout. It passes every fixture in [`spec/conformance/cases.json`](../../spec/conformance/cases.json) with the right diagnostic code *and* position, and it agrees character for character with the `JavaScript`, `Python`, `Go`, `C`, `Java`, and `Swift` implementations under the [cross-implementation harness](../../spec/harness).

The language itself — the syntax, the linking, the imports, the datasign contracts — is defined in the [root README](../../README.md) and in [`spec/`](../../spec). This page is about the Rust crate.

## Reading a document

``` rust
let value = deon::parse("{ a one\nb [x, y] }")?;
// Value::Map({ "a": "one", "b": ["x", "y"] })
```

A `Value` is exactly one of three variants — `String`, `List`, or `Map`, an ordered map — with no null, no boolean, and no number in the data model. Everything is a string, including the things that look like they should not be:

``` rust
let value = deon::parse("{ n 1.50\nb true }")?;
// Value::Map({ "n": "1.50", "b": "true" })
```

`1.50` is the string `"1.50"` and not the number `1.5`, because a `deon` value is a string. When numbers are wanted, they are asked for — `deon::typed` yields a `Typed`, which has booleans and numbers.

| function | what it does |
| --- | --- |
| `deon::parse(source)` | reads a document, granting it nothing — a document that imports is denied |
| `deon::parse_with(source, &options)` | reads a document with the capabilities and surroundings the caller decides |
| `deon::parse_file(path, &options)` | reads a file, which grants the filesystem to it and to what it imports |
| `deon::parse_syntax(source, name)` | parses without evaluating, so nothing is loaded and nothing is reached |
| `deon::parse_link(url, &options)` | fetches a document over the network and evaluates it (requires the `network` feature) |
| `deon::lint(source, name)` / `deon::entities(source, name)` | the diagnostics that are advice rather than refusal, and what a document declares |
| `deon::stringify(&value, &options)` / `deon::canonical(&value)` | writes a value back out; `canonical` is the one form every implementation agrees on |
| `deon::typed(&value)` | the conservative typer, which has booleans and numbers |

A failure is a `DeonError`, carrying a `DiagnosticCode` and the `Diagnostic` list an editor would underline; a code and a position are normative, and the message is not.

## Compile-time documents

A document known at build time can be written inline with the `deon!` macro, or read from a file with `include_deon!`. Both parse with the real parser *while the crate compiles*, so a malformed document is a compile error carrying the diagnostic's code and position — not a runtime `Err` found later.

``` rust
use deon::deon;

let config = deon!("{\n    port 8080\n}\n");   // -> Value, checked at build time
let config = include_deon!("config.deon");     // like include_str! + parse, relative to the crate root
```

The input is a string literal because a Deon document is whitespace-significant — newlines and commas separate its entries — and a Rust macro's token stream has already discarded that. A string literal survives verbatim; a raw string (`r#"…"#`) is the pleasant way to write a multi-line document without escaping. The macros live in the `deon-macros` crate and are re-exported here, so a caller depends only on `deon`.

## Capabilities

Nothing is granted that was not asked for. `deon::parse` grants neither the filesystem nor the network, so a document that imports is told it may not — a diagnostic with a code and a position, rather than a surprise. Naming a *file* with `deon::parse_file` is itself the grant of the filesystem, for that file and for what it imports. The network is stronger than a permission: it is behind the `network` feature, off by default, so a build that never asks for it **cannot open a socket** and `cargo tree` has nothing to audit. Two failures are never confused: a capability that was never allowed is not the same as a resource that was allowed and failed.

## Install

``` bash
cargo add deon
```

## Building

``` bash
cargo test                      # the library, the conformance suite, and the invariants
cargo test --features cli       # the command line tool, held to byte-identical behaviour
cargo build --features cli      # builds the tool; the binary is behind the feature
```

The tool is the same surface as its siblings — `deon <file>`, `convert`, `environment`, `confile`, `exfile`, `lint` — held to byte-identical behaviour against every other implementation by [`scripts/cli-harness.py`](../../scripts/cli-harness.py), and the library by [`scripts/harness.py`](../../scripts/harness.py).
