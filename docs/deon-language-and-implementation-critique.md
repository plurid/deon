# Deon language and implementation critique

**Review date:** 2026-07-16

**Repository revision:** `d035142`

**Scope:** the normative language documents, conformance suites, C, Go, Java,
JavaScript/TypeScript, Python, Rust, and Swift packages, both editor/tooling
packages, and the root documentation.

## Executive assessment

Deon has a better validation foundation than most young data languages. It has a
normative specification, a machine-readable grammar, shared conformance cases,
independent implementations, a differential harness, conservative capability
defaults, deterministic canonical output, and explicit evaluation limits. At the
reviewed revision, all 228 differential requests and all 27 CLI cases agree.
Those are substantial strengths.

That agreement does not yet mean that the language contract and all implementations
agree. The shared suites omit several contract boundaries. Additional probes found
three observable cross-implementation divergences:

1. interpolated quoted names have different meanings;
2. relative paths with unmatched parent segments resolve differently; and
3. URL resources with a query or fragment are classified differently.

There are also contract-wide problems which differential testing cannot expose when
every implementation makes the same choice. Diagnostics do not implement the
normative multi-diagnostic/import-trace model, JavaScript reports UTF-16 indices
where the specification requires UTF-8 byte offsets, raw control characters survive
canonical output, and depth limits do not bound width, import count, source size, or
output size.

The most urgent implementation issue is outside the language runtimes: the MCP
server's documented filesystem-root boundary is not applied to nested Deon resource
loads and its lexical path check is not a symlink boundary. The C network client,
which Swift inherits, is also not suitable for a feature described as HTTP(S): it
only implements plaintext HTTP and manually constructs requests from unvalidated
values.

The recommended direction is not a rewrite. Preserve the pure data model,
capability-denied defaults, canonical form, and shared fixtures. First close the
security boundaries and promote the new edge cases into normative fixtures. Then
turn resource resolution and diagnostics into explicit, deep modules in every
implementation. Consider syntax simplification and type-model changes only in a
future major language version.

## Method and confidence labels

This review used four kinds of evidence:

- **V — verified:** reproduced by building/running implementations or harnesses.
- **S — static:** directly established by a reachable code path, but not exercised
  against an external service during this review.
- **C — contract:** contradiction or omission between normative documents and tests.
- **D — design:** a language tradeoff, not necessarily an implementation defect.

The following baseline passed at this revision:

| Check | Result |
| --- | --- |
| Shared conformance catalogue | 98 cases: 83 required core and 15 optional datasign |
| Differential probe catalogue | 124 probes producing 228 implementation requests |
| Differential harness | All 228 requests agreed across all adapters |
| CLI harness | All 27 cases agreed; 7 differed only in human-readable wording |
| Implementation topology | Six independent implementations plus Swift binding the C implementation |

The principal commands were `python3 scripts/harness.py` and
`python3 scripts/cli-harness.py`. Focused validation also passed Rust's
`cargo test --all-features`, Swift's conformance/depth/cache and loopback-network
targets, and all 17 MCP tests. The legacy grammar package could not be rebuilt in the
review environment because its Yarn dependencies were unavailable; its findings are
therefore static. No live public-network dependency was used.

The passing baseline is important, but it tests agreement more thoroughly than it
tests the complete normative contract. New cases should normally enter
[`spec/conformance/cases.json`](../spec/conformance/cases.json), not only the
differential probes, because independent implementations can agree on the same
incorrect interpretation.

## Priority findings

| Priority | Kind | Finding | Main location |
| --- | --- | --- | --- |
| P0 | V/S | MCP filesystem roots are not enforced for nested imports/datasign reads; symlink containment is also not real | `packages/tooling/deon-mcp/source/options.ts`, `resources.ts` |
| P0 | S | C/Swift networking is plaintext-only despite HTTP(S) documentation, and manually interpolates request target and authorization data | `packages/deon-c/source/deon/network.c` |
| P0 | S | The kubectl helper embeds generated JSON in a shell command, allowing quoting breakage and command injection | `usages/kubectl/source/kubectl-deonly-source-node.js` |
| P1 | V/C | Interpolation in quoted names produces different keys and declaration names | `spec/deon.ebnf`, `spec/SPECIFICATION.md`, all parsers |
| P1 | V | C, Java, and Swift discard unmatched leading `..` during relative-resource normalization | C/Java interpreters; Swift inherits C |
| P1 | V | C, Java, and Swift include a URL query/fragment when deciding resource format | C/Java interpreters; Swift inherits C |
| P1 | C/V | The normative diagnostic shape is not implemented; JavaScript offsets are not UTF-8 byte offsets | `spec/diagnostics.md`, diagnostic APIs, JS scanner |
| P1 | S/C | Rust and Swift decide whether a value is callable from raw syntax provenance, not the evaluated value | Rust evaluator and C evaluator inherited by Swift |
| P1 | S | Swift `Document.value()` can force-unwrap a null C root after failure | `packages/deon-swift/Sources/Deon/Deon.swift` |
| P1 | D/S | Depth limits do not prevent wide expansion, resource-count, source-size, or output-size exhaustion | evaluators and resource loaders |
| P1 | S | Initial-file invalid UTF-8 is replaced rather than rejected in several APIs | C, Go, Java, and likely JS file entry points |
| P2 | S | Python and Java mutate caller-owned parse options, including filesystem capability state | public entry points in both packages |
| P2 | C | Canonical output is called both conservative and the “shortest” form, but fixtures enforce the conservative form | specification §13–14 and fixtures |
| P2 | S | The older language server and TextMate grammar are prototypes, not reliable language tooling | `packages/tooling/deon-grammar` |
| P2 | C | Root and package documentation contains invalid examples and obsolete implementation counts | root/package READMEs and notes |

## 1. Normative language contract

### 1.1 There are too many simultaneous normative sources

[`spec/SPECIFICATION.md`](../spec/SPECIFICATION.md) states that the prose, EBNF,
diagnostic catalogue, and fixtures are all normative (`SPECIFICATION.md:5`). That
only works if conflicts have a defined resolution rule. Today they conflict and no
precedence is specified.

The clearest example is a quoted name. The prose says names are compared after
unquoting and escape decoding (`SPECIFICATION.md:72-75`) and the evaluation stages
collect declaration names before interpolation. The grammar defines
`quoted-name = single-string` (`deon.ebnf:89-91`), while `single-string` includes
interpolation (`deon.ebnf:65,70`). Implementations consequently make two reasonable
but incompatible choices.

This input was used as a custom probe:

```deon
n x
{ 'a#{n}' value }
```

C, Go, Java, and Swift produce key `a`; JavaScript, Python, and Rust produce the
literal key `a#{n}`. Neither group can be called conformant until the contract chooses
one meaning.

**Better option:** make names a distinct lexical form. Permit ordinary name escapes,
explicitly forbid interpolation, and define declaration collection on decoded names.
Names are identifiers, not value-producing expressions; interpolating them creates
staging and duplicate-declaration problems for little expressive value. Add required
fixtures for quoted map keys, declaration names, access segments, structure headers,
and entity parameter names.

Also add a short normative-precedence section. A sensible order is:

1. prose algorithms and data model;
2. conformance fixtures for observable examples;
3. EBNF for syntax shape; and
4. the diagnostic catalogue for diagnostic identity and position.

Any conflict should be treated as a specification bug, but implementations need a
deterministic answer while it is being corrected.

### 1.2 The grammar is descriptive, not a complete normative grammar

The EBNF defers important token-boundary rules to prose (`deon.ebnf:1-4`) and has
concrete mismatches:

- Prose says an unknown escape is preserved (`SPECIFICATION.md:68`). The unquoted
  grammar permits backslash only through a known `escape` at the first position
  (`deon.ebnf:58-63,84-87`). All tested implementations nevertheless accept a
  leading `\q` and preserve it, so the grammar rejects a shared accepted program.
- `trivia` can consume newlines while `separator` separately requires a newline
  (`deon.ebnf:94-100`), making newline ownership ambiguous.
- The structure production requires at least one row (`deon.ebnf:28-31`), while the
  prose does not clearly state whether an empty structure is invalid.
- Context-sensitive comment boundaries, interpolation, several string forms, and
  name-specific restrictions make a compact EBNF look more authoritative than it is.

**Better option:** either make the grammar executable and test every production
against generated positive/negative cases, or explicitly call it an informative
grammar and put the scanner algorithm in prose. A normative PEG/tree-sitter-style
grammar would be more valuable to editor tooling than partly normative EBNF.

### 1.3 “Canonical” is deterministic, but not shortest

The stringification rules require quotes for apostrophes, backticks, `#`, and comment
markers even when an unquoted spelling could round-trip (`SPECIFICATION.md:202-216`).
The canonical section then says to use the “shortest unambiguous string form”
(`SPECIFICATION.md:218-230`). Fixtures such as
`unquoted-keeps-an-unbalanced-single-quote` enforce the conservative quoted spelling
in [`spec/conformance/cases.json`](../spec/conformance/cases.json).

The implemented conservative policy is the better policy. It is stable under nearby
edits and safer for generated configuration. The defect is the word “shortest.”

**Better option:** define canonical output as the **unique conservative form** and
list its choice order. If byte-minimal output is useful, expose it as a separate
compact serializer that is not the canonical identity representation.

The specification should also define value equality explicitly. Ordinary map output
retains the final write order, canonical output sorts keys, and map order is described
as presentational. Say directly whether equality ignores map order and whether
Unicode normalization participates. At present NFC and NFD spellings are distinct
but can look identical. Silent normalization of values would be risky; a linter
warning for non-NFC or confusable keys is safer.

### 1.4 Canonical output can contain raw control characters

The escape table names newline, carriage return, tab, slashes, quotes, and
interpolation punctuation, but provides no general Unicode/control escape. A raw NUL
was accepted by all probed implementations and survived canonical output.

That output is legal UTF-8 but is hostile to shells, editors, log processors, and
many text protocols. It also means the “canonical text” is not robust as an exchange
or hashing input outside a byte-clean channel.

**Better option:** add `\uXXXX` or `\u{...}` and require canonical escaping of C0/C1
controls, or reject unescaped controls at lexing time. The first option preserves the
full string model and is more interoperable. Add fixtures for NUL, escape, backspace,
and non-BMP code points.

### 1.5 Diagnostics promise more than any public implementation exposes

[`spec/diagnostics.md`](../spec/diagnostics.md) requires a stable source ID, UTF-8
byte offsets, one-based Unicode line/column, related spans, and an import trace
(`diagnostics.md:3-5,24`). The specification also says an imported resource's own
location appears in the trace (`SPECIFICATION.md:187-200`).

The implementations instead expose a single diagnostic without related spans or an
import trace. Examples include C (`api.c:35-45`), Go (`diagnostic.go:69-84`), and
JavaScript (`objects/Diagnostic/index.ts:55-105`). JavaScript explicitly takes the
first error and constructs a singleton result. The conformance tests assert only
code and line/column, and the differential protocol transports only code,
line, and column. Severity is declared normative but is not present in fixture
expectations.

Imported failures show that this is semantic, not merely a missing convenience
field. Rust propagates a child's diagnostic unchanged
(`core/src/interpreter.rs:471-474`), so a malformed imported document reports the
child location. The spec requires the primary diagnostic at the importing statement
and the child location in an import trace (`SPECIFICATION.md:187-200`). Rust's
diagnostic type cannot represent that result (`core/src/diagnostic.rs:103-138`), and
the other public models have the same structural limitation.

The normative sources also disagree about entity-argument positions.
`SPECIFICATION.md:197` says every entity-argument fault anchors at the opening `(`.
The arity-mismatch fixture follows that rule (`cases.json:257-264`), but the repeated-
argument fixture expects the second argument at column 30 (`cases.json:267-274`).
Choose one rule and correct the other source; the opening-parenthesis rule gives a
stable call-level anchor, while a related span can identify the repeated argument.

There is a second position problem: scanners commonly normalize CRLF before storing
indices. An offset into normalized text is not an offset that slices the caller's
original source. JavaScript additionally indexes source strings in UTF-16 code units.
For a second-root error following `😀`, JavaScript reported offset 9 where the
normative UTF-8 byte offset is 11.

**Better option:** choose and fully test one diagnostic contract:

- retain the rich contract, make `DiagnosticSet` the public Interface, preserve an
  original-byte offset map through normalization, and attach import frames; or
- specify first-fatal-only diagnostics and remove the unsupported fields from the
  normative model.

The first option has more Leverage for IDEs and import debugging. Whichever is chosen,
add full diagnostic objects to fixtures and the differential protocol, including
severity, source ID, start/end byte offsets, related spans, and trace ordering. LSP
adapters must explicitly convert the language's UTF-8/code-point coordinates to the
LSP's UTF-16 coordinates.

### 1.6 Resource resolution is underspecified at exactly the difficult edges

The capability model is one of Deon's best language features: filesystem and network
access are denied by default, environment is injected rather than inherited, raw
parse performs no I/O, and authorization is explicit. The remaining contract does
not define enough of the resolver algorithm.

Missing or ambiguous points include URL normalization, query/fragment handling for
extension detection, permitted schemes, redirect and credential-forwarding policy,
percent encoding, default ports, file-path platform rules, symlink/realpath behavior,
and how leading `..` behaves in relative logical IDs. `absolutePaths` also sounds like
a host-path permission, but is used as logical-target remapping; “resource aliases” or
“mounts” would communicate the abstraction better.

Two custom probes demonstrate the effect:

- From source ID `project/main.deon`, resolving `../../x` with an in-memory resource
  `../x.deon` succeeds in Go, JavaScript, Python, and Rust, but C, Java, and Swift
  return `DEON_CAPABILITY_DENIED`. C and Java discard an unmatched leading `..`;
  Swift inherits C.
- Importing `https://example.com/x.deon?rev=1` from an in-memory resource succeeds in
  Go, JavaScript, Python, and Rust, but C, Java, and Swift return
  `DEON_RESOURCE_FORMAT`. C and Java say they strip query/fragment but classify the
  complete target; Swift again inherits C.

**Better option:** write a normative, platform-neutral resource-resolution algorithm
whose output is `(canonical ID, resource kind, format, new filebase, authorization
scope)`. Classify URL formats from the pathname only. Preserve unmatched `..` for a
relative logical ID, reject traversal only at a concrete capability boundary, and
define rooted-path behavior separately. Add a shared resolver-vector corpus rather
than testing resolution only through full evaluation.

For security, specify redirect limits and prohibit forwarding credentials across an
origin change without a second authorization decision. Require URL targets and
credential values to reject CR/LF and other request-structure controls.

### 1.7 The evaluation limit is not a resource budget

The 128-depth rule and iterative writer/type guards are good protection against stack
overflow (`SPECIFICATION.md:179-185`). They do not bound:

- source bytes or decoded characters;
- syntax/value node count;
- number or total bytes of imported resources;
- entity call count or total expanded values;
- output bytes; or
- map/list width.

A shallow entity tree can expand exponentially while remaining under the depth
limit. A resolver can return arbitrarily large resources, and canonicalization must
retain/sort large maps.

**Better option:** define host-configurable budgets with normative failure semantics:
maximum input bytes, total resource bytes/count, nodes, entity expansions, container
entries, and output bytes. Add `DEON_LIMIT_EXCEEDED`; overloading
`DEON_PARSE_EXPECTED` for host and depth limits obscures cause and recovery.

### 1.8 Data-model tradeoffs should be stated more honestly

#### Strings as the only scalar

No intrinsic null, boolean, or number avoids implicit coercion and preserves exact
spellings. That is valuable for configuration. It also collapses absent environment,
explicit empty string, and a null-like value; makes JSON round-trips type-lossy; and
moves basic contracts into the optional datasign layer.

The safest evolution is not automatic scalar guessing. Either keep the string-only
core and make schemas a first-class, separately versioned facility, or add explicitly
tagged scalars in a major version. Do not reinterpret existing `true`, `01`, or
`null` spellings based on appearance.

#### Duplicate map keys

Direct duplicate keys are allowed, last write wins, and the winner moves to the end;
the linter only **SHOULD** warn (`SPECIFICATION.md:76-82`). This is convenient for
overlay construction but dangerous for hand-written configuration, where a duplicate
is usually a typo. It is also inconsistent with duplicate declarations being fatal.

A future strict profile should reject direct duplicate keys. Deliberate replacement
can remain available through spread or an explicit override operator. At minimum,
make the warning mandatory and expose a warnings-as-errors mode.

#### Structures

Structures are compact table syntax for a list of similarly shaped maps. Applying the
deletion test, removing them eliminates a special newline/arity grammar and a sizeable
parser surface while leaving the same data easy to express. Their benefit is mostly
presentation, and they complicate syntax highlighting and diagnostics.

Keep them for 1.x compatibility, but measure real use before retaining them in a 2.0
core. A formatter/editor sugar that lowers to ordinary list-of-map syntax may provide
the same benefit with a smaller language.

#### String spread and shortened links

Spreading a string into a list/map is clever but surprising, especially because
“character” needs a precise Unicode definition. Shortened map links infer the target
key from the final access segment, saving few characters while making meaning depend
on context. Both features increase parser/interpreter and teaching cost more than
their likely use warrants. Prefer an explicit string-to-codepoints operation outside
the data notation and explicit map keys in a future simplification.

#### Entity parameters

Inferring an entity's required parameters from every interpolation name is concise,
but turns ordinary template text into an implicit signature. There are no defaults or
optional parameters, and name interpolation would make declaration collection even
more phase-dependent. If entities grow beyond simple substitution, use explicit
parameter lists and an explicit `template` construct rather than accumulating
contextual rules.

There is a more immediate value-semantics problem. The spec says a string, map, list,
or leaflink value may be called (`SPECIFICATION.md:150-162`), which implies that
callability is a property of the evaluated value. Rust instead walks raw AST nodes to
derive parameters (`core/src/evaluator.rs:415-416,489-545,575-610`), omitting values
reached through link aliases or introduced by spread. Rust and Swift both reject a
callable string reached through an alias and a callable map member introduced through
a spread. Either the spec must deliberately restrict call targets by syntax
provenance, which would be surprising and difficult to explain, or evaluators must
carry template/callable metadata with evaluated values. The latter preserves the
language's value-oriented description and should become shared conformance cases.

### 1.9 Datasign is too tightly coupled to the core specification

The optional typing section embeds a partial parser for another format and explicitly
does not support all of that format's composition/import features
(`SPECIFICATION.md:232-257`). This increases core-spec surface and makes behavior
depend on an external language whose version is not pinned.

**Better option:** move datasign to a separately versioned adapter specification with
its own conformance manifest. The Deon core should define only a schema/typing
Interface and failure semantics. A datasign adapter can then state the exact datasign
version and supported subset without making those details part of Deon syntax.

## 2. Implementation critique

### 2.1 Cross-implementation architecture

Independent implementations are an excellent specification test. The current layout
actually provides six independent readings and one binding, because Swift compiles
the C implementation (`packages/deon-swift/Makefile:1-7`). Documentation and quality
claims should distinguish those facts.

The cost is duplicated scanner, parser, evaluator, canonicalizer, resolver, and
diagnostic logic—roughly 42,000 lines across implementations and tests in the reviewed
tree. The exact path and URL bugs above appear in more than one implementation because
the difficult algorithms have broad, duplicated Interfaces rather than shared vector
contracts.

A useful long-term split is:

- a **conformance tier** of two or three genuinely independent implementations that
  continue to challenge the specification; and
- a **binding tier** for ecosystems that value identical behavior and low maintenance,
  built over a stable C, Rust, or WASM core with host-provided I/O adapters.

Swift already demonstrates the binding model. Do not collapse every implementation
to one core: that would remove the independent readings that make the differential
harness valuable.

### 2.2 C

Strengths include a small public API, explicit option copying in most paths, a
standalone UTF-8 implementation, and applicability as a binding core.

Main issues:

- `source/deon/network.c:25-29,74-77` explicitly implements plain HTTP only: no TLS,
  redirects, or chunked transfer, despite project examples and descriptions using
  HTTPS.
- `network.c:128-141` manually places the target in the request line and an arbitrary
  authenticator after `Authorization: Bearer`. Deon strings can contain CR/LF, so
  network-enabled callers need validation against header/request injection. The
  plaintext transport makes authorization particularly unsafe.
- The client has fixed host/port buffers and unbounded response accumulation. A
  no-third-party-dependency goal is reasonable for the pure parser, but not a good
  reason to maintain a partial HTTP/TLS stack.
- `interpreter.c:420-455` contains both verified resolver defects and a fixed
  256-segment normalization stack; extra segments are silently ignored.
- `api.c:78-111` reads an initial file and parses bytes without first rejecting
  invalid UTF-8. The decoder replaces malformed input.
- The public diagnostic result is a singleton and lacks the normative trace/related
  spans (`api.c:35-45`, public `deon.h:99-111`).

**Recommendation:** keep the C core pure and inject filesystem/network loaders. Make
the built-in network feature experimental or disable it until it uses a vetted host
HTTP client with TLS, redirect policy, response limits, and control validation.

### 2.3 Go

Go agrees with the majority on the two resource edge probes and generally uses value
copies for options. Its split between public API, scanner/parser, interpreter, and
diagnostics is straightforward.

Main issues:

- `deon.go:42-50` converts initial file bytes directly to a string, while another
  file-read path validates UTF-8 (`deon.go:56-64`). Apply one validation policy to all
  byte entry points.
- `diagnostic.go:69-84` returns the same singleton, reduced diagnostic contract as the
  other implementations.
- Resource-resolution behavior is embedded in the interpreter rather than exposed as
  a focused module with direct shared-vector tests.

### 2.4 Java

Java's public API is approachable and its explicit UTF-8 validation helper shows the
right intent. The major defects are consistency and caller-state ownership.

- `Interpreter.java:324-361` has the verified query/fragment classification and
  unmatched-parent normalization defects.
- `Deon.java:41-53` decodes the initial file with replacement while the alternate
  reader at `Deon.java:55-66` validates UTF-8.
- `Deon.java:34-38,41-52,74-82` mutates caller-provided `ParseOptions`. A `parseFile`
  call can leave filesystem capability enabled on an options object reused later,
  and shared options become unsafe across threads.

**Recommendation:** make options immutable or copy them on every public entry point.
Put resource resolution behind one package-private Interface and drive it from the
shared resolver vectors.

### 2.5 JavaScript/TypeScript

This package has the broadest ecosystem role, clear syntax/evaluation entry points,
and useful tooling APIs. It also illustrates why source-position semantics need an
adapter boundary.

- Scanner offsets are JavaScript string indices—UTF-16 code units—not UTF-8 byte
  offsets. This is a verified normative mismatch for astral characters.
- CRLF normalization before token positioning makes offsets unsuitable for slicing
  original source bytes.
- `objects/Diagnostic/index.ts:89-105` deliberately reduces results to the first
  error.
- Quoted-name interpolation follows the literal-name interpretation, unlike C/Go/
  Java/Swift.
- Node UTF-8 string reads normally replace malformed byte sequences; byte-oriented
  file tests should establish and enforce the required rejection behavior.
- `packages/deon-javascript/notes/general.md` still says structures and entity calls
  are unimplemented even though code and tests implement them.

**Recommendation:** store both original UTF-8 byte offsets and host/LSP coordinates,
or compute byte offsets from a line/index map at the scanner boundary. Avoid repeated
prefix encoding, which would make diagnostic construction quadratic.

### 2.6 Python

Python has one of the better resolver abstractions: a `ResourceLoader` protocol and
loader chain (`source/deon/resources.py:132-149`). That is a promising Interface to
standardize conceptually across implementations.

Main issues:

- `source/deon/__init__.py:150-162` and `network.py:217-218` mutate the supplied parse
  options. As in Java, this leaks per-call state/capabilities into later calls and
  creates concurrency hazards.
- Quoted-name interpolation follows the literal-name interpretation.
- Diagnostics still collapse to one result and omit the normative trace.

**Recommendation:** use frozen options or `dataclasses.replace`, and make the loader
chain responsible for all capability decisions rather than mutating global call
state.

### 2.7 Rust

Rust's ownership model, cloned options, and resource trait make it a strong candidate
for a reusable pure core. It agrees with the majority resource-resolution behavior
and rejects malformed UTF-8 naturally at string boundaries.

Its principal contract gaps are shared: quoted names use the literal interpretation,
diagnostics do not implement the full normative shape, and evaluation has only depth
rather than total-work budgets. Two Rust-specific issues deserve attention:

- Filesystem/network loaders discard UTF-8 decoding errors with `.ok()?`
  (`core/src/resources.rs:81-89`, `core/src/network.rs:40-54`), after which the
  interpreter reports `DEON_RESOURCE_IO` instead of the required resource-format
  failure. `ResourceLoader::fetch -> Option<Fetched>` is too shallow an Interface;
  return bytes plus a typed error and perform UTF-8 classification explicitly.
- Low-level recursive APIs remain publicly reachable around the guarded facade
  (`core/src/lib.rs:24-40,219-275`, `core/src/typer.rs:24-33`,
  `core/src/stringifier.rs:18-28`). A host-built deep value can therefore bypass the
  advertised guards. Make internals crate-private or guard every actual public entry
  point.

Diagnostics use `Rc`, so `DeonError` is not `Send`/`Sync`; `Arc<str>` would better fit
a library expected to participate in concurrent host applications. If a common
binding core is desired, preserve host-injected resource and network traits rather
than embedding platform I/O.

### 2.8 Swift

Swift is a wrapper/binding, not an independent implementation. That is not a weakness,
but it changes how test counts should be interpreted: Swift agreement with C is not a
second reading of the specification.

It inherits C's resource-normalization, URL-format, UTF-8, network, and diagnostic
behavior. Its best path is therefore to keep the binding thin, clearly document the
supported C feature profile, and validate Swift ownership/error conversion at the
boundary rather than duplicating semantic tests as if the evaluator were independent.

The binding boundary currently has avoidable crash states:

- `Document.value()` force-unwraps the C root pointer
  (`Sources/Deon/Deon.swift:225-228`), but the C API returns null after failure. Make
  value retrieval optional, throwing, or a `Result`.
- `Document.error` is nonoptional and fabricates a `DEON_OK` error on success. Model
  success and failure as disjoint states.
- Public `Int` option values are converted directly to `Int32` and can trap on
  overflow (`Deon.swift:100-109,260-269`). Validate before conversion.
- Swift's `DeonValue` adds `.bool` and `.number` while describing itself as the exact
  core data model (`Sources/Deon/Value.swift:3-12`). Separate parsed core values from
  typed values, as Rust does.

The package deliberately has no `Package.swift`, and CI enforces its absence. A
zero-third-party-dependency policy does not require giving up Swift Package Manager;
provide an ordinary manifest unless there is a documented distribution constraint.

### 2.9 MCP server

The MCP server describes `roots` as a security boundary, but the implementation does
not enforce that claim:

- `source/options.ts:76-84` creates file options with `allowFilesystem: true`; it does
  not install a root-restricted loader or `absolutePaths` policy. A permitted document
  can therefore import or datasign-read outside the configured root.
- `withinRoots` (`options.ts:87-104`) uses lexical `path.resolve`, not filesystem
  canonicalization. Its comment that symlinks cannot escape is false.
- `resources.ts:41-84` walks with `statSync`, which follows symlinked directories.
- The README makes an explicit root/symlink containment promise
  (`packages/tooling/deon-mcp/README.md:179-197`).

This is a P0 because users may rely on that documented boundary when exposing the
server to an agent. The unrestricted nested-read path was also reproduced end to end:
a document inside a configured root injected an absolute file outside it and returned
the content through MCP.

**Fix:** provide a root-restricted resource loader for every read, including
transitive imports and datasign. Canonicalize existing paths with `realpath`, reject
or re-check every symlink hop, verify containment after resolution, and account for
time-of-check/time-of-use. Test direct `..`, transitive import, datasign, symlinked
file, symlinked directory, and a file replaced after discovery. Until fixed, remove
the claim that roots are a security boundary or disable filesystem evaluation.

### 2.10 Language server and syntax grammar

The older `deon-grammar` package openly calls itself work in progress, but its current
behavior is far enough from Deon semantics that shipping it can be misleading:

- validation warns about uppercase words rather than Deon syntax
  (`server/src/functions/validateDocument/index.ts:30-76`);
- definition and hover handlers immediately return
  (`onDefinition/index.ts:17-38`, `onHover/index.ts:21-47`);
- completion scans backward for `#` and swallows parser failures
  (`onCompletion/index.ts:27-119`); and
- the TextMate regexes are not capable of representing Deon's contextual comments,
  lists, backticks, quoted keys, structures, and interpolation reliably
  (`syntaxes/deon.tmLanguage.json:21-132`).

**Recommendation:** build semantic features on the JavaScript implementation's
syntax tree, linter, and declaration/entity information. Add a small position Adapter
for LSP UTF-16 coordinates. Keep TextMate patterns deliberately basic and let semantic
tokens handle context; do not create a second approximate parser in regular
expressions.

### 2.11 Usage integrations

The Docker and kubectl helpers are executable deployment tooling and need the same
fail-closed standard as the language core.

- `usages/kubectl/source/kubectl-deonly-source-node.js:74-81` puts generated JSON
  inside a single-quoted command passed to `execSync`. A value containing an
  apostrophe breaks quoting and can inject shell syntax. Use `spawn`/`execFile` with
  an argument array and provide the manifest on stdin.
- The kubectl helper logs and skips parse failures, allowing a partial deployment to
  appear successful (`kubectl-deonly-source-node.js:22-38,64-87`).
- The Docker helper similarly swallows failures and can exit zero
  (`usages/docker/source/docker-deon-source-node.js:88-183`). A stage without
  `imagene` can concatenate `undefined` into the generated Dockerfile, and `CMD`
  arrays are hand-quoted rather than serialized safely.

Both packages need automated tests over hostile quoting, failed parsing, missing
fields, subprocess failure, and exit status. Generated deployment input should never
be interpreted by a shell.

## 3. Architecture deepening opportunities

The following proposals use “Module,” “Interface,” “Implementation,” “Depth,”
“Seam,” “Adapter,” “Leverage,” and “Locality” in their architectural sense.

### 3.1 Make resource resolution a deep Module

**Files:** each interpreter's path/URL/auth/cache logic, resource loaders, and the MCP
loader.

**Problem:** callers and interpreters currently know too much about extension
guessing, path cleanup, URL identity, capabilities, credentials, and filebase updates.
The broad effective Interface reduces Locality: a query-string rule requires changes
and tests throughout multiple evaluators.

**Solution:** define a small `ResourceResolver.resolve(request, context)` Interface
returning canonical identity, bytes/value, detected format, child context, and an
authorization/cache identity. Hide platform paths, URL parsing, redirects, extension
rules, and capability checks in the Implementation. Drive every implementation from
one shared resolver-vector corpus.

**Benefits:** high Leverage—one Seam controls imports, datasign, cycles, auth caches,
MCP containment, diagnostics, and future resource types. It also gives tests a precise
Interface instead of requiring a complete evaluator setup.

### 3.2 Separate the pure evaluator from host capability Adapters

**Problem:** parser/evaluator correctness is entangled with bespoke filesystem and
network code. The C HTTP implementation is the strongest warning: a shallow
“network enabled” flag hides transport security, redirects, and memory policy.

**Solution:** the evaluator accepts injected environment, filesystem/resource, clock
if ever needed, and network Adapters. The core never opens a socket or reads a path.
Package-specific convenience functions can install host adapters with explicit
limits.

**Benefits:** the evaluator gains Depth and testability; the security boundary becomes
visible; C and WASM bindings remain portable; network policy can use maintained host
stacks.

### 3.3 Treat diagnostics as a first-class Module

**Problem:** every stage creates positions differently and the public API immediately
throws information away. The Interface is effectively “first code and line,” despite
the richer normative model.

**Solution:** use a source registry with original bytes plus normalized semantic text,
stable spans in original UTF-8 bytes, lazy line/column conversion, related spans, and
import frames. Parser/evaluator code reports spans and codes; presentation adapters
produce CLI, JSON, language-native exceptions, or LSP diagnostics.

**Benefits:** one test surface validates positions across CRLF, Unicode, imports, and
host protocols. CLI wording can remain non-normative without losing structured data.

### 3.4 Keep the conformance harness as the central test Interface

The shared manifest is already a deep test Module: a small JSON Interface exercises
many implementations. Increase its Leverage rather than adding implementation-local
interpretations.

Extend it to support:

- complete diagnostics and multiple diagnostics;
- byte resources that can contain malformed UTF-8;
- resolver-only vectors;
- original-source CRLF and non-BMP position cases;
- configurable resource/evaluation budgets; and
- loopback HTTP behavior for redirects, query strings, response limits, and auth
  origin changes.

Keep differential probes too, but use them as discovery. Once a behavior is decided,
promote it to normative conformance.

### 3.5 Add architecture and language-decision documents

There is no repository `CONTEXT.md` or ADR directory. Design intent is scattered
through a 1,844-line root README, package notes, comments, and the specification. That
reduces Locality for both maintainers and coding agents.

Add a concise `CONTEXT.md` glossary and ADRs for:

- why the scalar model is string-only;
- capability and resolver boundaries;
- canonical identity versus presentation order;
- independent implementation tier versus binding tier;
- the zero-dependency policy and its limits; and
- why Swift binds C.

These documents should record forces and rejected alternatives, not repeat the spec.

## 4. Documentation quality

Documentation currently mixes normative rules, tutorial material, historical notes,
and language-specific API examples. Concrete defects include:

- Root README declaration examples incorrectly use `#` at declaration sites
  (`README.md:803-805,819-821,840-842,856-860,879-882`). Declarations do not use link
  syntax.
- The TypeScript authorization example uses array syntax where the API expects an
  object (`README.md:1067-1069`).
- The harness README still says three implementations although the script runs seven
  adapters (`spec/harness/README.md:44,74`).
- C, Java, and Swift notes claim 70 required fixtures and 180 differential requests;
  current counts are 83 and 228.
- The Go README says there are four CLI tools; there are seven.
- The root CLI help excerpt is stale and omits current flags.
- JavaScript notes describe implemented features as unimplemented.
- Package versions are `0.0.0-11` while the specification calls the language 1.0;
  language-version compatibility and package-version compatibility are not separated.

**Better structure:**

1. a short landing README with status and links;
2. a language guide containing tested examples;
3. the normative spec and conformance contract;
4. one API/CLI page per implementation; and
5. architecture/decision records.

Add documentation CI that extracts and parses every fenced Deon example, runs CLI
examples, and type-checks JavaScript/TypeScript snippets where practical. Generate
fixture/probe/implementation counts rather than hand-copying them.

## 5. Proposed specification changes

### 1.0 errata — no intended valid-program break

1. State normative precedence.
2. Make quoted names non-interpolating and give them a distinct grammar production.
3. Replace “shortest” canonical form with “unique conservative form.”
4. Correct the leading-unknown-escape grammar.
5. Define source spans against original UTF-8 bytes and define CRLF mapping.
6. Define relative logical-parent preservation and URL pathname-based format
   detection.
7. Define diagnostic ordering, severity expectations, and whether one or many errors
   are required.
8. Explicitly state Unicode normalization/equality policy.

Quoted-name behavior is observable today, so calling it errata still requires a
migration note for the three implementations on the losing interpretation.

### 1.x hardening

1. Add total-work/resource budgets and `DEON_LIMIT_EXCEEDED`.
2. Add a general Unicode escape and canonical control-character escaping.
3. Specify allowed URL schemes, redirects, origin-bound credentials, and response
   limits.
4. Standardize invalid UTF-8 behavior for initial and imported resources.
5. Move datasign integration to a versioned adapter document.
6. Require duplicate-key warnings and offer strict/warnings-as-errors evaluation.

### 2.0 candidates requiring usage evidence

1. Reject direct duplicate map keys by default.
2. Remove or demote structures to tooling sugar.
3. Remove implicit string spread and shortened map links.
4. Add explicit entity parameter lists if entities evolve.
5. Decide between a first-class schema layer and explicitly tagged scalars; do not
   guess types from untagged spellings.

## 6. Remediation roadmap

### Now: close security and agreement gaps

1. Enforce MCP roots at every resource read with realpath-aware containment; add the
   traversal/transitive/symlink test matrix.
2. Disable or clearly downgrade C/Swift built-in networking until it provides HTTPS,
   safe request construction, redirects, limits, and credential-origin policy.
3. Decide quoted-name interpolation and add required fixtures before changing code.
4. Add required resolver cases for unmatched `..` and URL query/fragment, then fix
   C/Java (and consequently Swift).
5. Fix JavaScript original UTF-8 byte offsets and add astral/CRLF cases.

### Next: make the contract testable

1. Resolve the rich-versus-singleton diagnostic contract and extend fixture/harness
   schemas.
2. Reject invalid UTF-8 consistently at every byte entry point.
3. Copy/freeze Python and Java options.
4. Define and implement resource/evaluation budgets.
5. Introduce the resolver and diagnostic Modules described above.

### Then: reduce maintenance and documentation drift

1. Split docs and make examples executable in CI.
2. Publish language-version and package-compatibility policy.
3. Replace prototype LSP semantics with the real syntax/evaluation APIs.
4. Define independent-conformance and binding-support tiers.
5. Gather real syntax usage before making 2.0 simplifications.

## 7. Regression cases to add

At minimum, add named fixtures/vectors for:

- interpolation-looking text in every name position;
- a leading unknown escape in each string form;
- relative logical IDs with one and multiple unmatched parents;
- URL query and fragment extension detection;
- URL redirects within and across origins with authorization;
- invalid UTF-8 in initial files and imported resources;
- CRLF offsets against original bytes;
- BMP, non-BMP, combining, and normalized/non-normalized positions and keys;
- NUL and other control characters in source, canonical output, credentials, and URLs;
- multiple independent parse errors and import traces;
- warning severity and duplicate-key warning requirements;
- source/resource/node/expansion/output budget exhaustion;
- MCP direct traversal, transitive traversal, datasign traversal, symlinked file,
  symlinked directory, and replacement-after-discovery; and
- C/host network response-size and malformed/chunked/redirect handling if a built-in
  network adapter remains.

## Conclusion

Deon's main risk is not a lack of tests; it is that the test Interface is narrower
than the normative and security Interfaces. The repository has already invested in
the right mechanism—shared fixtures executed by many implementations. Expanding that
mechanism around names, resolution, diagnostics, bytes, limits, and capability
boundaries will yield more reliability than adding features.

The language should remain conservative in 1.x. Clarify the specification, repair the
three verified semantic divergences, close the MCP and network boundaries, and make
diagnostics/resource resolution deep Modules. Save removal of duplicate keys,
structures, string spread, shortened links, or scalar-model changes for a measured
2.0 design rather than silently changing existing Deon programs.
