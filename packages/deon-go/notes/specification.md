# What the third reading still did not say

`deon-go` is the fourth implementation, and like `deon-python` before it, it was written from `spec/SPECIFICATION.md`, `spec/deon.ebnf`, and `spec/diagnostics.md` — never from the three implementations that already existed. That is the whole point of a fourth reading: `deon-javascript` is the reference, `deon-rust` was ported from it, and `deon-python` was written from the specification *after* seven of its silences had already been found and amended. A fourth reading tests what the third one, and the amendments it produced, still left under-determined or said wrong.

Most of the specification held. The seven gaps [`deon-python/notes/specification.md`](../../deon-python/notes/specification.md) records were amended, and this reading derived the amended behaviour without trouble — which is the amendments working. What follows is what the fourth reading *added*: one place where the third reading's own amendment is wrong, one rule it never reached, and a set of diagnostic positions that no prose pins and that a from-the-specification implementer gets wrong by writing the obvious thing.

The headline finding is the first. The rest are smaller, but each is a required position that the specification does not determine.

---

## 1. A quote does not end an unquoted string — it opens a region inside it. §4.3 says the opposite.

This is the important one, because the specification, as amended by the third reading, actively states the wrong rule.

§4.3 now reads: the ten delimiters `{`, `}`, `[`, `]`, `(`, `)`, `<`, `>`, `'`, and `` ` `` "are delimiters wherever they occur and no surrounding text makes them ordinary … one written bare is `DEON_PARSE_EXPECTED` at the delimiter." Read literally, `{ a x`q` }` is a syntax error at the backtick: the value `x` ends there, and a stray backtick string follows a complete entry.

Every implementation disagrees, including the three the rule was written from. `{ a x`q` }` evaluates to the map `{ a: "x `q`" }` — a single five-character string that **keeps its backticks as literal content**. `{ a x'a'y }` is the string `x'a'y`. `{ a p`q`r }` is `p`q`r`. The differential corpus pins all of these.

What the reference actually does — and what this implementation had to be rewritten to match after following the specification and failing the corpus — is treat a `'` or a `` ` `` inside an unquoted value as opening a **region** rather than ending the value. The region runs to its matching close (a `'` region may not cross a line; a `` ` `` region may), its own delimiters are kept as literal source, and the unquoted value is recovered as the raw source it spans and decoded once — so an interpolation inside a region is still resolved (`{ a x `a#{n}b` }` is `DEON_UNRESOLVED_LINK`) and an escape is still read. Only a comma, a newline, an enclosing **bracket** (`{}[]()<>`), or a `#name` link actually ends the value.

So the delimiter rule is right for the eight bracketing delimiters and wrong for the two quotes. The third reading's amendment (its item 5, "`unquoted-character` was never defined") over-generalised: it correctly established that a parenthesis ends the string, and swept the quotes into the same sentence, where they do not belong. A `(` ends an unquoted value; a `'` opens a region within it. They are not the same operation and the specification should not describe them with one.

`deon-go` matches the reference and the corpus. **§4.3 should be amended** to separate the two behaviours: the eight brackets (with comma and newline) end an unquoted string; a single quote or backtick opens a literal, still-decoded region that ends only at its match. Until it is, the specification says a thing all four implementations refuse to do.

## 2. A `#name` link ends an unquoted value; `#{` continues it.

`{ a x #y }` is `DEON_PARSE_EXPECTED` at the `#` (`1:7`): the value is `x`, and the link `#y` cannot follow it. But `{ a x #{n} }` is not an error — the interpolation `#{n}` is part of the value. And `{ a x`q`#z }` errors at the `#z` that follows the region.

So a `#` at a point where a token may begin — after whitespace, or straight after a quote region — starts a link and ends the unquoted string, unless it is the interpolation opener `#{`, which the string absorbs. §4.3 and §6 do not say where a link may begin relative to an unquoted value, and the obvious implementation (a `#` is an ordinary unquoted character, since it is not in the delimiter list) reads `x #y` as the single string `x #y` and never reports the error the corpus requires.

Belongs with the §4.3 amendment above: the list of what ends an unquoted value is comma, newline, a bracketing delimiter, and a bare `#` link.

## 3. Five diagnostic positions that no prose pins.

§11.2 was amended to fix *where a diagnostic points* for cycles and for resources. It did not reach these, and each is a required position in the conformance suite or the differential corpus that a from-the-specification implementer places wrong by doing the natural thing:

- **A link's diagnostic is at its `#`, not its name.** `{ #missing }` is `DEON_UNRESOLVED_LINK` at `1:3`, the `#`. Resolving the reference by its head naturally reports at the head — `1:4` — one column to the right, on every unresolved link and every cycle a link closes.
- **A spread's diagnostic is at its `...`, not its reference.** Spreading a list into a map (`{ ...#items }`) is `DEON_TYPE_MISMATCH` at the `...` (`3:3`), the operator that asked for the merge, not at the `#items` (`3:7`) it names.
- **An entity-argument fault is at the `(`.** `#template(other One)` with no parameter `other` is `DEON_ENTITY_ARGUMENT` at the opening `(` of the argument list (`2:19`), not at the argument name (`2:20`) and not at the `#` of the call. A missing argument reports there too.
- **An interpolation's diagnostic is at the string that carries it.** `{ a x `a#{n}b` }` reports the unresolved `n` at the start of the value (`1:5`), not at the `#{n}` inside it. The reference within an interpolation was recovered by decoding and has no source position of its own to report at.
- **A structure with a repeated field is `DEON_STRUCTURE_ARITY` at the `<`.** `{ people <id, id> [1, 2] }` — the row arity is correct (two cells, two fields), so the fault is the duplicate field name, reported at the signature's opening `<` (`1:10`). §8 says the signature "contains unique map keys" but names neither the code nor the position, and a naïve implementation accepts it and silently loses a column.

## 4. Two more strings that must be quoted, and the form to quote a line break in.

§12 lists exactly when a string must be quoted: empty, boundary whitespace, a leading `#`, a delimiter, `#{`, or a comment marker. The list is incomplete. A string containing a **backslash** or a **tab** must also be quoted, or it does not read back: `x\qy` written bare is read as an unknown escape and `x\ty` written bare is read with a real tab, so both are quoted (`'x\\qy'`, `'x\ty'`). The differential corpus pins them; the §12 list does not mention either character.

And §12's other half — "a backtick string carries a value only when that value begins and ends with a non-whitespace character and contains no carriage return" — describes when the backtick form is *available* but not when it is *chosen*. It is chosen precisely for a string that carries a real line break: `line\none` canonicalises to a backtick string with a literal newline, while `x\ty` (a tab, no line break) canonicalises to a single-quoted string even though it, too, qualifies for backticks. The rule an implementer needs is "use the backtick form when the value holds a line break and qualifies for it"; the specification gives only the qualification.

## 5. An authenticator that is not a string is `DEON_TYPE_MISMATCH`.

§11.2 groups "an authenticator that is not a string" with the resource diagnostics re-anchored to the importing statement, which is right about the *position* — it is reported at the `import`. It says nothing about the *code*, and the resource-diagnostic framing suggests a resource-format error. It is `DEON_TYPE_MISMATCH`: nothing has been fetched when the authenticator is evaluated, so there is no resource for its format to be wrong about — only a value of the wrong shape.

## 6. A document with no root reports at the end of the input.

`name value` — a leaflink and nothing else — is `DEON_PARSE_ROOT` at `1:11`, the position just past the last character, not at `1:1`. The document was read to the end before the absence of a root was certain, and that is where the diagnostic points. The obvious implementation, which notices the missing root before it starts and reports at the beginning, gives `1:1` and fails the fixture.

---

Nothing here changed what Deon *means* — every behaviour above is what the three existing implementations already do. What it changes is what the specification says about itself: one rule it states backwards (§4.3 on quotes), one it never states (where a link ends a value), and eight positions it leaves to be guessed. The first is worth a careful amendment, because it is the rare case where following the specification faithfully produces a parser that is *wrong*, and a fifth implementer reading only the prose would write it the same wrong way.
