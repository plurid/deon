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



The `JavaScript` / `TypeScript` implementation of `deon`, and the reference implementation — the one the specification was written alongside, and against which the six others are held. It has **zero third-party runtime dependencies**. It passes every fixture in [`spec/conformance/cases.json`](../../spec/conformance/cases.json) with the right diagnostic code *and* position, and it agrees character for character with the `Rust`, `Python`, `Go`, `C`, `Java`, and `Swift` implementations under the [cross-implementation harness](../../spec/harness).

The language itself — the syntax, the linking, the imports, the datasign contracts — is defined in the [root README](../../README.md) and in [`spec/`](../../spec). This page is about the JavaScript package.

## Reading a document

``` typescript
import Deon from '@plurid/deon';

const deon = new Deon();
const value = await deon.parse('{ a one\nb [x, y] }');
// { a: 'one', b: ['x', 'y'] }
```

A value is one of exactly three shapes: a `string`, an array, or a plain object — an ordered map. Everything is a string, including the things that look like they should not be:

``` typescript
const value = await deon.parse('{ n 1.50\nb true }');
// { n: '1.50', b: 'true' }
```

`1.50` is the string `'1.50'` and not the number `1.5`, because a `deon` value is a string. When numbers are wanted, they are asked for — the `typer` yields booleans and numbers.

`parse` is asynchronous because a document may import a file or reach a URL, which is I/O. When a document is known to do neither, `parseSynchronous` reads it without a promise.

| method | what it does |
| --- | --- |
| `deon.parse(source)` / `deon.parseSynchronous(source)` | reads a document, resolving its imports, links, and entity calls |
| `deon.parseFile(path)` / `deon.parseFileSynchronous(path)` | reads a file, which grants the filesystem to it and to what it imports |
| `deon.parseLink(url)` | fetches a document over the network and evaluates it |
| `deon.parseSyntax(source, name)` | parses without evaluating, so nothing is loaded and nothing is reached |
| `deon.stringify(value)` / `deon.canonical(value)` | writes a value back out; `canonical` is the one form every implementation agrees on |
| `deon.lint(source, name)` / `deon.entities(source, name)` | the diagnostics that are advice rather than refusal, and what a document declares |
| `deon.loadEnvironment(path)` | reads a `.deon` file of strings into `process.env` |
| `typer(value)` | the conservative typer, which has booleans and numbers |

The tagged template `` deon`...` `` (and `deonSynchronous`) parses an inline document, and `DeonPure` / `deonPure` is the same reader with the filesystem and network removed entirely — a document it reads cannot import or reach anything, by construction rather than by permission.

A failure is a `DeonError`, carrying a `DiagnosticCode` and the diagnostics an editor would underline; a code and a position are normative, and the message is not.

## Capabilities

Nothing is granted that was not asked for. `deon.parse` reads a source string and resolves the imports it can — but `DeonPure` grants neither the filesystem nor the network, so a document it reads that imports is told it may not, a diagnostic rather than a surprise. Two failures are never confused: a capability that was never allowed is not the same as a resource that was allowed and failed.

## Install

``` bash
npm install @plurid/deon
```

The command line tool is the same surface as its siblings — `deon <file>`, `convert`, `environment`, `confile`, `exfile`, `lint` — installed globally:

``` bash
npm install -g @plurid/deon
```

## Building

``` bash
npm install
npm run build     # bundles the library and the tool into distribution/
npm test          # the conformance suite and the full test matrix
```

The tool is held to byte-identical behaviour against every other implementation by [`scripts/cli-harness.py`](../../scripts/cli-harness.py), and the library by [`scripts/harness.py`](../../scripts/harness.py).
