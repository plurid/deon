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
  "budgets": { "expansion": "1000" },
  "stringifyOptions": { "readable": "false", "leaflinks": "true" }
}
```

Only `id`, `op`, and `source` are required.

`budgets` sets host-configurable resource limits (§11). Each value is a string count; an absent budget takes the specification's default. `expansion` bounds the code points an evaluation may produce by substitution — the guard against a *billion-laughs* blow-up — and a document that exceeds it is refused with `DEON_LIMIT_EXCEEDED` at the start of the source (`start` `0`, line 1, column 1).

| `op` | the result |
| --- | --- |
| `canonical` | the canonical form of the evaluated document |
| `stringify` | the evaluated document, written with `stringifyOptions` |
| `typed` | the conservative typer's view, as JSON text |
| `datasign` | the document typed against `datasignFiles` and `datasignMap` (§14.1), as JSON text |
| `lint` | `[{ code, line, column }]`, as JSON text |
| `entities` | `[{ name, parameters, kind }]`, as JSON text |

`canonical` and `stringify` are compared **character for character**, which is their whole point. The rest are compared as *parsed structures*, because seven implementations are not required to have chosen the same JSON whitespace — but a boolean is never flattened into the string `"true"`, since telling those apart is exactly what the typing operations exist to do.

`datasign` carries two extra fields: `datasignFiles`, the contracts to read, and `datasignMap`, the root keys each type applies to. The contracts themselves arrive through `files`, like every other resource, so no adapter reaches a disk.

A probe that expects a *refusal* must isolate the fault it is probing. The harness compares the code and the position, and not the message, so a document that is wrong in two ways reports the same code either way. The number probes each supply a complete entity for exactly this reason: an incomplete one fails on the missing field before the number is ever looked at, and the probe would then pass no matter what the numeric grammar did.

`canonical` is the load-bearing one. Canonical form is required to be identical across implementations, character for character (section 13), and it encodes the value, the map order, and the chosen form of every string in a single string. One comparison covers all of it.

### Response

```json
{ "id": "case-name", "ok": "true", "result": "{\n    a one\n}\n" }
```

or, when the document is refused:

```json
{ "id": "case-name", "ok": "false", "code": "DEON_LEX_UNTERMINATED", "severity": "error", "start": "6", "line": "1", "column": "7", "related": [] }
```

A refusal is a *result*, not a crash: an implementation that cannot read a document must say so with a code, a severity, and a position, and the harness compares those exactly as it compares a value. The position is a UTF-8 **byte offset** (`start`) into the CRLF-normalized source, alongside a 1-based `line` and a code-point `column`; the byte offset is measured the same way by every implementation, so a non-ASCII character before the fault can no longer shift one implementation's offset out of step with the others.

A diagnostic may also carry **`related`** spans — a list, each a second place the reader is sent to look. The clearest case is a duplicate declaration, whose diagnostic points at the repeat and whose one related span points at the original:

```json
{ "id": "case-name", "ok": "false", "code": "DEON_DUPLICATE_DECLARATION", "severity": "error", "start": "10", "line": "2", "column": "1", "related": [["0", "1", "1"]] }
```

Each related span is a `[start, line, column]` triple in the same three measures as the primary — the UTF-8 byte offset, the 1-based line, the code-point column — and the list is compared in order (`spec/diagnostics.md`). An implementation that carries no related span reports `[]`, which every implementation must still agree on.

An adapter must never let a host exception escape. A `RecursionError`, an `OSError`, or a JSON decoder's own complaint is the host leaking through, and the harness will report it as a disagreement — correctly, because it is one.

## Running it

```bash
python3 scripts/harness.py
```

It builds the adapters, drives every conformance case and every differential probe through all seven implementations, and reports any input on which they do not agree.
