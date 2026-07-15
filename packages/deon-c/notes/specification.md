# What the fifth reading found — and what C made the harness prove

`deon-c` is the fifth implementation, and like the two before it, it was written from `spec/SPECIFICATION.md`, `spec/deon.ebnf`, and `spec/diagnostics.md` — never from the four implementations that already existed. The value of a fifth reading is the same as the value of the fourth: it tests what the earlier readings, and the amendments they produced, still leave under-determined or say wrong.

The short version: **the specification held.** Every gap the third reading ([`deon-python/notes`](../../deon-python/notes/specification.md)) and the fourth reading ([`deon-go/notes`](../../deon-go/notes/specification.md)) recorded was already amended, and this reading derived the amended behaviour from the prose without having to consult a sibling. That is the amendments working. In particular the headline finding — that a `'` or `` ` `` inside an unquoted value opens a literal, still-decoded *region* rather than ending the value (§4.3) — was implementable straight from the amended §4.3, and the parser was written to the region model on the first pass rather than being rewritten to it after failing the corpus, which is exactly the difference the amendment was meant to make.

No new normative gap surfaced. What follows is not a list of spec silences; it is what a from-the-specification implementation in C has to decide *for itself* that the specification correctly does not speak to, because they are properties of the host language and not of the format.

---

## The data model has no home in C, so it is built rather than borrowed

The reference languages each had a shape to lean on: JavaScript has objects, Rust has enums, Python and Go have maps. A `deon` value is string | ordered-list | ordered-map, and C has none of the three. So the value is a tagged union built by hand, and the map is a **pair of parallel arrays with a move-on-rewrite insert**, not a hash table — because §5's last-write-wins moves a rewritten key to its final write position, and a hash table would forget the order that is part of the value. The two typer-only kinds (boolean, number) share the union but never appear in a parsed value; they exist only as the output of `deon_typed` and the datasign contract, exactly as §14 requires.

## Memory and errors are one decision, not two

C has neither exceptions nor a garbage collector, and the two absences are answered together. Every node, value, and string of one operation is allocated from a single **arena** and freed as a unit by `deon_document_free`, which removes the whole class of per-node lifetime bugs — nothing is freed twice, nothing outlives its owner. Diagnostics are raised with **`setjmp`/`longjmp`**: `deon_fail` records a code, a message, and a span and jumps to the nearest boundary. Because everything the operation allocated lives in the arena, a `longjmp` out of a deeply recursive parser leaks nothing, which is what makes the exception-shaped control flow safe without an exception.

The one place this needed care is re-anchoring. §9 requires a diagnostic from an imported resource to be reported at the span of the *importing statement*, not at the fault's own location. With no exceptions to catch and rethrow, the interpreter installs a **nested `setjmp` around each import**, saves and restores the `jmp_buf` with `memcpy`, and on catch re-anchors the span (unless the code is `DEON_CYCLE`, which keeps its own) before re-raising to the outer boundary. Datasign does the same to free its malloc-backed contract table before propagating a type mismatch.

## Positions count code points; offsets count bytes; the source is decoded once

§ diagnostics distinguish a column (one-based, code points) from a span offset (bytes). The scanner decodes the UTF-8 source into a parallel array of runes with per-rune byte offsets, line, and column, so a column counts code points and an offset counts bytes without either being derived from the other — `{ ключ value }` reports its column at `2:5`, five code points in, not at the byte the key ends on. Each string form collects the raw source it spans and **decodes it once**, which is what lets a quote region keep its delimiters as literal source while an interpolation inside it is still resolved.

## The two things the specification leaves to the network, C writes by hand

Zero third-party dependencies is the house rule, and for C it has teeth: there is no standard JSON reader, no HTTP client, no crypto. So:

- **SHA-256 is hand-rolled** for the response cache. §9 requires a cache key to be a digest of the credential so a token never appears in a cache identifier in plain text and a document fetched under one credential is never served to the holder of another. The key is `sha256(name + NUL + token)`, and the SHA-256 is ~90 lines in `cache.c` with no library behind it. A cache entry is itself a canonical `deon` document — a round trip the format has to survive, and does, on every write and read.

- **HTTP is written over a socket.** The request is deliberately **HTTP/1.0 with `Connection: close`**, so the response body is everything the server sends before it closes and there is no chunked framing to unwrap without a client library. There is no TLS, so an `https` target it cannot reach is a `DEON_RESOURCE_IO` — allowed and failed — which is a different thing from `DEON_CAPABILITY_DENIED`, never allowed. The loopback test in `tests/network.c` binds only to `127.0.0.1`, never a routable address.

## What was verified

- **All 70 required fixtures** in `spec/conformance/cases.json` pass with the right code *and* position (`make test`), including the round-trip invariant `parse(canonical(v)) == v` and the code-point-column and move-on-rewrite invariants the manifest cannot express. The runner carries its own typed JSON reader, because the library's flattens every scalar to a string and the `typed`/`datasign` fixtures assert that a boolean is a boolean.

- **The differential harness** ([`scripts/harness.py`](../../../scripts/harness.py)) drives all 180 requests through every implementation and reports that `deon-c` agrees with `deon-javascript`, `deon-rust`, `deon-python`, and `deon-go` character for character; the CLI harness ([`scripts/cli-harness.py`](../../../scripts/cli-harness.py)) holds the tool to byte-identical exit status, standard output, files written, and diagnostic code and position across all five.

The fifth reading changed nothing about what `deon` means, and — unlike the third and fourth — it found nothing the specification says wrong or leaves unsaid. The amendments the earlier readings produced are why.
