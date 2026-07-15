# What the sixth reading found — and the one place UTF-16 fights the format

`deon-java` is the sixth implementation, and like the readings before it, it was written from `spec/SPECIFICATION.md`, `spec/deon.ebnf`, and `spec/diagnostics.md` — never from the five implementations that already existed. The value of a sixth reading is the same as the fifth's: it tests what the earlier readings, and the amendments they produced, still leave under-determined or say wrong.

The short version: **the specification held.** Every gap the third, fourth, and fifth readings recorded ([`deon-python`](../../deon-python/notes/specification.md), [`deon-go`](../../deon-go/notes/specification.md), [`deon-c`](../../deon-c/notes/specification.md)) was already amended, and this reading derived the amended behaviour from the prose. The quote-region rule of §4.3 — that a `'` or `` ` `` inside an unquoted value opens a literal, still-decoded region rather than ending the value — was implementable straight from the amended text. No new normative gap surfaced.

What follows is not a list of spec silences; it is what a from-the-specification implementation in Java has to decide for itself, because they are properties of the host language and not of the format. One of them is a genuine trap that the other five hosts do not have.

---

## The one that bites: canonical order is code points, and Java strings are not

§13 fixes canonical form as maps sorted by code point. The C, Go, Rust, and Python implementations get this for free: their strings are byte sequences or code-point sequences, and UTF-8 byte order is exactly code-point order. Java strings are **UTF-16**, and `String.compareTo` compares by `char` — 16-bit code units. For any key in the range U+10000 and above, the UTF-16 encoding uses a surrogate pair beginning at 0xD800, which sorts *before* a BMP character in U+E000–U+FFFF. So `""` and `"𐀀"` (U+10000) compare in the opposite order under `String.compareTo` to the order the specification requires.

The obvious implementation — `keys.sort()` or `keys.sort(String::compareTo)` — is therefore wrong for a document whose map keys include astral characters, and it is wrong silently, because no conformance fixture nests an emoji into a canonical key. `deon-java` sorts canonical keys by their **UTF-8 byte encoding**, which is code-point order by construction and matches the five siblings character for character. This is the one place where writing the natural Java produces a canonical form that disagrees with the format, and it is worth stating plainly for the seventh implementer, whoever they are, if their host string is UTF-16 too.

## Memory and errors: exceptions are the natural boundary

Where the C reading needed an arena and `setjmp`/`longjmp` to get exception-shaped control flow without leaks, Java has both for free: the garbage collector owns lifetime, and a `DeonException` is thrown and caught. The re-anchoring §9 requires — a diagnostic from an imported resource reported at the line that imported it — is a `try`/`catch` that rebuilds the exception with the importing statement's span, unless the code is `DEON_CYCLE`, which keeps its own. Nothing but a `DeonException` is caught this way; a host failure is a different exception and is left to propagate, so a bug cannot be reported as a bad document.

## The ordered map is `LinkedHashMap`, but its `put` is the wrong `put`

A `deon` map's write order is part of it, and §5 requires a rewritten key to move to its **final** write position. `HashMap` forgets order; `LinkedHashMap` keeps insertion order but leaves a re-`put` key in its original slot — the wrong place. So `DeonMap.set` does `remove` then `put`, which re-appends the key at the end. Equality is order-independent, because order is presentation, not identity.

## Positions count code points; offsets count bytes

§ diagnostics distinguish a column (one-based, code points) from a span offset (bytes). The scanner decodes the source into an `int[]` of code points with a parallel array of UTF-8 byte offsets, so a column counts code points and an offset counts bytes without either being derived from the other — `{ ключ value }` reports its column at `2:5`, five code points in.

## The network and the digest come from the standard library

Zero third-party dependencies, the house rule. Java makes this easy where C had to hand-roll: `java.net.http.HttpClient` is the network client (and brings TLS, which the C socket implementation does not have), and `java.security.MessageDigest` is the SHA-256 for the credential-digest cache key `sha256(name + NUL + token)`. There is no JSON decoder in the standard library, so the JSON reader of §9.1 is written by hand — which is required anyway, because a stock decoder would collapse `1.50` to `1.5` and lose the source spelling the specification preserves.

## What was verified

- **All 70 required fixtures** pass with the right code *and* position (`make test`), including the round-trip invariant `parse(canonical(v)) == v` and the code-point-column and move-on-rewrite invariants the manifest cannot express. The runner carries its own typed JSON reader, because the library's flattens every scalar to a string.

- **The differential harness** ([`scripts/harness.py`](../../../scripts/harness.py)) drives all 180 requests through every implementation and reports that `deon-java` agrees with `deon-javascript`, `deon-rust`, `deon-python`, `deon-go`, and `deon-c` character for character; the CLI harness ([`scripts/cli-harness.py`](../../../scripts/cli-harness.py)) holds the tool to byte-identical exit status, standard output, files written, and diagnostic code and position across all six.

The sixth reading changed nothing about what `deon` means, and — like the fifth — it found nothing the specification says wrong or leaves unsaid. It did surface one host hazard worth recording: a UTF-16 language must sort canonical keys by code point explicitly, because its natural string comparison is by code unit, and the two disagree above the basic plane.
