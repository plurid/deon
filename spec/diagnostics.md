# Deon 1.0 Diagnostic Catalogue

Diagnostics carry a stable code, severity, message, canonical source ID, UTF-8 byte offsets, one-based Unicode code-point line/column positions, related spans, and the resource import trace.

| Code | Meaning |
| --- | --- |
| `DEON_LEX_UNTERMINATED` | Unterminated string, comment, escape, or interpolation |
| `DEON_LEX_INVALID` | Character sequence cannot form a token |
| `DEON_PARSE_EXPECTED` | Required grammar element is absent |
| `DEON_PARSE_ROOT` | Document has no root or more than one root |
| `DEON_DUPLICATE_DECLARATION` | Import, injection, or leaflink name is repeated |
| `DEON_UNRESOLVED_LINK` | Leaflink or accessed member cannot be resolved |
| `DEON_CYCLE` | Declaration, import, interpolation, or call dependency cycle |
| `DEON_STRUCTURE_ARITY` | Structure row does not match its signature |
| `DEON_ENTITY_ARGUMENT` | Entity arguments are missing, extra, duplicate, or invalid |
| `DEON_TYPE_MISMATCH` | Operation received an incompatible Deon value |
| `DEON_CAPABILITY_DENIED` | Filesystem or network operation is not permitted |
| `DEON_RESOURCE_IO` | Resource cannot be read or returned a non-success status |
| `DEON_RESOURCE_FORMAT` | Imported resource encoding or content is invalid |
| `DEON_LINT_DUPLICATE_KEY` | Explicit map key is written more than once |

All codes except `DEON_LINT_DUPLICATE_KEY` have error severity. A parser throws or returns one `DeonError` containing every diagnostic it could collect without performing unsafe or ambiguous evaluation. A linter returns diagnostics without throwing. CLI lint exits successfully for warnings unless `--warnings-as-errors` is set.
