# What the specification did not say

`deon-python` was written from `spec/SPECIFICATION.md`, `spec/deon.ebnf`, and `spec/diagnostics.md`, and deliberately **not** from the two implementations that already existed. That constraint was the point of the exercise. `deon-javascript` is the reference, and `deon-rust` was ported *from* it — so wherever the specification was silent, Rust inherited JavaScript's answer instead of deriving one, and the two agreeing proved only that they agreed.

A third implementation, written from the prose, is the first thing able to tell the difference between "the specification says this" and "the reference happens to do this".

This is the log. Every entry is a place a competent implementer, reading only the specification, would have written something defensible and been wrong. Each one is now amended into the specification, and each is behaviour the existing implementations already had — nothing here changed what Deon means, only what it says about itself.

---

## 1. The nesting limit was nowhere

`nesting-depth-limit` is a **required** fixture demanding `DEON_PARSE_EXPECTED` at exactly `1:133`. Neither the specification nor the diagnostic catalogue mentioned nesting, depth, recursion, or a limit of any kind.

An implementer reading the specification would have written a plain recursive-descent parser, hit a `RecursionError`, and had no way to learn from the document what number to pick, where to report it, or which code to use. Getting `1:133` right further requires knowing that the counter increments per **value node** and that the root map is not one of them — neither of which is derivable from anything.

Amended into **§11.1**, which now states the limit, the code, the position, and that spreading and entity calls compose depth.

## 2. A resource's diagnostics are re-anchored to the import statement

`resource-format-invalid-json` puts a syntax fault *inside* `/project/data.json` and demands the position `1:1` — which is the `import` line of `main.deon`, not the fault. The same holds for `capability-denied-*`, `resource-io-unreadable`, and `authenticator-must-be-a-string`, whose `#secret` sits at column 32 and is reported at column 1.

§9 said a diagnostic carries an "import trace". It never said the **primary span collapses to the importing statement**. The natural reading — report the fault where it was written, and mention the import — fails four fixtures.

Amended into **§11.2**.

## 3. A cycle is reported where it closes, not where it opens

`leaflink-cycle` (`a #b` / `b #a`) demands `2:3` — the `#a` on the second line, the reference that *closed* the loop. Reporting at the declaration that opened it, which is at least as defensible and was my first implementation, gives `1:1`.

Amended into **§11.2**. The reasoning is sound once stated: the declaration is well-formed on its own, and the reference back into it is the character somebody has to go and delete.

## 4. "A comment begins at a token boundary" — and a token boundary was undefined

§4.2 used the phrase and never defined it. It has to mean *where a token may begin*, and it matters: `import remote from https://example.com/remote.deon` is a required fixture, so a `//` inside an unquoted string must stay literal, or the target truncates to `https:` and the fixture cannot pass.

Worse, the neighbouring case is decided the other way. A comment written *between the words* of an unquoted string is trivia and is **removed** from it, so `a one /* two */ three` evaluates to `one  three` — two spaces, because the whitespace around the comment belongs to the string and stays. I read it as literal text and was wrong; both siblings strip it.

Amended into **§4.2**, with both halves.

## 5. `unquoted-character` was never defined

The grammar's `unquoted-string = unquoted-character, { ... }` rests on a nonterminal that `deon.ebnf` names and never defines. The whole design of a lexer follows from it.

It turns out `{`, `}`, `[`, `]`, `(`, `)`, `<`, `>`, `'`, and `` ` `` are **delimiters wherever they occur**, and no surrounding text makes them ordinary: `{ a note(x) }` is `DEON_PARSE_EXPECTED` at the parenthesis, not the string `note(x)`. I implemented the permissive reading — a parenthesis is just a character — and parsed documents that both siblings reject.

Amended into **§4.3**.

## 6. Canonical form quotes a comment marker, and the specification implied it should not

§13 says canonical form "uses the shortest unambiguous string form". By that rule, `http://x` should be written **bare** — it is shorter, and it reads back unchanged, which I verified: all three implementations parse the bare form correctly.

Both siblings nevertheless quote it. And they are right to, for a reason §13 states two lines earlier and does not connect: canonical form is *the one output two implementations must agree on, character for character*. A form that is shorter, unambiguous, and different from what everyone else emits has misunderstood what canonical form is for. Where a shorter form and a safer one both read back correctly, the safer one is the form.

This is the one entry where the specification, read literally, said something the implementations do not do. Amended into **§12** — and this is the amendment worth arguing about, because it resolves a real tension rather than filling a real silence.

## 7. `DEON_LEX_INVALID` is raised for a name, by the parser

`{ a.b value }` must give `DEON_LEX_INVALID` at `1:3`. But `a.b` is a perfectly good *unquoted string* token; it is illegal only in a **name** position, which a scanner cannot know. The catalogue defines the code as "character sequence cannot form a token", which does not describe this at all, and the honest from-the-specification choice is `DEON_PARSE_EXPECTED` — which is wrong.

Amended into `diagnostics.md`.

## 8. Nothing said whether a diagnostic's message is normative

The catalogue lists what a diagnostic carries — a code, a severity, a message, a position — and never says which of those two implementations must agree on. Read strictly, all of them; and that cannot be met. A missing file is `No such file or directory` to Rust, `ENOENT: no such file or directory` to Node, and `[Errno 2] No such file or directory` to Python, because each is quoting its own host, and an implementation that invented a fourth sentence to make them match would be hiding what the operating system actually said.

So the code, the severity, and the position are normative and the message is not — which also settles the rule for anything reading diagnostics: key on the code, never on the message.

Amended into `diagnostics.md`. Found by `scripts/cli-harness.py`, which had to decide what "the same result" means before it could compare anything.

---

## What the conformance suite could not see

Two bugs got through 47 passing fixtures and were caught only by running the three implementations against each other.

**Nested containers were indented twice.** Every fixture that stringifies is either one level deep or extracts its containers into leaflinks, so nothing in the suite ever wrote a map inside a map inside a map. `stringify-nested-indentation` (case 48) now does, and it fails against the bug it was written for.

**A document that imports itself looped forever** rather than reporting `DEON_CYCLE`, because the set of open resources held the documents *below* the root and not the root itself. `resource-cycle` passes through two files and never exercised the shortest cycle there is.

The lesson is the same one both times: a suite of 47 fixtures written *alongside* an implementation tests what its author thought to test. A second implementation tests what the first one assumed.

## What the library harness could not see either

The same argument then applies one level up. `scripts/harness.py` proves the three *libraries* agree; it says nothing about the three *tools*, and a tool is where the defaults, the argument grammar, the exit status, and the writes to disk live — none of which is in a fixture. `scripts/cli-harness.py` asks the question of the tools, and found a divergence in each of the three:

- **Python's argument parser ate the command's own options.** `deon environment app.deon sh -c 'echo hi'` dropped the `-c`, because the helper that skips the tool's flags skipped everything beginning with `-`. The same bug let `deon environment app.deon curl -n https://…` read `curl`'s `-n` as a grant of the network — a capability handed over by an argument that was never meant for Deon.
- **`JavaScript` reported a missing document as a raw `ENOENT`**, with no code and no position, where Rust reported `DEON_RESOURCE_IO`. The file was named, so it was permitted, and it failed to load: that is a diagnostic, and it now is one in all three — including from `parse_file` in the library, which had been leaking the host's exception across the public boundary.
- **Rust's `lint` named every document `<memory>`**, because `lint(source)` took no source name and defaulted to one. The signature now takes the name, as the other two always did.

Each of these was invisible to 48 fixtures and to 73 differential probes, and each was a one-line fix once seen.
