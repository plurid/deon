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



The `C` implementation of `deon`, written from the specification. It has **zero third-party dependencies** — the C standard library and POSIX only, with SHA-256 hand-rolled for the response cache and plain HTTP written over sockets for the network. It passes every fixture in [`spec/conformance/cases.json`](../../spec/conformance/cases.json) with the right diagnostic code *and* position, and it agrees character for character with the `JavaScript`, `Rust`, `Python`, `Go`, `Java`, and `Swift` implementations under the [cross-implementation harness](../../spec/harness).

The language itself — the syntax, the linking, the imports, the datasign contracts — is defined in the [root README](../../README.md) and in [`spec/`](../../spec). This page is about the C package.

## Reading a document

``` c
#include "deon.h"

deon_document *doc = deon_parse("{ a one\nb [x, y] }", 18);
if (deon_document_ok(doc)) {
    deon_value *root = deon_document_root(doc);   // map{ a: "one", b: ["x", "y"] }
}
deon_document_free(doc);   // one arena holds the whole parse; this frees all of it
```

A value is a `deon_value`, which is exactly one of three shapes: a string, an ordered list, or an ordered map. There is no null, no boolean, and no number in the data model — everything is a string, including the things that look like they should not be. `1.50` is the string `"1.50"` and not the number `1.5`, because a `deon` value is a string; when numbers are wanted, they are asked for, through `deon_typed`.

| function | what it does |
| --- | --- |
| `deon_parse(source, len)` | reads a document, granting it nothing — a document that imports is denied |
| `deon_parse_with(source, len, options)` | reads a document with the capabilities and surroundings the caller decides |
| `deon_parse_file(path, options)` | reads a file, which grants the filesystem to it and to what it imports |
| `deon_read_json(source, len, name)` | converts JSON to a value, keeping each number's source spelling |
| `deon_parse_link(url, options)` | fetches a document over the network and evaluates it |
| `deon_entities(...)` / `deon_lint_document(...)` | what a document declares, and the diagnostics that are advice rather than refusal |
| `deon_stringify(value, options, &len)` | writes a value back out (the caller frees the result) |
| `deon_canonical(value, &len)` | the one output every implementation agrees on, character for character |
| `deon_typed(document, value)` | the conservative typer, which has booleans and numbers |

Memory is owned by the `deon_document`: one arena holds a whole parse — every node, value, and string — and `deon_document_free` releases all of it at once. A value from `deon_document_root` lives exactly as long as its document.

## Capabilities

Nothing is granted that was not asked for. `deon_parse` grants neither the filesystem nor the network, so a document that imports is told it may not — a diagnostic with a code and a position, rather than a surprise. Naming a *file* with `deon_parse_file` is itself the grant of the filesystem, for that file and for what it imports; the network is a separate sentence, and a remote target is refused **before the request is made**. Two failures are never confused: `DEON_CAPABILITY_DENIED` means it was never allowed, `DEON_RESOURCE_IO` means it was allowed and it failed.

## Building

``` bash
make          # builds the tool (build/deon) and the harness adapter (build/harness)
make test     # the conformance suite against spec/conformance/cases.json
make network  # the loopback network test (binds only to 127.0.0.1)
make cache    # the response-cache test
```

The command line tool has the same surface as its siblings, command for command — `deon <file>`, `convert`, `environment`, `confile`, `exfile`, `lint` — and is held to byte-identical behaviour by [`scripts/cli-harness.py`](../../scripts/cli-harness.py).
