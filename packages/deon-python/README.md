<p align="center">
    <a target="_blank" href="https://deon.plurid.com">
        <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
    </a>
    <br />
    <br />
    <a target="_blank" href="https://pypi.org/project/deon">
        <img src="https://img.shields.io/pypi/v/deon.svg?logo=python&colorB=1380C3&style=for-the-badge" alt="PyPI">
    </a>
</p>



<h1 align="center">
    deon
</h1>


<h3 align="center">
    DeObject Notation Format · the <code>Python</code> implementation
</h3>



A `deon` value is exactly one of three things — a string, an ordered list, or an ordered map. There is no null, no boolean, and no number, and that is the whole of the data model. The full language is documented in the [root README](https://github.com/plurid/deon); what follows is what is particular to `Python`.

The package has **no dependencies**, and that is a promise rather than an oversight: the standard library is enough, and a notation format that drags a dependency tree behind it is a notation format nobody can audit.



## Contents

+ [Install](#install)
+ [Reading a document](#reading-a-document)
+ [Capabilities](#capabilities)
+ [Writing a value](#writing-a-value)
+ [Types](#types)
+ [Errors](#errors)
+ [Conformance](#conformance)



## Install

``` bash
pip install deon
```

Python 3.10 or later.



## Reading a document

``` python
import deon

deon.parse("{ a one\nb [x, y] }")
# {'a': 'one', 'b': ['x', 'y']}
```

Everything is a string, including the things that look like they should not be:

``` python
deon.parse("{ n 1.50\nb true }")
# {'n': '1.50', 'b': 'true'}
```

`1.50` is the string `'1.50'` and not the number `1.5`, because a `deon` value is a string. When numbers are wanted, they are asked for — see [types](#types).

| function | what it does |
| --- | --- |
| `parse(source)` | reads a document, granting it nothing — a document that imports is denied |
| `parse_with(source, options)` | reads a document with the capabilities and the surroundings the caller decides |
| `parse_with_loader(source, options, loader)` | as above, against a resolver the caller brought |
| `parse_file(path)` | reads a file, which grants the filesystem to it and to what it imports |
| `parse_syntax(source)` | the tree, without evaluating it, so nothing is loaded and nothing is reached |
| `entities(source)` | what the document declares, and what each of them would demand |
| `lint(source)` | the diagnostics that are advice rather than refusal |
| `stringify(value, options)` | writes a value back out |
| `canonical(value)` | the one output every implementation must agree on, character for character |
| `typed(value)` | the conservative typer, which has booleans and numbers |

**Everything is synchronous.** The `JavaScript` implementation has an asynchronous parser because its host forced one on it — `fetch` is asynchronous, and there was no way around it. Python's file and network reads block, so an `async def parse` would buy nothing and cost a second implementation of the evaluator. A caller who wants this off the event loop already has the way to say so:

``` python
value = await asyncio.to_thread(deon.parse_file, "configuration.deon")
```



## Capabilities

Nothing is granted that was not asked for. Calling `parse` on a piece of text grants neither the filesystem nor the network, so a document that imports is told it may not — which is a diagnostic, with a code and a position, rather than a surprise. This is what lets a host evaluate a document it did not write.

``` python
from deon import ParseOptions

options = ParseOptions(allow_filesystem=True)
options.absolute_paths = {"/logical/*": "/real/path"}

deon.parse_with(source, options)
```

A document can also be handed its resources directly, which is how a test — or an editor holding a file that has not been saved — reads one that imports while touching nothing at all:

``` python
options = ParseOptions(
    source_name="main.deon",
    resources={"other.deon": "{ name The Name }"},
)

deon.parse_with("import other from ./other\n{ #other.name }", options)
# 'The Name'
```

Naming a *file* is itself the grant: `parse_file` allows the filesystem, for the file and for what it imports. The network is a separate sentence, and it has not been said.

The **environment** read by `#$NAME` defaults to empty and is never filled in from `os.environ`. A library that read the ambient environment would make a document mean one thing on one machine and another on the next; a caller who wants it passes it:

``` python
deon.parse_with("{ home #$HOME }", ParseOptions(environment=dict(os.environ)))
```



## The network

A remote target is refused **before the request is made**, which is the whole difference between a decision and an accident: a denial that happened after the socket was opened would look the same from the outside and would not be the same thing.

``` python
deon.parse_with(
    "import remote from https://example.com/schema.deon\n{ ...#remote }",
    ParseOptions(allow_network=True),
)
```

A credential is written in the document as a leaflink and sent as a bearer token, or supplied by the host for a whole host at once:

``` deon
token #$API_TOKEN

import schema from https://example.com/schema.deon with #token
```

``` python
ParseOptions(allow_network=True, authorization={"example.com": token})
```

An **empty** token sends no header at all, because `Bearer ` is a credential-shaped nothing that a server would be right to reject. A token never appears in a cache identifier, and a document fetched under one credential is never served to the holder of another: the cache key is a digest of the target *and* the token (§9).

Two failures that must never be confused, and are not: `DEON_CAPABILITY_DENIED` means this was never allowed, and `DEON_RESOURCE_IO` means it was allowed and it failed.



## The command line

`pip install deon` puts a `deon` command on the path.

``` bash
deon configuration.deon                       # read it, write it back out
deon configuration.deon -o json -t            # as typed JSON
deon convert package.json package.deon        # 1.50 stays 1.50, not 1.5
deon environment app.deon npm start           # the document as the process environment
deon lint configuration.deon                  # what is legal and questionable
deon confile a.deon b.deon                    # many files into one document
deon exfile confile.deon                      # and back out again
```

Everything after the source of an `environment` is the command, verbatim: `deon environment app.deon curl -n https://…` passes that `-n` to `curl` and does not read it as a grant of the network.

The defaults are **not** the library's, and the difference is deliberate: `--filesystem` is *true* and `--network` is *false*. A file named on a command line was named by a person, so it may read the disk; nothing said it may reach the network. A document handed to a library, by contrast, came from somewhere unknown, and is granted neither.

`exfile` refuses to write an absolute path or one that climbs out with `..`, and checks every entry before writing any, so a document with one bad path writes nothing at all rather than leaving half an archive behind. A `.deon` file is data, and data must not be able to write wherever it likes.

The three tools are the same program written three times, and `scripts/cli-harness.py` runs all of them against the same arguments and requires the same exit status, the same output, the same files written, and the same diagnostic code at the same position. It is what found that this one's argument parser was eating the `-c` out of `sh -c '…'`.



## Writing a value

``` python
deon.stringify({"a": "one", "b": ["x", "y"]})
# '{\n    a one\n    b [\n        x\n        y\n    ]\n}\n'

deon.canonical({"z": "last", "a": "first"})
# '{\n    a first\n    z last\n}\n'
```

`canonical` sorts every map, uses four spaces and LF, and emits the shortest form of every string that reads back unchanged. It is not a style — it is an identity, and `parse(canonical(v)) == v` for every value.



## Types

``` python
deon.typed(deon.parse("{ n 1.50\nb true\nzip 007 }"))
# {'n': 1.5, 'b': True, 'zip': '007'}
```

The typer is **conservative** on purpose: it converts only what it could write back out unchanged. `007` stays a string, because a postal code that becomes the number 7 is a bug. `null` stays the string `'null'`, because `deon` has no null. `9007199254740993` stays a string, because a float cannot hold it and would hand back a different number than the one that was written.



## Errors

Everything raises `DeonError`, and nothing else crosses the boundary — no `RecursionError`, no `OSError`, no `json` exception. Those are the host's accidents leaking through, and each one would be a bug here rather than a fact about the document.

``` python
try:
    deon.parse("{ key 'unterminated }")
except deon.DeonError as failure:
    span = failure.diagnostics[0].span

    print(failure.code, f"{span.line}:{span.column}")
    # DEON_LEX_UNTERMINATED 1:7
```

A diagnostic carries UTF-8 byte offsets to slice the source with, and a one-based line and column counted in **Unicode code points** to show a person. The two are different numbers, and conflating them is the classic way to underline the wrong character: `ключ` is four characters and eight bytes.



## Conformance

``` bash
python3 -m unittest discover -s tests
```

The suite runs the language-neutral fixtures in `spec/conformance/cases.json` — the same manifest every implementation reads, and never a copy. An implementation conforms only when it passes all of them, reporting the specified diagnostic code **and the position it was written at**: a code on its own is not conformance, because a diagnostic an editor cannot place is a diagnostic it cannot show.

This implementation was written from the specification rather than from its siblings, which is the only way to find out whether the specification says what they do. It mostly did not. Every place it fell short is written down in [`notes/specification.md`](./notes/specification.md), and amended into the specification itself.



## [Codeophon](https://github.com/ly3xqhl8g9/codeophon)

+ licensing: [delicense](https://github.com/ly3xqhl8g9/delicense)
+ versioning: [αver](https://github.com/ly3xqhl8g9/alpha-versioning)
