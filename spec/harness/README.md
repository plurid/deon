# The cross-implementation harness

Every implementation runs `conformance/cases.json` for itself, and passing it proves that the implementation agrees with the fixtures. It does not prove that the implementations agree with **each other**.

The difference is not academic. `deon-python` passed all 47 fixtures while indenting a map inside a map inside a map twice as far as its siblings did, because no fixture nested that deeply. A suite written alongside an implementation tests what its author thought to test; only a second implementation tests what the first one assumed.

So this harness asks a different question. It sends the *same input* to every implementation and requires the *same output* — character for character.

## The protocol

An adapter reads newline-delimited JSON on standard input and writes one newline-delimited JSON response per request to standard output. It is a filter: no arguments, no state between lines.

**Every value in a request and a response is a string.** Not because that is elegant, but because a Deon value is a string (section 2), so an adapter can be written with the implementation's own JSON reader and needs no third-party decoder to take part. `"true"` is a boolean, `"4"` is a number, and nobody has to negotiate.

### Request

```json
{
  "id": "case-name",
  "op": "canonical",
  "source": "{ a one }",
  "sourceName": "main.deon",
  "filebase": "/project",
  "files": { "/project/child.deon": "{ n 1 }" },
  "environment": { "HOME": "/somewhere" },
  "absolutePaths": { "/logical/*": "/host" },
  "allowFilesystem": "false",
  "allowNetwork": "false",
  "stringifyOptions": { "readable": "false", "leaflinks": "true" }
}
```

Only `id`, `op`, and `source` are required.

| `op` | the result |
| --- | --- |
| `canonical` | the canonical form of the evaluated document |
| `stringify` | the evaluated document, written with `stringifyOptions` |
| `typed` | the conservative typer's view, as JSON text |
| `lint` | `[{ code, line, column }]`, as JSON text |
| `entities` | `[{ name, parameters, kind }]`, as JSON text |

`canonical` is the load-bearing one. Canonical form is required to be identical across implementations, character for character (section 13), and it encodes the value, the map order, and the chosen form of every string in a single string. One comparison covers all of it.

### Response

```json
{ "id": "case-name", "ok": "true", "result": "{\n    a one\n}\n" }
```

or, when the document is refused:

```json
{ "id": "case-name", "ok": "false", "code": "DEON_LEX_UNTERMINATED", "line": "1", "column": "7" }
```

A refusal is a *result*, not a crash: an implementation that cannot read a document must say so with a code and a position, and the harness compares those exactly as it compares a value.

An adapter must never let a host exception escape. A `RecursionError`, an `OSError`, or a JSON decoder's own complaint is the host leaking through, and the harness will report it as a disagreement — correctly, because it is one.

## Running it

```bash
python3 scripts/harness.py
```

It builds the adapters, drives every conformance case and every differential probe through all three implementations, and reports any input on which they do not agree.
