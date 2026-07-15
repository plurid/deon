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



The `Java` implementation of `deon`, written from the specification. It has **zero third-party dependencies** — the Java standard library only, with `java.net.http` for the network and `MessageDigest` for the response cache. It passes every fixture in [`spec/conformance/cases.json`](../../spec/conformance/cases.json) with the right diagnostic code *and* position, and it agrees character for character with the `JavaScript`, `Rust`, `Python`, `Go`, and `C` implementations under the [cross-implementation harness](../../spec/harness).

## Reading a document

``` java
import deon.Deon;

Object value = Deon.parse("{ a one\nb [x, y] }");
// DeonMap{ a: "one", b: ["x", "y"] }
```

A value is one of exactly three shapes: a `String`, an ordered `List<Object>`, or a `DeonMap` — an ordered map, because a `deon` map's write order is part of it and Java's `HashMap` has none, while its `LinkedHashMap` keeps a rewritten key in the wrong place. Everything is a string, including the things that look like they should not be:

``` java
Object value = Deon.parse("{ n 1.50\nb true }");
// DeonMap{ n: "1.50", b: "true" }
```

`1.50` is the string `"1.50"` and not the number `1.5`, because a `deon` value is a string. When numbers are wanted, they are asked for — `Deon.typed` yields `Boolean` and `Double`.

| method | what it does |
| --- | --- |
| `Deon.parse(source)` | reads a document, granting it nothing — a document that imports is denied |
| `Deon.parseWith(source, options)` | reads a document with the capabilities and surroundings the caller decides |
| `Deon.parseFile(path, options)` | reads a file, which grants the filesystem to it and to what it imports |
| `Deon.parseSyntax(source, name)` | parses without evaluating, so nothing is loaded and nothing is reached |
| `Deon.readJson(data, name)` | converts JSON to a value, keeping each number's source spelling |
| `Deon.parseLink(url, options)` | fetches a document over the network and evaluates it |
| `Deon.entities(source, name)` / `Deon.lint(source, name)` | what a document declares, and the diagnostics that are advice rather than refusal |
| `Deon.stringify(value, options)` | writes a value back out |
| `Deon.canonical(value)` | the one output every implementation agrees on, character for character |
| `Deon.typed(value)` | the conservative typer, which has booleans and numbers |

A diagnostic is a `DeonException`, carrying a `Code` and the `Diagnostic` list an editor would underline. Nothing else is thrown across the boundary — a host failure is a different exception, so a bug cannot masquerade as a bad document.

## Capabilities

Nothing is granted that was not asked for. `Deon.parse` grants neither the filesystem nor the network, so a document that imports is told it may not — a diagnostic with a code and a position, rather than a surprise. Naming a *file* with `Deon.parseFile` is itself the grant of the filesystem, for that file and for what it imports; the network is a separate sentence, and a remote target is refused **before the request is made**. Two failures are never confused: `DEON_CAPABILITY_DENIED` means it was never allowed, `DEON_RESOURCE_IO` means it was allowed and it failed. The environment read by `#$NAME` defaults to empty and is never filled in from the process environment.

## Building

``` bash
make          # builds the tool and the harness adapter into build/
make test     # the conformance suite against spec/conformance/cases.json
make network  # the loopback network test (binds only to 127.0.0.1)
make cache    # the response-cache test
```

The command line tool has the same surface as its siblings, command for command — `deon <file>`, `convert`, `environment`, `confile`, `exfile`, `lint` — run with `java -cp build cli.Cli`, and held to byte-identical behaviour by [`scripts/cli-harness.py`](../../scripts/cli-harness.py).
