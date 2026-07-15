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



The `Swift` implementation of `deon`. Unlike its siblings, it is not a fresh reading of the specification — it **binds to `deon-c`**, the C implementation, through a Clang module map over that package's own header. There is one parser, one evaluator, one canonical writer, and this package cannot drift from them: everything below the Swift surface is the exact code the C tests exercise. It has **zero third-party dependencies** — the Swift standard library, the C standard library and POSIX, and the sibling's C sources, compiled in by `make`. It passes every fixture in [`spec/conformance/cases.json`](../../spec/conformance/cases.json) with the right diagnostic code *and* position, and it agrees character for character with the `JavaScript`, `Rust`, `Python`, `Go`, `C`, and `Java` implementations under the [cross-implementation harness](../../spec/harness).

## Reading a document

``` swift
import Deon

let document = Deon.parse("{ a one\nb [x, y] }")
if document.ok {
    let value = document.value()   // .map([("a", .string("one")), ("b", .list([.string("x"), .string("y")]))])
}
```

A `DeonValue` is exactly one of three shapes: a `.string`, an ordered `.list`, or an ordered `.map` — a map is a list of key/value pairs, because a `deon` map's write order is part of it. Everything is a string, including the things that look like they should not be:

``` swift
let document = Deon.parse("{ n 1.50\nb true }")
// .map([("n", .string("1.50")), ("b", .string("true"))])
```

`1.50` is the string `"1.50"` and not the number `1.5`, because a `deon` value is a string. When numbers are wanted, they are asked for — `document.typed()` yields `.bool` and `.number` in addition to the three shapes.

| call | what it does |
| --- | --- |
| `Deon.parse(source)` | reads a document, granting it nothing — a document that imports is denied |
| `Deon.parseWith(source, options)` | reads a document with the capabilities and surroundings the caller decides |
| `Deon.parseFile(path, options)` | reads a file, which grants the filesystem to it and to what it imports |
| `Deon.readJSON(data, name)` | converts JSON to a value, keeping each number's source spelling |
| `Deon.parseLink(url, options)` | fetches a document over the network and evaluates it |
| `Deon.entities(source, name)` / `Deon.lint(source, name)` | what a document declares, and the diagnostics that are advice rather than refusal |
| `document.canonical()` | the one output every implementation agrees on, character for character |
| `document.stringify(options)` | writes the value back out |
| `document.typed()` | the conservative typer, which has booleans and numbers |

A document owns the C parse — one arena holding the whole tree — and frees it when the `Document` is released. A failure is read from `document.error` (its code and position) or `document.diagnostics` (the whole import trace); a code and a position are normative, and the message is not.

## Capabilities

Nothing is granted that was not asked for. `Deon.parse` grants neither the filesystem nor the network, so a document that imports is told it may not — a diagnostic with a code and a position, rather than a surprise. Naming a *file* with `Deon.parseFile` is itself the grant of the filesystem, for that file and for what it imports; the network is a separate sentence, and a remote target is refused **before the request is made**. Two failures are never confused: `DEON_CAPABILITY_DENIED` means it was never allowed, `DEON_RESOURCE_IO` means it was allowed and it failed. The environment read by `#$NAME` defaults to empty and is never filled in from the process environment.

## Building

``` bash
make          # builds the library, the tool, and the harness adapter into build/
make test     # the conformance suite against spec/conformance/cases.json
make network  # the loopback network test (binds only to 127.0.0.1)
make cache    # the response-cache test
```

The build compiles `deon-c`'s C sources to objects, compiles the Swift wrapper into the `Deon` module, and links them together with `swiftc`. It uses `make` rather than SwiftPM, because SwiftPM will not reach a source file outside the package root, and the point is to compile the sibling's sources rather than copy them — so the binding cannot go stale.

The command line tool has the same surface as its siblings, command for command — `deon <file>`, `convert`, `environment`, `confile`, `exfile`, `lint` — built into `build/deon`, and held to byte-identical behaviour by [`scripts/cli-harness.py`](../../scripts/cli-harness.py).
