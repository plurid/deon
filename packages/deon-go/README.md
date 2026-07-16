<p align="center">
    <a target="_blank" href="https://deon.plurid.com">
        <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
    </a>
</p>



<h1 align="center">
    deon
</h1>


<h3 align="center">
    DeObject Notation Format · the <code>Go</code> implementation
</h3>



A `deon` value is exactly one of three things — a string, an ordered list, or an ordered map. There is no null, no boolean, and no number, and that is the whole of the data model. The full language is documented in the [root README](https://github.com/plurid/deon); what follows is what is particular to `Go`.

The module has **no dependencies**, and that is a promise rather than an oversight: the standard library is enough, and a notation format that drags a dependency tree behind it is a notation format nobody can audit. `go list -m all` prints one line, and CI fails if it ever prints two.



## Contents

+ [Reading a document](#reading-a-document)
+ [Capabilities](#capabilities)
+ [The command line](#the-command-line)
+ [Writing a value](#writing-a-value)
+ [Types](#types)
+ [Errors](#errors)
+ [Conformance](#conformance)



## Reading a document

``` go
import "deon"

value, err := deon.Parse("{ a one\nb [x, y] }")
// map{ a: "one", b: ["x", "y"] }
```

A value is `deon.Value`, which is `any` narrowed to exactly three shapes: a `string`, a `[]deon.Value`, or a `*deon.Map` — an ordered map, because a `deon` map's write order is part of it and Go's built-in map has none. Everything is a string, including the things that look like they should not be:

``` go
value, _ := deon.Parse("{ n 1.50\nb true }")
// map{ n: "1.50", b: "true" }
```

`1.50` is the string `"1.50"` and not the number `1.5`, because a `deon` value is a string. When numbers are wanted, they are asked for — see [types](#types).

| function | what it does |
| --- | --- |
| `Parse(source)` | reads a document, granting it nothing — a document that imports is denied |
| `ParseWith(source, options)` | reads a document with the capabilities and the surroundings the caller decides |
| `ParseFile(path, options)` | reads a file, which grants the filesystem to it and to what it imports |
| `ParseSyntax(source, name)` | parses without evaluating, so nothing is loaded and nothing is reached |
| `Entities(source, name)` | what the document declares, and what each of them would demand |
| `Lint(source, name)` | the diagnostics that are advice rather than refusal |
| `Stringify(value, options)` | writes a value back out |
| `Canonical(value)` | the one output every implementation must agree on, character for character |
| `Typed(value)` | the conservative typer, which has booleans and numbers |

**Everything is synchronous.** The `JavaScript` implementation has an asynchronous parser because its host forced one on it — `fetch` is asynchronous, and there was no way around it. Go's file and network reads block, so an asynchronous `Parse` would buy nothing and cost a second implementation of the evaluator. A caller who wants a parse off the current goroutine already has the way to say so — `go`, a channel, an `errgroup`.



## Capabilities

Nothing is granted that was not asked for. Calling `Parse` on a piece of text grants neither the filesystem nor the network, so a document that imports is told it may not — which is a diagnostic, with a code and a position, rather than a surprise. This is what lets a host evaluate a document it did not write.

A document can be handed its resources directly, which is how a test — or an editor holding a file that has not been saved — reads one that imports while touching nothing at all:

``` go
options := deon.ParseOptions{
    SourceName: "main.deon",
    Resources:  map[string]string{"other.deon": "{ name The Name }"},
}

value, _ := deon.ParseWith("import other from ./other\n{ #other.name }", options)
// "The Name"
```

Naming a *file* is itself the grant: `ParseFile` allows the filesystem, for the file and for what it imports. The network is a separate sentence, and it has not been said — a remote target is refused **before the request is made**, which is the whole difference between a decision and an accident.

The **environment** read by `#$NAME` defaults to empty and is never filled in from the process environment. A library that read the ambient environment would make a document mean one thing on one machine and another on the next; a caller who wants it passes it, in `ParseOptions.Environment`.

Two failures that must never be confused, and are not: `DEON_CAPABILITY_DENIED` means this was never allowed, and `DEON_RESOURCE_IO` means it was allowed and it failed.



## The command line

``` bash
go build -o deon ./cmd/deon
```

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

The seven command-line tools are the same program written seven times, and `scripts/cli-harness.py` runs all of them against the same arguments and requires the same exit status, the same output, the same files written, and the same diagnostic code at the same position.



## Writing a value

``` go
deon.Stringify(value, deon.DefaultStringifyOptions())
// "{\n    a one\n    b [\n        x\n        y\n    ]\n}\n"

deon.Canonical(value)
```

`Canonical` sorts every map, uses four spaces and LF, and emits the shortest form of every string that reads back unchanged. It is not a style — it is an identity, and `Parse(Canonical(v))` equals `v` for every value.



## Types

``` go
deon.Typed(value) // over { n 1.50, b true, zip 007 }
// map{ n: 1.5, b: true, zip: "007" }
```

The typer is **conservative** on purpose: it converts only what it could write back out unchanged. `007` stays a string, because a postal code that becomes the number 7 is a bug. `null` stays the string `"null"`, because `deon` has no null. `9007199254740993` stays a string, because a float cannot hold it and would hand back a different number than the one that was written.



## Errors

Every failure crosses the boundary as `*deon.Error`, and nothing else — no host panic, no I/O error, no JSON decoder complaint. Those are the host's accidents leaking through, and each one would be a bug here rather than a fact about the document.

``` go
_, err := deon.Parse("{ key 'unterminated }")

var deonErr *deon.Error
if errors.As(err, &deonErr) {
    span := deonErr.Diagnostics[0].Span
    fmt.Println(deonErr.Code, span.Line, span.Column)
    // DEON_LEX_UNTERMINATED 1 7
}
```

A diagnostic carries UTF-8 byte offsets to slice the source with, and a one-based line and column counted in **Unicode code points** to show a person. The two are different numbers, and conflating them is the classic way to underline the wrong character: `ключ` is four characters and eight bytes.



## Conformance

``` bash
go test ./...
```

The suite runs the language-neutral fixtures in `spec/conformance/cases.json` — the same manifest every implementation reads, and never a copy. An implementation conforms only when it passes all of them, reporting the specified diagnostic code **and the position it was written at**: a code on its own is not conformance, because a diagnostic an editor cannot place is a diagnostic it cannot show.

This implementation was written from the specification rather than from its siblings — the fourth reading of a specification the first three had already been measured against. It found one rule the specification states backwards, one it never states, and a set of diagnostic positions it leaves to be guessed. Every one is written down in [`notes/specification.md`](./notes/specification.md).



## [Codeophon](https://github.com/ly3xqhl8g9/codeophon)

+ licensing: [delicense](https://github.com/ly3xqhl8g9/delicense)
+ versioning: [αver](https://github.com/ly3xqhl8g9/alpha-versioning)
