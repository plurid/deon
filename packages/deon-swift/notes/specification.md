# The seventh implementation is a binding, not a reading

The six implementations before this one — [`deon-javascript`](../../deon-javascript), [`deon-rust`](../../deon-rust), [`deon-python`](../../deon-python), [`deon-go`](../../deon-go), [`deon-c`](../../deon-c), [`deon-java`](../../deon-java) — were each written from `spec/SPECIFICATION.md`, `spec/deon.ebnf`, and `spec/diagnostics.md`, never from one another. A seventh reading in Swift was possible. This is not that. `deon-swift` **binds to `deon-c`** through a Clang module map over that package's own header, and calls its parser, its evaluator, and its canonical writer directly.

The reason is that a binding tests something a reading cannot. A reading asks whether the specification can be derived again; six of those have now agreed, and the marginal seventh reading proves less than the sixth did. A binding asks a different question: **is the C implementation's public surface a real boundary** — complete enough, and honest enough about ownership and lifetime, that another language can sit on top of it and still pass the same fixtures and the same differential harness the readings pass. If it is not, the binding fails in ways a second in-process reading never would. So this document is not a list of spec silences — the binding inherits `deon-c`'s answer to every one of those. It is a list of what the C boundary forced the Swift side to decide, and what that exercise found.

---

## The data model crosses the boundary as a tagged union, and Swift makes it an enum

A `deon` value is exactly one of three shapes — string, ordered list, ordered map — with booleans and numbers appearing only as the conservative typer's view (§14). On the C side that is a `deon_value` with a `kind` tag and a union; on the Swift side it is an `indirect enum DeonValue` with `.string`, `.list`, `.map`, and — for what `typed()` returns — `.bool` and `.number`. The map is a list of key/value pairs, not a dictionary, because §5 makes write order part of the map and a dictionary has none. Bridging is a recursive walk of the union that never has to decide anything the specification left open, because the C tree already decided it: the Swift value is a faithful copy of a tree that is already correct.

The one place the boundary needs care is the string. A `deon_str` is a pointer and a length, and the length is authoritative — a `deon` string may carry an embedded NUL, so reading it as a C string would truncate it. The bridge decodes exactly `len` bytes as UTF-8, so a string with a NUL in the middle survives the crossing.

## Ownership: the document is an arena, and the `Document` owns it

`deon-c` holds a whole parse in one arena and frees it with a single `deon_document_free`. Swift's `Document` class wraps that pointer and frees it in `deinit`, so the arena's lifetime is the object's lifetime and there is nothing for a caller to remember. The subtle part is the options. A parse error's span points back at the source-name string the caller passed in `deon_options`, and that string has to outlive the call — so the Swift wrapper `strdup`s every option string into a small retainer object that the `Document` holds, and frees them all together when the document goes. The C API is honest about this (the span is a borrowed pointer), and the binding is only safe because it is.

## The bytes stay bytes where the bytes matter

The library functions come in two Swift forms. Where a caller has text, it passes a `String`; where the command line tool has the raw bytes of a file or of a canonical output, it passes and receives `[UInt8]`, because a `deon` string is bytes and a UTF-8 round trip through `String` would corrupt a payload that is not valid UTF-8. The canonical writer, the stringifier, and the parser are all reached byte-for-byte, so `deon-swift`'s canonical output is `deon-c`'s canonical output — the same function, not a re-implementation that happens to agree.

## What Swift makes harder than C, and it is not the format

Two host frictions, neither about `deon`:

- **`fork()` is unavailable.** Swift's platform overlay refuses `fork()`, so the loopback server that the C network and cache tests run in a forked child runs here on a `pthread` instead. It binds only to `127.0.0.1`, never a routable address, exactly as the C tests do.

- **The environment table is spelled differently on each platform.** Enumerating the process environment for the `deon environment` command needs `environ` on Linux and `_NSGetEnviron()` on macOS, and Swift exposes neither uniformly — so the CDeon module ships a one-line C shim, `deon_environ()`, alongside the header it wraps. It is the only C written for this package, and it computes nothing about `deon`.

## The build compiles the sibling's sources rather than copying them

The Makefile compiles `deon-c`'s `.c` files to objects, compiles the Swift wrapper into the `Deon` module, and links them. It is `make` and not SwiftPM because SwiftPM will not reference a source file outside the package root, and copying the C sources in would let the copy drift from the original — which is the one thing a binding exists to prevent. The module map points at `deon-c`'s header in place, so a change to the C API is a compile error here, not a silent divergence.

## What was verified

- **All 70 required fixtures** pass with the right code *and* position (`make test`), including the round-trip invariant `parse(canonical(v)) == v` and the code-point-column and move-on-rewrite invariants the manifest cannot express. The runner carries its own typed JSON reader, because the library's flattens every scalar to a string, and the `typed` and `datasign` fixtures assert that a boolean is a boolean and a number is a number.

- **The differential harness** ([`scripts/harness.py`](../../../scripts/harness.py)) drives all 180 requests through every implementation and reports that `deon-swift` agrees with the six that came before it character for character; the CLI harness ([`scripts/cli-harness.py`](../../../scripts/cli-harness.py)) holds the tool to byte-identical exit status, standard output, files written, and diagnostic code and position across all seven.

- **The loopback network and cache tests** (`make network`, `make cache`) drive an import, a link, a non-success status, a denial, and the credential-keyed response cache through the same C socket and digest code `deon-c` tests, reached across the binding.

The seventh implementation changed nothing about what `deon` means, and it could not have — it runs the sixth-and-earlier readings' shared C core. What it establishes is that that core is a genuine boundary: a second language can stand on `deon-c`'s public header and pass everything the readings pass, which is the claim a binding is for.
