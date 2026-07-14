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

`DEON_LEX_INVALID` also covers a sequence that forms a perfectly good token and is illegal in the position it was written in — specifically, a name. `a.b` is a valid unquoted string anywhere a value is wanted, and no name at all: the character class of a name (section 4.4) is narrower than that of a string. A key or a declaration name that is outside it reports `DEON_LEX_INVALID`, and not `DEON_PARSE_EXPECTED`, because what is wrong is the sequence rather than the absence of something the grammar required.
