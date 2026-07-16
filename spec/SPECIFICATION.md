# Deon Language Specification 1.0

## 1. Status and terminology

This document is the normative specification of the DeObject Notation (`deon`) language, version 1.0. The grammar in `deon.ebnf`, the diagnostic catalogue in `diagnostics.md`, and the fixtures under `conformance/` are normative parts of this specification.

When two normative parts appear to conflict, the order of precedence is: the prose of this document and its data model first, then the conformance fixtures, then the grammar in `deon.ebnf`, then the diagnostic catalogue. The prose defines the language; a fixture pins a concrete case the prose already governs; the grammar is a deliberately approximate guide whose context-sensitive lexical boundaries section 4.3 explicitly overrides; and the catalogue names codes and severities without fixing every position. A conflict between them is a defect in the subordinate part, to be corrected there rather than relied upon.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are to be interpreted as requirements on a conforming implementation.

Deon source is UTF-8 text. A document has the media type `application/deon` and normally uses the `.deon` filename extension. Wherever an implementation accepts bytes rather than text — the initial document read from a file, an imported or injected resource, a network response, a datasign contract — input that is not valid UTF-8 is a `DEON_RESOURCE_FORMAT` error, distinct from the `DEON_RESOURCE_IO` of bytes that could not be read at all; the bytes were read, and their encoding is the fault. It is reported at the start of the initial document (1:1), or, for a resource, at the statement that imported it (section 11.2).

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

Whitespace is exactly four characters: the space `U+0020`, the horizontal tab `U+0009`, the line feed `U+000A`, and the carriage return `U+000D`. No other character is whitespace. The Unicode space separators in particular — the no-break space `U+00A0`, the ideographic space `U+3000`, and every other character in category `Zs`, together with the line and paragraph separators and the byte-order mark — are ordinary string content: they never separate a token, they are never trimmed at a string boundary, and a value that is one of them is written back bare like any other character (§12). An implementation that trims or tests whitespace with its host language's Unicode-aware routine, rather than this four-character set, will disagree with this one on such a value, and is wrong.

Spaces and horizontal tabs separate tokens. A newline or comma separates map entries, list items, structure cells, and call arguments when not nested inside another group. Blank lines are ignored.

A comma falls *between* two items. A comma with no item before it — whether it leads the group or stands alone in it — is `DEON_PARSE_EXPECTED`. A single trailing comma before the closing `}` or `]`, and before the newline that ends a structure row, is permitted and contributes no item; maps, lists, and structures agree on this. A newline never carries the restriction, because a blank line is ignored rather than read as an empty item.

Both LF and CRLF input are accepted. Semantic multiline strings and generated output normalize line endings to LF.

### 4.2 Comments

`//` begins a comment at a token boundary and continues to the line end. `/*` begins a block comment and the next `*/` ends it. Block comments do not nest. Comment markers inside strings are literal text.

A token boundary is a position at which a token may begin. A comment marker *within* a token is ordinary text and begins nothing: `https://example.com/a` is one unquoted string, and the `//` in it is two slashes. A comment written between the words of an unquoted string is trivia, and is removed from the string; the whitespace around it belongs to the string and remains. `a one /* two */ three` is therefore the value `a one  three`.

### 4.3 Strings

A value that does not begin with a quote is an unquoted string. It runs until an unnested comma, a newline, an enclosing bracket, or a link-starting `#`; leading and trailing separator whitespace is excluded, while whitespace between its first and last retained character is kept as single source characters.

A comma, a newline, or one of the bracketing delimiters `{`, `}`, `[`, `]`, `(`, `)`, `<`, and `>` ends the string wherever it occurs, and no surrounding text makes it ordinary: a value that must contain one is quoted, and one written bare is `DEON_PARSE_EXPECTED` at the delimiter. A `#` starts a link only at a **token boundary** — at the value's first character, or after separating whitespace — and there it ends the value the same way, so `{ a x #y }` is `DEON_PARSE_EXPECTED` at the `#`; a `#` anywhere else is ordinary text, so `x#y` is the three-character string `x#y`, while the interpolation opener `#{` is part of the value wherever it appears. Every other character may appear, which is what allows a path, a URL, or a flag to be written with no quotes at all.

A single quote or a backtick that is **not** the first character of an unquoted string is ordinary literal content and opens nothing: `x'q'y` is the five-character string `x'q'y`, `p`q`r` keeps its backticks, and `it's` is the string `it's`. Only the value's *first* character decides whether it is a quoted string; a quote after it is literal wherever it falls, and interior whitespace does not restore its power, so `x 'y` is the four-character string `x 'y` — not an unterminated quoted string. Such a quote never needs closing, and it never protects a comma, a newline, or a bracketing delimiter from ending the value — a value that must contain one of those, or that must itself begin with a quote, is quoted in full. A value whose first character *is* a quote is a quoted string, covered below; the two quoted forms are the only place a quote character carries structural meaning. The unquoted string is decoded once: its escapes are read and its `#{…}` interpolations resolved in a single pass, wherever they fall among its literal characters.

A single-quoted string is confined to one logical line. A backtick string may span lines. Boundary whitespace in a backtick string is removed through the first and last non-whitespace character; whitespace between those characters is preserved. Trimming applies to the source text before escapes are decoded, so an escaped line break is content rather than layout and is never trimmed.

All three forms recognize `#{reference}` interpolation. The following minimal escapes are decoded:

- `\\` to one backslash;
- backslash followed by the active quote delimiter to that delimiter;
- `\#{` to a literal interpolation opener. Where a `}` closes a non-empty, whitespace-free reference — exactly the reference a real `#{…}` would take — the *escaped interpolation* `\#{reference}` is kept as the literal characters `#{reference}` rather than resolved, wherever it falls (so `p\#{x}q` is the literal string `p#{x}q`); an empty reference `\#{}` is `DEON_PARSE_EXPECTED` at the same place `#{}` is. Where no such `}` closes the reference before a whitespace, a value-ending delimiter, or the end of the string, the `\#{` is simply the two literal characters `#{` and reading continues (so `p\#{q ` is the literal string `p#{q`), which is how a literal `#{` is written;
- `\n` to a line feed, `\r` to a carriage return, `\t` to a horizontal tab;
- `\u{…}` to the Unicode scalar value written between the braces as one to six hexadecimal digits, read case-insensitively. The value MUST NOT exceed `U+10FFFF` and MUST NOT be a surrogate (`U+D800` through `U+DFFF`), so `\u{1b}` is the escape character, `\u{1F600}` is `😀`, and `\u{0}` is the null character. An empty `\u{}`, a non-hexadecimal character before the closing brace, a surrogate, or an out-of-range value is `DEON_LEX_INVALID` at the backslash; input that ends before the closing brace is `DEON_LEX_UNTERMINATED`.

Every other backslash sequence is preserved literally. An unquoted string has no active quote delimiter, so `\'` and `` \` `` are not escapes there and the backslash is kept. A backslash immediately before a space or a tab keeps that whitespace as literal content — it belongs to the preserved backslash sequence rather than to the separator whitespace that boundary trimming removes, exactly as an escaped line break is content in a backtick string — so the unquoted value written `\ ` is the two characters backslash and space, its trailing space surviving. An unterminated string, escape, or interpolation is a lexical error.

A control character has no literal form in any string. A C0 control other than a horizontal tab, a line feed, and a carriage return; a `DEL` (`U+007F`); or a C1 control (`U+0080` through `U+009F`), written raw anywhere in the source — inside a string, inside a comment, or between tokens — is `DEON_LEX_INVALID` at its position. Such a character is written with a `\u{…}` escape, the one form that reads back unchanged and keeps canonical output plain text; a tab, a line feed, and a carriage return keep their separator roles and their `\t`, `\n`, and `\r` escapes.

The line-break escapes are what make every string writable. An unquoted string ends at a newline, a single-quoted string may not cross one, and a backtick string trims the whitespace at its boundaries, so without them a value such as `alpha` followed by a line feed would have no representation at all, and the round trip required by section 13 could not hold.

### 4.4 Names

An unquoted map key or declaration name uses letters, digits, `_`, or `-`. Single quotes permit any non-newline name. A name is compared after unquoting and escape decoding.

A name is never interpolated. A quoted name is lexed as a single-quoted string (section 4.3) — the same `\\`, `\'`, `\n`, `\r`, `\t`, and `\#{` escapes decode identically — with the single difference that a `#{…}` in name position is literal text rather than a resolved reference. The key written `'a#{n}'` is the literal name `a#{n}`, never a lookup of `n` and never the truncated `a`. This holds wherever a name appears — a map key, a declaration name, a call-argument name, a structure field, and the head or a bracket segment of a reference, so that `#'a#{n}'` and `#items['a#{n}']` name the literal key `a#{n}` — so a name's identity never depends on evaluation. Written back, a name that is not a bare-name is single-quoted and escaped exactly as a single-string value — `#{` included, rendered as `\#{` — so the name `a#{n}` is written `'a\#{n}'` and round-trips to itself; the escape is inert in name position but keeps one conservative spelling.

## 5. Maps and lists

A map is enclosed in `{` and `}`. Each entry contains a key and an optional value. An omitted value is the empty string.

A list is enclosed in `[` and `]`. Every item is a value; `''` represents an empty item.

Maps are constructed from top to bottom. Every explicit entry and spread writes at its source position. A later write replaces an earlier value and moves the key to its final write position. Direct repeated keys are valid; a linter SHOULD report `DEON_LINT_DUPLICATE_KEY`. Replacements caused by spread do not warn.

## 6. Root and leaflinks

The unnamed top-level map or list is the root. Every other top-level named value is a leaflink declaration.

`#name` evaluates a leaflink. Within a map, the shortened form uses the final access segment as the receiving key. `key #name` uses the explicit receiving key. Within a list, a link contributes one item.

Dot access (`#entity.name`) and bracket access (`#entity[name]`, `#items[0]`) navigate maps and lists. A dot segment is always a map key. A bracket segment is a **list index** only when its content is a run of decimal digits — leading zeros are permitted and the digits are read as the integer — and is otherwise a **map key**: a quoted string, or else the exact characters written between the brackets. A quoted or dotted segment is therefore never a list index, so `#items['0']` and `#items.0` look up the key `0` rather than the first element, and `#items[1.0]` looks up the key `1.0`. A bracket segment must not be empty, and whitespace inside it ends the segment — so a space before the closing `]` is `DEON_PARSE_EXPECTED` at that space, and `[]` is `DEON_PARSE_EXPECTED` at the `]`. A quoted initial name is parsed before access segments.

Accessing a missing map key, a non-container, an out-of-range list index, or a list index too large to represent is `DEON_UNRESOLVED_LINK`. An index is well-formed but unresolved when it names no position the list holds; it is never a crash and never a silently clamped element.

`#$NAME` reads the evaluation environment. An absent environment name evaluates to the empty string. Environment values are always strings. The evaluation environment is exactly the environment supplied to the parse; an implementation MUST NOT consult the host process environment, so a name the caller did not supply is empty even when the host defines it — otherwise a document could read host secrets that were never handed to it. A tool that wants the host environment available to a document, such as the command-line interface, supplies it explicitly.

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

The signature contains unique map keys; a repeated field name is `DEON_STRUCTURE_ARITY` at the signature's opening `<`. Cells may contain any Deon value. A logical row ends at a newline with balanced nesting, and cells are comma separated. A single trailing comma before the row's end contributes no cell, as in a map or list. Every row MUST contain exactly the signature arity, counted after any trailing comma is discarded. The example evaluates to `[{ id: "1", name: "One" }, { id: "2", name: "Two" }]`. A structure with a signature but no rows is permitted and evaluates to the empty list `[]`; the signature still constrains any rows that are present, of which there are none.

## 9. Imports and injections

`import name from target` loads `target`, parses it as Deon or JSON, and binds its root to `name`. `inject name from target` binds the UTF-8 resource text without parsing it. Either statement may end with `with authenticator`, where the authenticator is a literal string, environment link, or leaflink resolving to a string.

Relative filesystem targets resolve against the containing file. Relative URL targets resolve against the containing URL. The path separator is `/`, and only `/`, as in a URL: a backslash is an ordinary character in a target, never a separator, so a target means the same thing on every platform and a containment check cannot be evaded by spelling one climb with a backslash. Resolution normalizes `.` and `..` segments with a stack — a `.` segment drops and a `..` segment pops the segment before it — and a `..` with nothing to pop, one that would climb above the base, is **kept** as a leading `..` in the resolved target rather than discarded, so `a/../../b` resolves to `../b` and a containment or capability check observes the climb rather than a silently rewritten path.

An import target's format is selected from the extension of its path alone. For a URL the `?` query and `#` fragment are removed before the extension is examined, so `https://host/data.json?v=2` selects JSON while `https://host/data?x=1` has no extension. When an import target has no extension, `.deon` is appended. `.json` selects JSON conversion; other import extensions are resource-format errors. The extension is matched literally, exactly as written: `.json` and `.deon` are recognized only in lower case, and a differently-cased spelling such as `.JSON` is an other extension and so a resource-format error, never folded to the one it resembles. A leading dot is not an extension: a last path segment that begins with a `.` and holds no other dot, such as `.env`, has no extension at all — the dot names a hidden file rather than a format — and so takes the appended `.deon`, resolving `./.env` to `./.env.deon`. Injection retains the target exactly.

The `absolutePaths` option maps logical absolute targets to host paths. Exact keys win before wildcard keys ending in `/*`; among wildcards, the longest prefix wins and the unmatched suffix is appended to the mapped directory. The mapping is a property of the target rather than of whoever resolves it: a resource supplied to the evaluator directly MUST map exactly as one read from a host, or a document would mean one thing when its resources are handed over and another when they are read from a disk.

The `authorization` option is keyed by a lowercase exact hostname. An explicit `with` value takes precedence. A non-empty token is sent as `Authorization: Bearer <token>`; an empty token sends no header. Tokens MUST NOT appear in diagnostics or cache identifiers in plain text.

Non-success HTTP status, invalid UTF-8, invalid imported syntax, denied capabilities, and I/O errors each fail the complete evaluation. A resource whose bytes are not valid UTF-8 is `DEON_RESOURCE_FORMAT`, the same code as an unsupported import extension or malformed JSON — the resource was read, and its content is the problem — and distinct from the `DEON_RESOURCE_IO` of a target that could not be read or returned a non-success status. Canonical resource identifiers participate in cycle detection. Authenticated cache entries MUST be separated by a digest of the credential.

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

`#{reference}` may occur any number of times in any string form. A reference is resolved using the same access rules as a leaflink and MUST produce a string. The reference is written immediately between the braces with no surrounding whitespace and MUST NOT be empty: `#{}` and `#{ name }` are `DEON_PARSE_EXPECTED`, not an empty or trimmed reference. Every occurrence is replaced. A backslash keeps an interpolation literal. Where `\#{` is followed by a non-empty, whitespace-free reference closed by `}` — the reference a real `#{…}` would take — the *escaped interpolation* `\#{reference}` is kept as the literal characters `#{reference}` rather than resolved, wherever it appears, including immediately beside other text (`p\#{x}q` is the literal string `p#{x}q`); an empty reference `\#{}` is `DEON_PARSE_EXPECTED` exactly as `#{}` is. Where no `}` closes the reference before a whitespace, a value-ending delimiter, or the end of the string, the `\#{` is simply the two literal characters `#{` and reading continues (`p\#{q ` is the literal string `p#{q`), so a literal `#{` can always be written. Whether an escaped interpolation begins a value or falls within it makes no difference.

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

Depth bounds how deeply a value nests; it does not bound how *large* a value grows. A document of a few lines can name a leaflink that interpolates two copies of another, which interpolates two copies of a third, so that a value doubles at each step and a thirty-line document assembles gigabytes — the same shape as an XML *billion laughs*. An implementation MUST bound this expansion. It maintains an **expansion counter**, the number of Unicode code points it has produced by *substituting* one value into another, initially zero: each interpolation adds the code-point length of the string it substitutes, and each string spread adds the code-point length it copies. When the counter exceeds the configured limit, evaluation stops with `DEON_LIMIT_EXCEEDED`, reported at the start of the document. The counter measures substituted work and not the source, so a literal string, however long, is the size its author wrote and is never expansion.

The expansion limit is host-configurable and defaults to **67108864** (`2^26`) code points — far past any expansion a document has cause to perform, and far below what exhausts a host. A host that parses hostile input MAY set it lower; a host assembling a known-large document MAY set it higher; setting it to zero selects the default rather than an unbounded evaluation, because expansion is always bounded.

### 11.2 Where a diagnostic points

A cycle is reported at the **reference that closes it**, not at the declaration that opens it: the declaration is well-formed on its own, and it is the reference back into it that made the loop.

A diagnostic arising from an imported or injected resource — a syntax error inside it, an unreadable target, a denied capability, an authenticator that is not a string — is reported at the span of the **statement that imported it**, and the resource's own location appears in the import trace. The document a caller is holding is the importing one, and the line they can go and look at is the import. An authenticator that is not a string is `DEON_TYPE_MISMATCH`, not a resource-format error: nothing has been fetched when it is evaluated, so there is no resource whose format could be wrong — only a value of the wrong shape.

The remaining positions are fixed so that two implementations underline the same character:

- a link's diagnostic — unresolved, or a cycle it closes — is at its `#`, not at the name after it;
- a spread's diagnostic is at its `...`, the operator that asked for the merge, not at the reference it names;
- an entity-call argument fault — an unknown, missing, duplicate, or non-string argument — is at the opening `(` of the argument list, so that every argument fault underlines the same character; it carries a related span at the start of the offending argument — the unknown, duplicate, or non-string one — while a missing argument carries none, there being nothing written to point at;
- an interpolation's diagnostic is at the string that carries it, not at a position inside it: the reference within was recovered by decoding and has no source position of its own;
- a structure signature with a repeated field is `DEON_STRUCTURE_ARITY` at its opening `<`;
- a document with no root is `DEON_PARSE_ROOT` at the end of the input, the position past its last character, because the absence of a root is not certain until the document has been read to the end.

## 12. Stringification

Ordinary stringification preserves list and final map write order. Defaults are readable output, four spaces, inline values, no generated header, and no generated section comments. Unsafe or ambiguous strings MUST be quoted.

A string MUST be emitted in a form that reads back unchanged. The backtick form is chosen for a value that carries a real line break and qualifies for it — one that begins and ends with a non-whitespace character and contains no carriage return and no other control character — because that is the form that keeps the line break literal; every other string that cannot stand unquoted is single-quoted, with its line breaks, tabs, carriage returns, and control characters written as escapes. A value that qualifies for a backtick string but carries no line break, such as one holding only a tab, is single-quoted rather than backticked: the shorter safe form is the form.

A string MUST be quoted when it is empty; when it begins or ends with a space or a tab; or when it contains any of a single quote `'`, a backtick `` ` ``, a number sign `#`, a comma, a line feed, a carriage return, a tab, a backslash, one of the bracketing delimiters `{`, `}`, `[`, `]`, `(`, `)`, `<`, `>`, a control character (a C0 control other than a tab, a line feed, or a carriage return; a `DEL` `U+007F`; or a C1 control `U+0080` through `U+009F`), or a comment marker (`//` or `/*`). Each of these carries structural meaning where a value may begin or continue — a bare backslash reads as an escape, a bare tab as separating whitespace, a `#` at a token boundary as a link and `#{` as an interpolation, a bracketing delimiter as the edge of a group, a comma or line feed as a separator, a raw control character as a lexical error — so a string carrying one does not reliably read back unquoted. A quote or an interior `#`, which section 4.3 makes harmless literal text, is quoted all the same: two implementations may not disagree about the canonical form of a value (section 13), so where a shorter form and a safer one both read back correctly, the safer one is the form. A control character is written with the `\u{…}` escape, its code point in lowercase hexadecimal with no leading zeros — the escape character is `\u{1b}`, a null is `\u{0}`, a `DEL` is `\u{7f}` — while a tab, a line feed, and a carriage return keep their `\t`, `\n`, and `\r` spellings.

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
- writes every string in the conservative form of §12 — the safer of two forms that both read back unchanged, not merely the shorter one;
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
