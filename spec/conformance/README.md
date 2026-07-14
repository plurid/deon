# Deon Conformance Fixtures

`cases.json` is language-neutral. Every implementation must execute all cases with `required: true`. Additional implementation tests may extend but never reinterpret these fixtures.

Expected values use JSON because a Deon value is a string, a list, or a map: a JSON string is the Deon string, a JSON array the Deon list, and a JSON object the Deon map. A JSON number, boolean, or `null` appears in an expected value only where a case asserts `typed`, the conservative typer of section 14 being the one place a Deon value becomes something other than a string.

## The shape of a case

| Field | Meaning |
| --- | --- |
| `id` | The name of the case, unique within the manifest. |
| `required` | The case must pass for the implementation to conform. |
| `source` | The document, parsed directly. |
| `file`, `files` | The document is `files[file]`, and `files` is the complete set of resources. |
| `environment` | The evaluation environment read by `#$NAME`. |
| `options` | Parse options, such as `absolutePaths`, `allowFilesystem`, or `allowNetwork`. |
| `expected` | The evaluated root. |
| `error` | The diagnostic code the evaluation must fail with. |
| `position` | The one-based line and column the diagnostic must point at. |
| `canonical` | The canonical form of the document (section 13). |
| `stringify` | The `options` to stringify the evaluated root with, and the `expected` text. |
| `typed` | The evaluated root after the conservative typer (section 14). |
| `lint` | Diagnostic codes the linter must report without failing the evaluation. |

Every case asserts at least one of `expected`, `error`, `canonical`, `stringify`, `typed`, or `lint`. A case that asserted nothing would pass whatever the implementation did.

## Resources and the host

A case carrying `files` is served entirely from that manifest, with the filesystem and the network denied. A harness must not reach a public network service.

Two cases deliberately involve the host, and neither reaches a network:

- `capability-denied-network` names an `https` target while the network is denied. It must fail before any request is made, which is what proves that network access requires an explicit option (section 9).
- `resource-io-unreadable` grants the filesystem and names a path that cannot exist, so the read fails. It is the only case that touches a local filesystem, and it does so only to observe the failure.

## Coverage

The fixtures exercise every code in `diagnostics.md`. A conforming implementation reports the same code, at the same source position, for the same invalid document: a code on its own is not conformance, because a diagnostic an editor cannot place is a diagnostic it cannot show (section 15).
