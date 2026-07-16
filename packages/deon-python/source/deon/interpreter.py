"""A tree into a value.

Evaluation is atomic (specification 11): the first error ends it, and carries its diagnostics out.

A declaration is evaluated at most once, and the cache is what makes that true — except for an entity
call, where every call evaluates an independent copy, because the arguments are what it is for.
"""

from __future__ import annotations

from typing import Optional

from .diagnostic import DiagnosticCode, Span, error
from .jsonread import read_json
from .options import DEFAULT_EXPANSION, ParseOptions
from .parser import MAX_DEPTH, parse_syntax
from .scanner import escaped_interpolation_end, unicode_scalar
from .resources import (
    DEON_EXTENSION,
    IMPORT,
    JSON_EXTENSION,
    Fetched,
    ResourceMalformed,
    ResourceUnreadable,
    extension_of,
    is_url,
    resolve_absolute_path,
    resolve_target,
)
from .syntax import (
    Access,
    Call,
    Document,
    Entry,
    Leaflink,
    Link,
    LinkEntry,
    ListNode,
    MapNode,
    Reference,
    Resource,
    Scalar,
    SpreadEntry,
    Structure,
    ValueNode,
)
from .token import Token
from .value import DeonMap, Value


class Interpreter:
    def __init__(self, options: ParseOptions, loader) -> None:
        self.options = options
        self.loader = loader

        #: Code points produced by substitution so far, across this document and everything it imports
        #: — one counter for the whole evaluation, so a blow-up split across imports is still caught.
        self.expansion = 0

        #: The ceiling it may reach. Absent or 0 is the default (specification 11); a host names a
        #: smaller number to refuse a document sooner.
        self.expansion_limit = options.expansion if options.expansion > 0 else DEFAULT_EXPANSION

    def charge(self, produced: int) -> None:
        """Count the code points a substitution just produced, and stop before the gigabytes.

        A tiny document can assemble gigabytes by interpolation doubling (`l1 #{l0}#{l0}`, and so on),
        which is a denial of service; the counter bounds it. The check is *after* each addition and the
        moment the count is exceeded evaluation ends, so the assembly never runs to completion. The
        fault is the document as a whole rather than any character inside it, so it is anchored at the
        document start — byte 0, line 1, column 1 (specification 11).
        """
        self.expansion += produced

        if self.expansion > self.expansion_limit:
            raise error(
                DiagnosticCode.LIMIT_EXCEEDED,
                (
                    "Substitution produced more than the expansion budget of "
                    f"{self.expansion_limit} code points."
                ),
                Span.head(self.options.source_name),
            )

    # #region entry
    def run(self, document: Document) -> Value:
        return Evaluator(self, document, self.options).evaluate()
    # #endregion entry

    def load(self, declaration: Resource, options: ParseOptions, token: Optional[str]) -> Fetched:
        """A resource, or a diagnostic saying why not.

        The order is the specification's: the target is resolved, then *mapped*, and only then
        offered to a loader — because the mapping belongs to the target and not to whoever reads it.
        """
        resolved = resolve_target(declaration.target, options)

        # An import target with no extension gets `.deon` (specification 9). An *injection* retains
        # its target exactly, because it is bound as text and there is nothing to choose a reader by.
        if declaration.kind == IMPORT and not extension_of(resolved):
            resolved += DEON_EXTENSION

        mapped = resolve_absolute_path(resolved, options.absolute_paths)

        span = declaration.token.span()

        try:
            fetched = self.loader.load(mapped, declaration.kind, options, token)
        except ResourceMalformed as failure:
            # It was read, and its bytes are not valid UTF-8. The encoding is the fault and not the
            # I/O (specification 1, 9), so it is a format error — reported here, at the statement that
            # imported it, exactly as an invalid-JSON resource is.
            raise error(
                DiagnosticCode.RESOURCE_FORMAT,
                f"The resource '{declaration.target}' is not valid UTF-8: {failure}",
                span,
            ) from None
        except ResourceUnreadable as failure:
            # It was allowed, and it failed. That is a different thing from never having been allowed,
            # and a caller reading the diagnostic has to be able to tell them apart.
            raise error(
                DiagnosticCode.RESOURCE_IO,
                f"The resource '{declaration.target}' could not be read: {failure}",
                span,
            ) from None

        if fetched is None:
            raise error(
                DiagnosticCode.CAPABILITY_DENIED,
                (
                    f"The resource '{declaration.target}' was not permitted: "
                    + ("network access is not allowed." if is_url(mapped) else "filesystem access is not allowed.")
                ),
                span,
            )

        return fetched


class Evaluator:
    def __init__(
        self,
        interpreter: Interpreter,
        document: Document,
        options: ParseOptions,
        opened: Optional[set[str]] = None,
    ) -> None:
        self.interpreter = interpreter
        self.document = document
        self.options = options

        self.declarations: dict[str, Leaflink | Resource] = {}

        #: A declaration is evaluated at most once, and this is what says so.
        self.resolved: dict[str, Value] = {}

        #: What is being resolved right now. A name that is already here is a cycle.
        self.resolving: list[str] = []

        #: The resources already open, by canonical identity — and the document itself is one of them.
        #: It has to be: a document that imports *itself* is the shortest cycle there is, and a set
        #: that held only the documents below this one would never see it, and would recurse until
        #: something else stopped it.
        self.opened: set[str] = set(opened) if opened is not None else {options.source_name}

        self.namespace()

    def namespace(self) -> None:
        """Imports, injections, and leaflinks share one flat namespace (specification 3)."""
        for declaration in self.document.declarations:
            if declaration.name in self.declarations:
                # The primary span stays on the repeat — the character somebody has to go and change.
                # A related span points back at the first declaration, so the reader can see both.
                raise error(
                    DiagnosticCode.DUPLICATE_DECLARATION,
                    f"'{declaration.name}' is declared more than once.",
                    declaration.token.span(),
                    related=[self.declarations[declaration.name].token.span()],
                )

            self.declarations[declaration.name] = declaration

    def evaluate(self) -> Value:
        return self.value(self.document.root, {}, 0)

    # #region values
    def value(self, node: ValueNode, scope: dict[str, str], depth: int) -> Value:
        """A value, and how deep into one we are.

        The depth is carried rather than counted by the stack, because a spread and an entity call
        *compose* depth: a leaflink a hundred deep, spread into a map a hundred deep, is two hundred
        deep, and neither half of it looked like too much on its own.
        """
        if depth > MAX_DEPTH:
            raise error(
                DiagnosticCode.PARSE_EXPECTED,
                "The document nests more deeply than the evaluator will follow.",
                node.token.span(),
            )

        if isinstance(node, Scalar):
            return self.string(node, scope)

        if isinstance(node, MapNode):
            return self.map(node, scope, depth)

        if isinstance(node, ListNode):
            return self.list(node, scope, depth)

        if isinstance(node, Structure):
            return self.structure(node, scope, depth)

        if isinstance(node, Link):
            return self.reference(node.reference, node.token, scope, depth)

        if isinstance(node, Call):
            return self.call(node, scope, depth)

        raise error(
            DiagnosticCode.TYPE_MISMATCH,
            f"Unknown syntax node {type(node).__name__}.",
            node.token.span(),
        )

    def map(self, node: MapNode, scope: dict[str, str], depth: int) -> DeonMap:
        result = DeonMap()

        for entry in node.entries:
            if isinstance(entry, Entry):
                result.insert(entry.name, self.value(entry.value, scope, depth + 1))
                continue

            if isinstance(entry, LinkEntry):
                # The shortened form: the final access segment names the key it arrives under.
                inner = entry.value
                key = inner.reference.receiving_key

                result.insert(key, self.value(inner, scope, depth + 1))
                continue

            if isinstance(entry, SpreadEntry):
                self.spread_into_map(entry, result, scope, depth)

        return result

    def list(self, node: ListNode, scope: dict[str, str], depth: int) -> list:
        result: list = []

        for item in node.items:
            if isinstance(item, SpreadEntry):
                self.spread_into_list(item, result, scope, depth)
                continue

            result.append(self.value(item, scope, depth + 1))

        return result

    def structure(self, node: Structure, scope: dict[str, str], depth: int) -> list:
        """Sugar for a list of maps, and nothing more (specification 8)."""
        rows: list = []

        for row in node.rows:
            entry = DeonMap()

            for name, cell in zip(node.fields, row):
                entry.insert(name, self.value(cell, scope, depth + 1))

            rows.append(entry)

        return rows
    # #endregion values

    # #region spreading
    def spread_into_map(self, entry: SpreadEntry, into: DeonMap, scope: dict[str, str], depth: int) -> None:
        value = self.reference(entry.reference, entry.token, scope, depth + 1)

        if isinstance(value, DeonMap):
            for key, item in value.items():
                into.insert(key, item)

            return

        if isinstance(value, str):
            # A string spreads into a map by decimal character index (specification 7); every code
            # point copied counts against the budget, exactly as an interpolation's would.
            self.interpreter.charge(len(value))

            for index, character in enumerate(value):
                into.insert(str(index), character)

            return

        raise error(
            DiagnosticCode.TYPE_MISMATCH,
            "A list cannot be spread into a map.",
            entry.token.span(),
        )

    def spread_into_list(self, entry: SpreadEntry, into: list, scope: dict[str, str], depth: int) -> None:
        value = self.reference(entry.reference, entry.token, scope, depth + 1)

        if isinstance(value, list):
            into.extend(value)
            return

        if isinstance(value, str):
            # A string spreads into a list as Unicode code points (specification 7); the count copied
            # is charged against the budget before it is copied.
            self.interpreter.charge(len(value))
            into.extend(list(value))
            return

        raise error(
            DiagnosticCode.TYPE_MISMATCH,
            "A map cannot be spread into a list.",
            entry.token.span(),
        )
    # #endregion spreading

    # #region references
    def reference(self, reference: Reference, token: Token, scope: dict[str, str], depth: int) -> Value:
        if reference.environment:
            # An absent environment name is the empty string, and not an error (specification 6).
            return self.options.environment.get(reference.head, "")

        head = reference.head

        # A local shadows an outer leaflink for the duration of the call (specification 10).
        if head in scope:
            base: Value = scope[head]
        elif head in self.declarations:
            base = self.declaration(head, token)
        else:
            raise error(
                DiagnosticCode.UNRESOLVED_LINK,
                f"'{head}' is not declared.",
                token.span(),
            )

        return self.access(base, reference, token)

    def access(self, base: Value, reference: Reference, token: Token) -> Value:
        for segment in reference.access:
            if isinstance(base, DeonMap):
                # A dot segment, a quoted bracket segment, and a bracket segment that is not all
                # digits are all map keys (specification 6); an all-digit segment carries the same
                # text, so a map is navigated by that text either way.
                if segment.name not in base:
                    raise error(
                        DiagnosticCode.UNRESOLVED_LINK,
                        f"'{segment.name}' is not a member of '{reference}'.",
                        token.span(),
                    )

                base = base[segment.name]
                continue

            if isinstance(base, list):
                # A list is addressed by an index and never by a name: a quoted or dotted segment, or
                # a bracket segment that is not all decimal digits, names no position it holds.
                if not segment.by_index:
                    raise error(
                        DiagnosticCode.UNRESOLVED_LINK,
                        f"'{segment.name}' is not a list index.",
                        token.span(),
                    )

                # A well-formed index that names no position — including one too large to hold a
                # value — is unresolved, never a crash and never a clamped element (specification 6).
                if segment.index < 0 or segment.index >= len(base):
                    raise error(
                        DiagnosticCode.UNRESOLVED_LINK,
                        f"The index {segment.index} is outside '{reference}'.",
                        token.span(),
                    )

                base = base[segment.index]
                continue

            raise error(
                DiagnosticCode.UNRESOLVED_LINK,
                f"'{segment.name}' cannot be accessed on a string.",
                token.span(),
            )

        return base

    def declaration(self, name: str, token: Token) -> Value:
        if name in self.resolved:
            return self.resolved[name]

        if name in self.resolving:
            # Reported at the link that closed the cycle rather than at the declaration that opened
            # it. The declaration is innocent on its own — it is the reference back into it that made
            # the loop, and that is the character somebody has to go and delete.
            raise error(
                DiagnosticCode.CYCLE,
                f"'{name}' depends on itself.",
                token.span(),
            )

        declaration = self.declarations[name]

        self.resolving.append(name)

        try:
            if isinstance(declaration, Resource):
                value = self.resource(declaration)
            else:
                value = self.value(declaration.value, {}, 0)
        finally:
            self.resolving.pop()

        self.resolved[name] = value

        return value
    # #endregion references

    # #region resources
    def resource(self, declaration: Resource) -> Value:
        span = declaration.token.span()

        token: Optional[str] = None

        if declaration.authenticator is not None:
            authenticator = self.value(declaration.authenticator, {}, 0)

            if not isinstance(authenticator, str):
                raise error(
                    DiagnosticCode.TYPE_MISMATCH,
                    "A resource authenticator must be a string.",
                    span,
                )

            token = authenticator

        fetched = self.interpreter.load(declaration, self.options, token)

        # A resource that is already open is a cycle, however it spelled its own name: the canonical
        # identity is what is compared, so two spellings of one file are one file.
        if fetched.resource_id in self.opened:
            raise error(
                DiagnosticCode.CYCLE,
                f"The resource '{declaration.target}' imports itself.",
                span,
            )

        if declaration.kind != IMPORT:
            # An injection binds the resource text without parsing it, and retains its target exactly.
            return fetched.data

        filetype = fetched.filetype or DEON_EXTENSION

        if filetype == JSON_EXTENSION:
            return read_json(fetched.data, span)

        if filetype != DEON_EXTENSION:
            raise error(
                DiagnosticCode.RESOURCE_FORMAT,
                f"An imported resource cannot have the extension '{filetype}'.",
                span,
            )

        return self.nested(declaration, fetched, span)

    def nested(self, declaration: Resource, fetched: Fetched, span: Span) -> Value:
        """An imported Deon document, evaluated as one — and only its root is exported.

        A fault inside the imported document is reported *here*, at the statement that imported it,
        rather than at the place it was written. That is what lets a caller act on it: the document
        they are holding is this one, and the line they can go and look at is this line.
        """
        options = ParseOptions(
            source_name=fetched.resource_id,
            filebase=fetched.filebase,
            resources=self.options.resources,
            absolute_paths=self.options.absolute_paths,
            environment=self.options.environment,
            allow_filesystem=self.options.allow_filesystem,
            allow_network=self.options.allow_network,
            authorization=self.options.authorization,
        )

        try:
            document = parse_syntax(fetched.data, fetched.resource_id)

            evaluator = Evaluator(
                self.interpreter,
                document,
                options,
                opened=self.opened | {fetched.resource_id},
            )

            return evaluator.evaluate()
        except Exception as failure:
            raise self.reanchor(failure, declaration, span) from None

    def reanchor(self, failure: Exception, declaration: Resource, span: Span):
        from .diagnostic import DeonError

        if not isinstance(failure, DeonError):
            raise failure

        # A cycle is reported where it closes, which is inside the resource that closed it, so it is
        # left where it is. An exceeded budget is a fault of the evaluation as a whole and stays
        # anchored at the document start (specification 11), not moved onto the import. Everything else
        # is answered at the import.
        kept = failure.code in (DiagnosticCode.CYCLE, DiagnosticCode.LIMIT_EXCEEDED)

        return error(failure.code, failure.message, failure.span if kept else span)
    # #endregion resources

    # #region strings and calls
    def string(self, node: Scalar, scope: dict[str, str]) -> str:
        return decode(node.raw, node.token, lambda reference: self.interpolated(reference, node.token, scope))

    def interpolated(self, reference: Reference, token: Token, scope: dict[str, str]) -> str:
        value = self.reference(reference, token, scope, 0)

        if not isinstance(value, str):
            raise error(
                DiagnosticCode.TYPE_MISMATCH,
                f"An interpolation must resolve to a string, and '{reference}' does not.",
                token.span(),
            )

        # Each `#{…}` substitutes the code points of the resolved string; that is what a blow-up
        # doubles, so it is what the budget counts (specification 11).
        self.interpreter.charge(len(value))

        return value

    def call(self, node: Call, scope: dict[str, str], depth: int) -> Value:
        head = node.reference.head

        if head not in self.declarations:
            raise error(
                DiagnosticCode.UNRESOLVED_LINK,
                f"'{head}' is not declared.",
                node.token.span(),
            )

        declaration = self.declarations[head]

        if not isinstance(declaration, Leaflink):
            raise error(
                DiagnosticCode.TYPE_MISMATCH,
                f"'{head}' is a resource, and a resource cannot be called.",
                node.token.span(),
            )

        # A recursive entity call is a cycle (specification 10).
        if head in self.resolving:
            raise error(
                DiagnosticCode.CYCLE,
                f"The entity '{head}' calls itself.",
                node.token.span(),
            )

        wanted = parameters(declaration.value)

        arguments: dict[str, str] = {}

        for argument in node.arguments:
            if argument.name in arguments:
                # The primary span stays on the opening '(' — every entity-call argument fault points
                # there (specification 11.2) — and the related span marks the repeat, the argument the
                # reader has to remove.
                raise error(
                    DiagnosticCode.ENTITY_ARGUMENT,
                    f"The argument '{argument.name}' is given more than once.",
                    node.token.span(),
                    related=[argument.token.span()],
                )

            value = self.value(argument.value, scope, depth + 1)

            if not isinstance(value, str):
                # Primary on the '(' as above; related on the offending argument, the one whose value
                # is not a string.
                raise error(
                    DiagnosticCode.ENTITY_ARGUMENT,
                    f"The argument '{argument.name}' must be a string.",
                    node.token.span(),
                    related=[argument.token.span()],
                )

            arguments[argument.name] = value

        given = set(arguments)

        if given != wanted:
            missing = sorted(wanted - given)
            extra = sorted(given - wanted)

            # Primary on the '(' as with every entity-call argument fault (specification 11.2). An
            # unknown argument is one the reader typed, so the related span points at the first one; a
            # purely-missing call has no offending argument to point at, so it carries none.
            related: list[Span] = []
            if extra:
                unknown = next(argument for argument in node.arguments if argument.name in set(extra))
                related = [unknown.token.span()]

            raise error(
                DiagnosticCode.ENTITY_ARGUMENT,
                f"Entity arguments do not match; missing {missing}, extra {extra}.",
                node.token.span(),
                related=related,
            )

        self.resolving.append(head)

        try:
            # Every call evaluates an independent copy, and the arguments are the only scope it has:
            # a local shadows an outer leaflink, and nothing of the caller's scope leaks in.
            value = self.value(declaration.value, arguments, depth + 1)
        finally:
            self.resolving.pop()

        return self.access(value, node.reference, node.token)
    # #endregion strings and calls


# #region interpolation
def decode(raw: str, token: Token, resolve) -> str:
    """The escapes, and the interpolations, in one pass over the source text.

    The two belong together: a `\\#{` must not become an interpolation, and a `#{` must not be read as
    text, so whatever decides one has to decide the other. Every occurrence is replaced
    (specification 10), and what a replacement puts in is *not* looked at again — an argument whose
    value happens to contain `#{secret}` is a user who typed some characters, not a link into the
    document it was passed to.
    """
    out: list[str] = []
    index = 0
    length = len(raw)

    while index < length:
        character = raw[index]

        if character == "\\" and index + 1 < length:
            following = raw[index + 1]

            if following == "\\":
                out.append("\\")
                index += 2
                continue

            if following in ("'", "`"):
                out.append(following)
                index += 2
                continue

            if following == "n":
                out.append("\n")
                index += 2
                continue

            if following == "r":
                out.append("\r")
                index += 2
                continue

            if following == "t":
                out.append("\t")
                index += 2
                continue

            if raw.startswith("u{", index + 1):
                # A `\u{…}` escape decodes to the Unicode scalar value it names (specification 4.3).
                # The scanner has already proven every escape well-formed and anchored any malformed
                # one at its backslash, so a valid code point is assured here; the guard only keeps a
                # decode from ever reaching `chr(None)`, and cannot itself be taken.
                closing = raw.find("}", index + 3)
                code = unicode_scalar(raw[index + 3 : closing]) if closing != -1 else None

                if code is not None:
                    out.append(chr(code))
                    index = closing + 1
                    continue

            if raw.startswith("#{", index + 1):
                # An escaped interpolation `\#{reference}` is validated exactly like the real
                # interpolation it mirrors — an empty or whitespace reference is the same
                # `DEON_PARSE_EXPECTED` at the same `#{`-relative position — but its characters are
                # kept literally rather than resolved (specification 4.3, 10). When no `}` closes the
                # reference before whitespace, the `\#{` is a plain escape for the characters `#{`.
                closing = escaped_interpolation_end(raw, index + 1)

                if closing is not None:
                    inner = raw[index + 3 : closing]
                    parse_reference(inner, token)
                    out.append("#{")
                    out.append(inner)
                    out.append("}")
                    index = closing + 1
                    continue

                out.append("#{")
                index += 3
                continue

            # Every other backslash sequence is preserved literally (specification 4.3).
            out.append(character)
            index += 1
            continue

        if raw.startswith("#{", index):
            closing = raw.find("}", index + 2)

            if closing == -1:
                raise error(
                    DiagnosticCode.LEX_UNTERMINATED,
                    "Unterminated interpolation.",
                    token.span(),
                )

            inner = raw[index + 2 : closing]

            out.append(resolve(parse_reference(inner, token)))
            index = closing + 1
            continue

        out.append(character)
        index += 1

    return "".join(out)


def parse_reference(text: str, token: Token) -> Reference:
    """The reference inside a `#{...}`, which the scanner consumed but did not read.

    The reference is written immediately between the braces, with no surrounding whitespace, and it
    must not be empty (specification 10): `#{}` and `#{ name }` are `DEON_PARSE_EXPECTED`, not an
    empty or a trimmed reference. A fault is anchored at the string that carries the interpolation
    (specification 11.2): the reference was recovered by decoding and has no source position of its
    own, so the diagnostic points at the carrying string token's own start rather than at a position
    inside it. Its access segments obey the same key/index rule as a leaflink: a dot or quoted
    segment is a key, and a bracket segment is an index only when it is all decimal digits.
    """
    from .scanner import NAME_CHARACTERS

    stops = " \t\n,{}[]()<>'`"

    def fault(offset: int):
        # Specification 11.2: an interpolation's diagnostic is at the string that carries it, not at a
        # position inside it. The reference was recovered by decoding and has no source position of its
        # own, so `offset` — an index into that decoded text — is not a source position and is
        # deliberately unused: the fault anchors at the carrying string token's own span.
        return error(
            DiagnosticCode.PARSE_EXPECTED,
            "An interpolation names a reference written immediately between its braces.",
            token.span(),
        )

    def quoted(at: int) -> tuple[str, int]:
        # `at` points at the opening quote; return the content and the index past the closing quote.
        cursor = at + 1
        content: list[str] = []

        while cursor < len(text):
            character = text[cursor]

            if character == "\\" and cursor + 1 < len(text):
                content.append(text[cursor + 1])
                cursor += 2
                continue

            if character == "'":
                return "".join(content), cursor + 1

            content.append(character)
            cursor += 1

        raise fault(at)

    length = len(text)

    if text.startswith("$"):
        index = 1

        while index < length and text[index] in NAME_CHARACTERS:
            index += 1

        if index == 1 or index != length:
            raise fault(1 if index == 1 else index)

        return Reference(head=text[1:index], environment=True)

    if length and text[0] == "'":
        head, index = quoted(0)
    else:
        index = 0

        while index < length and text[index] in NAME_CHARACTERS:
            index += 1

        if index == 0:
            raise fault(0)

        head = text[:index]

    access: list[Access] = []

    while index < length:
        character = text[index]

        if character == ".":
            index += 1
            begin = index

            while index < length and text[index] in NAME_CHARACTERS:
                index += 1

            if index == begin:
                raise fault(begin)

            access.append(Access(name=text[begin:index]))
            continue

        if character == "[":
            index += 1

            if index < length and text[index] == "'":
                name, index = quoted(index)
                access.append(Access(name=name))
            else:
                begin = index
                digits = True

                while index < length and text[index] != "]" and text[index] not in stops:
                    if text[index] not in "0123456789":
                        digits = False

                    index += 1

                content = text[begin:index]

                if content == "":
                    raise fault(begin)

                if digits:
                    access.append(Access(name=content, by_index=True, index=int(content)))
                else:
                    access.append(Access(name=content))

            if index >= length or text[index] != "]":
                raise fault(index)

            index += 1
            continue

        # Anything else — an interior space, a stray character — where a `.`, a `[`, or the end of
        # the reference was due: it did not end cleanly, which is the fault section 10 forbids.
        raise fault(index)

    return Reference(head=head, access=tuple(access))


def parameters(node: ValueNode) -> set[str]:
    """What an entity would demand.

    The interpolation names an entity carries *are* its parameter set (specification 10) — nothing
    declares them. Note what this does not include: a `#link` is a link, which the document resolves
    for itself, and stays a private piece of it. Only a `#{hole}` is a hole, and a hole is a parameter
    even where a leaflink of the same name is sitting right there.
    """
    found: set[str] = set()

    def walk(current: ValueNode) -> None:
        if isinstance(current, Scalar):
            found.update(interpolations(current.raw))
            return

        if isinstance(current, MapNode):
            for entry in current.entries:
                if isinstance(entry, Entry):
                    walk(entry.value)
            return

        if isinstance(current, ListNode):
            for item in current.items:
                if not isinstance(item, SpreadEntry):
                    walk(item)
            return

        if isinstance(current, Structure):
            for row in current.rows:
                for cell in row:
                    walk(cell)
            return

        if isinstance(current, Call):
            for argument in current.arguments:
                walk(argument.value)

    walk(node)

    return found


def interpolations(raw: str) -> list[str]:
    """Every `#{name}` in a string, as the name it would ask for. An escaped `\\#{` asks for nothing."""
    names: list[str] = []
    index = 0

    while index < len(raw):
        if raw[index] == "\\":
            index += 3 if raw.startswith("#{", index + 1) else 2
            continue

        if raw.startswith("#{", index):
            closing = raw.find("}", index + 2)

            if closing == -1:
                break

            inner = raw[index + 2 : closing].strip()

            if inner and not inner.startswith("$"):
                head = inner.split(".")[0].split("[")[0].strip()

                if head:
                    names.append(head)

            index = closing + 1
            continue

        index += 1

    return names
# #endregion interpolation
