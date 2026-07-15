# Deon Language Specification 1.0

## 1. Status and terminology

This document is the normative specification of the DeObject Notation (`deon`) language, version 1.0. The grammar in `deon.ebnf`, the diagnostic catalogue in `diagnostics.md`, and the fixtures under `conformance/` are normative parts of this specification.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are to be interpreted as requirements on a conforming implementation.

Deon source is UTF-8 text. A document has the media type `application/deon` and normally uses the `.deon` filename extension.

## 2. Data model

A Deon value is exactly one of:

1. a string;
2. an ordered list of Deon values;
3. an ordered map from string keys to Deon values.

There are no intrinsic null, Boolean, or numeric values. An omitted map value, `''`, and a null-like value supplied by a host serializer all produce the empty string. The source text `null` produces the string `"null"`.

Map order is presentation information rather than semantic data. Implementations MUST nevertheless retain final write order so ordinary stringification is stable. List order is semantic.

## 3. Document model

A document contains:

- zero or more imports and injections;
- exactly one root map or root list;
- zero or more leaflink declarations.

Their source sections may occur in any order. Imports, injections, and leaflinks share one declaration namespace. Duplicate declaration names are errors. Only the evaluated root is exported when another document imports this document.

Comments and formatting are not semantic data. An implementation MAY expose a lossless syntax tree, but ordinary parsing returns only the root value.

## 4. Lexical rules

### 4.1 Whitespace and separators

Spaces and horizontal tabs separate tokens. A newline or comma separates map entries, list items, structure cells, and call arguments when not nested inside another group. Blank lines are ignored.

Both LF and CRLF input are accepted. Semantic multiline strings and generated output normalize line endings to LF.

### 4.2 Comments

`//` begins a comment at a token boundary and continues to the line end. `/*` begins a block comment and the next `*/` ends it. Block comments do not nest. Comment markers inside strings are literal text.

A token boundary is a position at which a token may begin. A comment marker *within* a token is ordinary text and begins nothing: `https://example.com/a` is one unquoted string, and the `//` in it is two slashes. A comment written between the words of an unquoted string is trivia, and is removed from the string; the whitespace around it belongs to the string and remains. `a one /* two */ three` is therefore the value `a one  three`.

### 4.3 Strings

An unquoted string continues until an unnested comma, newline, enclosing bracket, or link. Leading separator whitespace is excluded; other internal whitespace is retained as single source characters.

An unquoted string ends at a comma, a newline, one of the bracketing delimiters `{`, `}`, `[`, `]`, `(`, `)`, `<`, and `>`, or a `#name` link. These end it wherever they occur and no surrounding text makes them ordinary: a value that requires a bracketing delimiter must be quoted, and one written bare is `DEON_PARSE_EXPECTED` at the delimiter. A `#` that begins a link ends the value the same way — `{ a x #y }` is `DEON_PARSE_EXPECTED` at the `#` — while the interpolation opener `#{` is part of the value. Every other character may appear, which is what allows a path, a URL, or a flag to be written with no quotes at all.

A single quote or a backtick inside an unquoted string does **not** end it. It opens a region that runs to its matching close — a `'` region may not cross a line, a `` ` `` region may — whose own quote characters are kept as literal content: `x'a'y` is the five-character string `x'a'y`, and `p`q`r` keeps its backticks. The value an unquoted string spans is the source between its first and last character, with comments removed and every region included, decoded once; so an interpolation inside a region is still resolved and an escape is still read. An unterminated region is a lexical error at the quote that opened it.

A single-quoted string is confined to one logical line. A backtick string may span lines. Boundary whitespace in a backtick string is removed through the first and last non-whitespace character; whitespace between those characters is preserved. Trimming applies to the source text before escapes are decoded, so an escaped line break is content rather than layout and is never trimmed.

All three forms recognize `#{reference}` interpolation. The following minimal escapes are decoded:

- `\\\\` to one backslash;
- backslash followed by the active quote delimiter to that delimiter;
- `\\#{` to the literal characters `#{`;
- `\\n` to a line feed, `\\r` to a carriage return, `\\t` to a horizontal tab.

Every other backslash sequence is preserved literally. An unterminated string, escape, or interpolation is a lexical error.

The line-break escapes are what make every string writable. An unquoted string ends at a newline, a single-quoted string may not cross one, and a backtick string trims the whitespace at its boundaries, so without them a value such as `alpha` followed by a line feed would have no representation at all, and the round trip required by section 13 could not hold.

### 4.4 Names

An unquoted map key or declaration name uses letters, digits, `_`, or `-`. Single quotes permit any non-newline name. A name is compared after unquoting and escape decoding.

## 5. Maps and lists

A map is enclosed in `{` and `}`. Each entry contains a key and an optional value. An omitted value is the empty string.

A list is enclosed in `[` and `]`. Every item is a value; `''` represents an empty item.

Maps are constructed from top to bottom. Every explicit entry and spread writes at its source position. A later write replaces an earlier value and moves the key to its final write position. Direct repeated keys are valid; a linter SHOULD report `DEON_LINT_DUPLICATE_KEY`. Replacements caused by spread do not warn.

## 6. Root and leaflinks

The unnamed top-level map or list is the root. Every other top-level named value is a leaflink declaration.

`#name` evaluates a leaflink. Within a map, the shortened form uses the final access segment as the receiving key. `key #name` uses the explicit receiving key. Within a list, a link contributes one item.

Dot access (`#entity.name`) and bracket access (`#entity[name]`, `#items[0]`) navigate maps and lists. Accessing a missing member, a non-container, or an invalid list index is an error. A quoted initial name is parsed before access segments.

`#$NAME` reads the evaluation environment. An absent environment name evaluates to the empty string. Environment values are always strings.

## 7. Spreading

`...#reference` spreads the referenced value at its source position.

- a map may spread into a map;
- a list may spread into a list;
- a string may spread into a map using decimal character indices;
- a string may spread into a list as Unicode code points.

Other source/destination combinations are errors. Spread copies values; it does not create mutable aliases.

## 8. Structures

A structure is syntactic sugar for a list of maps:

```deon
people <id, name> [
    1, One
    2, Two
]
```

The signature contains unique map keys; a repeated field name is `DEON_STRUCTURE_ARITY` at the signature's opening `<`. Cells may contain any Deon value. A logical row ends at a newline with balanced nesting, and cells are comma separated. Every row MUST contain exactly the signature arity. The example evaluates to `[{ id: "1", name: "One" }, { id: "2", name: "Two" }]`.

## 9. Imports and injections

`import name from target` loads `target`, parses it as Deon or JSON, and binds its root to `name`. `inject name from target` binds the UTF-8 resource text without parsing it. Either statement may end with `with authenticator`, where the authenticator is a literal string, environment link, or leaflink resolving to a string.

Relative filesystem targets resolve against the containing file. Relative URL targets resolve against the containing URL. When an import target has no extension, `.deon` is appended. `.json` selects JSON conversion; other import extensions are resource-format errors. Injection retains the target exactly.

The `absolutePaths` option maps logical absolute targets to host paths. Exact keys win before wildcard keys ending in `/*`; among wildcards, the longest prefix wins and the unmatched suffix is appended to the mapped directory. The mapping is a property of the target rather than of whoever resolves it: a resource supplied to the evaluator directly MUST map exactly as one read from a host, or a document would mean one thing when its resources are handed over and another when they are read from a disk.

The `authorization` option is keyed by a lowercase exact hostname. An explicit `with` value takes precedence. A non-empty token is sent as `Authorization: Bearer <token>`; an empty token sends no header. Tokens MUST NOT appear in diagnostics or cache identifiers in plain text.

Non-success HTTP status, invalid UTF-8, invalid imported syntax, denied capabilities, and I/O errors fail the complete evaluation. Canonical resource identifiers participate in cycle detection. Authenticated cache entries MUST be separated by a digest of the credential.

Calling a raw-text parser grants neither filesystem nor network access. `parseFile` grants filesystem access for its initial file and nested filesystem imports. Network access always requires an explicit option. A pure evaluator never grants filesystem access.

### 9.1 JSON conversion

Imported or converted JSON maps recursively as follows:

- JSON string to the same string;
- JSON Boolean to `"true"` or `"false"`;
- JSON number to its source token spelling;
- JSON null to the empty string;
- arrays and objects recursively to lists and ordered maps.

Repeated JSON object members follow Deon's last-write-wins map rule.

## 10. Interpolation and entity calls

`#{reference}` may occur any number of times in any string form. A reference is resolved using the same access rules as a leaflink and MUST produce a string. Every occurrence is replaced. `\\#{` writes a literal interpolation opener.

A map, list, or string leaflink may be called:

```deon
template {
    message Hello #{name}
}

{
    first #template(name One)
}
```

Arguments form an ordered map of immutable local string bindings. The interpolation names in the called entity are its exact parameter set. Missing, extra, duplicate, or non-string arguments are errors. Locals shadow outer leaflinks for the duration of the call. Every call evaluates an independent copy. Recursive entity calls are cycles.

## 11. Evaluation

Evaluation is atomic and follows these conceptual stages:

1. decode and lex the complete source;
2. parse a syntax tree and validate one root;
3. collect the declaration namespace;
4. build dependencies for resources, authenticators, links, interpolation, and
entity calls;
5. topologically resolve the graph;
6. evaluate the root sequentially;
7. return the root or a structured error containing all available diagnostics.

Declaration source order does not affect dependency resolution. A declaration is evaluated at most once per evaluation, except for separately parameterized entity calls.

### 11.1 Nesting

A value nests when it contains another value. An implementation MUST refuse a document that nests more than **128** values deep, reporting `DEON_PARSE_EXPECTED` at the opening token of the value that exceeds the limit. Spreading and entity calls compose depth: a value assembled from others is as deep as the result, not as deep as any part of it, and the limit applies to the result.

The limit is a requirement rather than a permission. A document is data, and data arrives from places that do not wish the reader well; an implementation that recursed as deeply as it was asked to would exhaust its host's stack and fail in a way that carries no code and no position, which a caller can do nothing with. 128 is far past any nesting a document has cause to contain.

A value handed to a stringifier, to canonical form, or to the typer by a host — rather than by the parser — is subject to the same limit. An implementation MUST check the depth of such a value before writing or typing it and, when it exceeds the limit, report `DEON_PARSE_EXPECTED` rather than exhausting the stack or returning a truncated or empty result. The check itself MUST NOT recurse, or the value it is meant to guard against would overflow it first.

### 11.2 Where a diagnostic points

A cycle is reported at the **reference that closes it**, not at the declaration that opens it: the declaration is well-formed on its own, and it is the reference back into it that made the loop.

A diagnostic arising from an imported or injected resource — a syntax error inside it, an unreadable target, a denied capability, an authenticator that is not a string — is reported at the span of the **statement that imported it**, and the resource's own location appears in the import trace. The document a caller is holding is the importing one, and the line they can go and look at is the import. An authenticator that is not a string is `DEON_TYPE_MISMATCH`, not a resource-format error: nothing has been fetched when it is evaluated, so there is no resource whose format could be wrong — only a value of the wrong shape.

The remaining positions are fixed so that two implementations underline the same character:

- a link's diagnostic — unresolved, or a cycle it closes — is at its `#`, not at the name after it;
- a spread's diagnostic is at its `...`, the operator that asked for the merge, not at the reference it names;
- an entity-call argument fault — an unknown, missing, duplicate, or non-string argument — is at the opening `(` of the argument list;
- an interpolation's diagnostic is at the string that carries it, not at a position inside it: the reference within was recovered by decoding and has no source position of its own;
- a structure signature with a repeated field is `DEON_STRUCTURE_ARITY` at its opening `<`;
- a document with no root is `DEON_PARSE_ROOT` at the end of the input, the position past its last character, because the absence of a root is not certain until the document has been read to the end.

## 12. Stringification

Ordinary stringification preserves list and final map write order. Defaults are readable output, four spaces, inline values, no generated header, and no generated section comments. Unsafe or ambiguous strings MUST be quoted.

A string MUST be emitted in a form that reads back unchanged. The backtick form is chosen for a value that carries a real line break and qualifies for it — one that begins and ends with a non-whitespace character and contains no carriage return — because that is the form that keeps the line break literal; every other string that cannot stand unquoted is single-quoted, with its line breaks, tabs, and carriage returns written as escapes. A value that qualifies for a backtick string but carries no line break, such as one holding only a tab, is single-quoted rather than backticked: the shorter safe form is the form.

A string MUST be quoted when it is empty, when it begins or ends with whitespace, when it begins with `#`, when it contains a delimiter of section 4.3, when it contains a backslash or a tab, when it contains `#{`, or when it contains a comment marker (`//` or `/*`). A backslash written bare is read as an escape and a tab written bare is read as separating whitespace, so a string carrying either does not read back unquoted. The comment marker is quoted even though a marker inside a token is ordinary text and would read back unchanged: two implementations may not disagree about the canonical form of a value (section 13), so where a shorter form and a safer one both read back correctly, the safer one is the form.

With `readable: false` a map or list is emitted on one line, its entries separated by the comma that the grammar accepts wherever it accepts a newline. Canonical output is always readable.

With `leaflinks: true`, maps and lists encountered exactly at `leaflinkLevel >= 1` are extracted into declarations after the root. Once an ancestor is extracted, its descendants are not separately extracted. Names use the root-relative path: escape `~` as `~0`, `/` as `~1`, then join segments with `/`. Quote a generated name when required by the name grammar.

`leaflinkShortening` emits `#name` only when a receiving map key equals the generated declaration name; otherwise it emits an explicit key and link.

`generatedHeader` adds exactly `// Generated by Deon.`. `generatedComments` adds `// Root.` and, when applicable, `// Leaflinks.` section comments.

## 13. Canonical form

Canonical output:

- contains only the fully evaluated inline root;
- sorts every map by Unicode code-point order;
- preserves list order;
- uses four spaces and LF;
- uses the shortest unambiguous string form;
- contains no comments or generated leaflinks;
- ends with exactly one newline.

For every value `v`, `parse(canonical(v))` MUST equal `v`.

## 14. Conservative typing

Typing is outside the Deon data model. The optional common typer converts exact `true` and `false`, integers within the IEEE-754 safe 53-bit range matching `-?(0|[1-9][0-9]*)`, and finite decimal/exponent forms without leading zeroes. Empty strings, leading-zero values, out-of-range numbers, and `null` remain strings. Datasign integration (§14.1) is an optional post-parse adapter.

### 14.1 Datasign

The conservative typer of §14 guesses from the value, and so it must refuse whenever a guess could be wrong: `007` stays a string because a postal code that becomes the number `7` is a bug. A **datasign contract** is the other half — it supplies the intent the value cannot carry, so that `007` becomes `7` where a contract declared it a number, and stays `007` where none did. It is an optional adapter and an implementation MAY omit it; an implementation that provides it MUST provide exactly what follows, because the point of a contract is that two readers of it agree.

A contract is read line by line from `.datasign` source, and the rules below are `datasign`'s own — the format belongs to that project, and this is an adapter to it rather than a dialect of it. A line whose first non-blank characters are `//`, `/*`, `*`, or `@` is ignored, and so is anything from `//` to the end of any other line: annotations and commentary describe the type to other tools and say nothing about the shape. A line matching `data <name> {` opens an entity; the next line whose first non-blank character is `}` closes it. Inside an entity, a line is a field when it contains a `:`; the name is what precedes the colon, the type is what follows it with any trailing `;` removed, and both are trimmed. A `?` **anywhere on the line** declares the field **optional** and is removed from both the name and the type, so `nickname?: string` and `nickname: string?` are the same declaration. Any other line inside an entity is ignored. When several sources are read together, a repeated entity name takes its fields from the last source that declares it.

A `.datasign` file may hold declarations this reads nothing from: an `import`, a `!target` meta block, and a composed type (`C = A & { … }`). None of them declares an entity here, so a value whose type names one falls under the last rule below and is left exactly as it was parsed. That is a limitation and not a licence: it fails safe, never converting a value it does not understand, and an implementation that grows to read them changes only what it recognises and never what it does with what it already did.

A contract is applied to an evaluated root value through a **datasign map**, which names root keys and the type each is expected to hold. An empty map is the identity. A non-empty map against a root that is not a map is `DEON_TYPE_MISMATCH`. A named key absent from the data is skipped rather than invented.

A value is converted against a declared type as follows, and every failure below is `DEON_TYPE_MISMATCH`:

+ A type ending in `[]` requires a list, and converts each element against the element type.
+ `string` requires a string and yields it unchanged.
+ `boolean` requires the string `true` or the string `false`, and yields the corresponding boolean.
+ `number` requires a string that is a finite number, and yields that number. What counts as one is the ECMAScript `Number(string)` conversion over a non-blank string: leading and trailing whitespace is ignored; `0x`, `0o`, and `0b` prefixes are read in base 16, 8, and 2; an optional sign, digits, a decimal point, and an exponent are read in base 10; and `Infinity`, `NaN`, a digit separator, and every other spelling are a mismatch. This is a wider grammar than §14's, deliberately: §14 must not guess, and a contract is not guessing.
+ A type naming a declared entity requires a map. Each key the entity declares is converted against its declared type. A key the entity does *not* declare passes through unconverted rather than being dropped, and the write order of §5 is preserved. A field declared and not optional, whose key is absent from the map, is a mismatch.
+ A type naming neither a primitive nor a declared entity leaves its value untouched. Datasign permits types defined elsewhere, and a value is not to be guessed at merely because its type was not found.

Reading a `.datasign` file is filesystem access and is subject to §9: it is `DEON_CAPABILITY_DENIED` when the filesystem was not granted, and `DEON_RESOURCE_IO` when it was granted and the file could not be read. A relative contract path resolves against the document's filebase.

Typing happens after evaluation, so no source token remains to point at. A datasign diagnostic is reported at the head of the contract it came from, and names the path through the data (`accounts[0].age`) that failed, which is what makes it actionable.

## 15. Conformance

An implementation conforms to Deon 1.0 only when it passes every required fixture in `spec/conformance/cases.json`, produces the required diagnostic code and source position for invalid fixtures, and satisfies canonical round trips. Tests MUST use injected or local resource resolvers rather than public network services.

Conformance is tested on the diagnostic **code**, the **severity**, and the **position**. A diagnostic's message is not normative (`spec/diagnostics.md`): it is written for a person, and it will often quote the host, which no two hosts spell alike.

A fixture may carry a `feature` naming an optional part of the language — datasign (§14.1) is the one that exists. A fixture so tagged is required of an implementation that offers the feature and does not apply to one that does not: the implementation runs the fixtures for the features it supports and filters the rest out, rather than failing them. This keeps an optional feature from being untested wherever it *is* offered — the point at which "optional" would otherwise become "unchecked" — while leaving an implementation free to omit it. A datasign fixture supplies its contract through `files`, the contract and root-key map through a `datasign` object, and asserts either the typed result (`datasign.typed`) or, reusing `error` and `position`, the diagnostic a bad document produces.
