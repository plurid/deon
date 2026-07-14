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

An unquoted string continues until an unnested comma, newline, or enclosing delimiter. Leading separator whitespace is excluded; other internal whitespace is retained as single source characters.

An unquoted string MUST NOT contain a newline, a comma, or any of the delimiters `{`, `}`, `[`, `]`, `(`, `)`, `<`, `>`, `'`, and `` ` ``. These are delimiters wherever they occur and no surrounding text makes them ordinary: a value that requires one of them must be quoted, and one written bare is `DEON_PARSE_EXPECTED` at the delimiter. Every other character may appear, which is what allows a path, a URL, or a flag to be written with no quotes at all.

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

The signature contains unique map keys. Cells may contain any Deon value. A logical row ends at a newline with balanced nesting, and cells are comma separated. Every row MUST contain exactly the signature arity. The example evaluates to `[{ id: "1", name: "One" }, { id: "2", name: "Two" }]`.

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

A value handed to a stringifier or to the typer by a host, rather than by the parser, is subject to the same limit.

### 11.2 Where a diagnostic points

A cycle is reported at the **reference that closes it**, not at the declaration that opens it: the declaration is well-formed on its own, and it is the reference back into it that made the loop.

A diagnostic arising from an imported or injected resource — a syntax error inside it, an unreadable target, a denied capability, an authenticator that is not a string — is reported at the span of the **statement that imported it**, and the resource's own location appears in the import trace. The document a caller is holding is the importing one, and the line they can go and look at is the import.

## 12. Stringification

Ordinary stringification preserves list and final map write order. Defaults are readable output, four spaces, inline values, no generated header, and no generated section comments. Unsafe or ambiguous strings MUST be quoted.

A string MUST be emitted in a form that reads back unchanged. A backtick string therefore carries a value only when that value begins and ends with a non-whitespace character and contains no carriage return; every other string that cannot stand unquoted is single-quoted, with its line breaks, tabs, and carriage returns written as escapes.

A string MUST be quoted when it is empty, when it begins or ends with whitespace, when it begins with `#`, when it contains a delimiter of section 4.3, when it contains `#{`, or when it contains a comment marker (`//` or `/*`). The comment marker is quoted even though a marker inside a token is ordinary text and would read back unchanged: two implementations may not disagree about the canonical form of a value (section 13), so where a shorter form and a safer one both read back correctly, the safer one is the form.

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

Typing is outside the Deon data model. The optional common typer converts exact `true` and `false`, integers within the IEEE-754 safe 53-bit range matching `-?(0|[1-9][0-9]*)`, and finite decimal/exponent forms without leading zeroes. Empty strings, leading-zero values, out-of-range numbers, and `null` remain strings. Datasign integration is an optional post-parse adapter.

## 15. Conformance

An implementation conforms to Deon 1.0 only when it passes every required fixture in `spec/conformance/cases.json`, produces the required diagnostic code and source position for invalid fixtures, and satisfies canonical round trips. Tests MUST use injected or local resource resolvers rather than public network services.
