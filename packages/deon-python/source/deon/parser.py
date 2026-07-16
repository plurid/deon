"""Tokens into a tree.

Recursive descent, with one thing the grammar does not mention and every implementation needs: a
limit on how deeply a document may nest. A document is data, and data arrives from places that do not
wish the reader well. Without a limit the parser recurses until the interpreter's stack runs out, and
what a caller gets back is a `RecursionError` — an error with no code, no position, and nothing anyone
can act on. Past the limit it gets a diagnostic instead, which says what happened and where.
"""

from __future__ import annotations

from .diagnostic import Diagnostic, DiagnosticCode, error
from .options import DEFAULT_SOURCE_NAME
from .scanner import NAME_CHARACTERS, decode_name, scan
from .syntax import (
    Argument,
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
from .token import KEYWORDS, Token, TokenType


#: How deeply a document may nest before the parser refuses to follow it.
#:
#: The specification does not name a number, and a conforming implementation needs one: the
#: conformance suite requires a document nesting past this to be refused with `DEON_PARSE_EXPECTED`
#: at the opening token of the offending value. 128 is far past any nesting a person would write, and
#: far below the depth at which a recursive walk would take the process down with it.
MAX_DEPTH = 128


BOUNDARIES = frozenset({TokenType.NEWLINE, TokenType.COMMA})

DECLARATION_STOPS = frozenset({TokenType.NEWLINE, TokenType.COMMA, TokenType.EOF})
MAP_STOPS = frozenset({TokenType.NEWLINE, TokenType.COMMA, TokenType.RIGHT_CURLY, TokenType.EOF})
LIST_STOPS = frozenset({TokenType.NEWLINE, TokenType.COMMA, TokenType.RIGHT_SQUARE, TokenType.EOF})
CALL_STOPS = frozenset({TokenType.NEWLINE, TokenType.COMMA, TokenType.RIGHT_PAREN, TokenType.EOF})
ROW_STOPS = frozenset({TokenType.NEWLINE, TokenType.COMMA, TokenType.RIGHT_SQUARE, TokenType.EOF})


def is_bare_name(text: str) -> bool:
    return bool(text) and all(character in NAME_CHARACTERS for character in text)


class Parser:
    def __init__(
        self,
        tokens: list[Token],
        source: str,
        source_name: str,
        comments: list[tuple[int, int]] | None = None,
    ) -> None:
        self.tokens = tokens
        self.source = source
        self.source_name = source_name
        self.comments = comments or []

        self.current = 0
        self.depth = 0

    # #region the cursor
    def peek(self, ahead: int = 0) -> Token:
        index = min(self.current + ahead, len(self.tokens) - 1)

        return self.tokens[index]

    def previous(self) -> Token:
        return self.tokens[self.current - 1]

    def check(self, type: str) -> bool:
        return self.peek().type == type

    def match(self, type: str) -> bool:
        if self.check(type):
            self.advance()
            return True

        return False

    def advance(self) -> Token:
        if not self.check(TokenType.EOF):
            self.current += 1

        return self.previous()

    def consume(self, type: str, message: str) -> Token:
        if self.check(type):
            return self.advance()

        raise self.fail(DiagnosticCode.PARSE_EXPECTED, message)

    def fail(self, code: str, message: str, token: Token | None = None):
        return error(code, message, (token or self.peek()).span())

    def reject_unterminated(self, token: Token) -> None:
        """The verdict the scanner deferred (specification 4.3).

        A word the scanner marked began with a quote that never closed. That is ordinary literal text
        only where it *continues* an unquoted value; standing where a value, a name, or a target
        begins, it is the unterminated string it looks like, reported at its opening quote — which is
        this token's own start.
        """
        if token.unterminated_quote:
            raise self.fail(DiagnosticCode.LEX_UNTERMINATED, "Unterminated string.", token)

    def separators(self) -> None:
        while self.peek().type in BOUNDARIES:
            self.advance()

    def newlines(self) -> None:
        while self.check(TokenType.NEWLINE):
            self.advance()
    # #endregion the cursor

    def parse(self) -> Document:
        declarations: list[Leaflink | Resource] = []
        root: MapNode | ListNode | None = None

        self.separators()

        while not self.check(TokenType.EOF):
            token = self.peek()

            if token.type == TokenType.WORD and token.raw in ("import", "inject"):
                declarations.append(self.resource())
            elif self.check(TokenType.LEFT_CURLY) or self.check(TokenType.LEFT_SQUARE):
                if root is not None:
                    raise self.fail(
                        DiagnosticCode.PARSE_ROOT,
                        "A document may contain only one root map or list.",
                    )

                root = self.map() if self.check(TokenType.LEFT_CURLY) else self.list()
            else:
                declarations.append(self.leaflink())

            self.separators()

        if root is None:
            raise self.fail(
                DiagnosticCode.PARSE_ROOT,
                "A document requires one root map or list.",
            )

        return Document(declarations=declarations, root=root, source=self.source_name)

    # #region declarations
    def resource(self) -> Resource:
        keyword = self.advance()
        name = self.name("Expected a resource declaration name.")

        if not (self.check(TokenType.WORD) and self.peek().raw == "from"):
            raise self.fail(DiagnosticCode.PARSE_EXPECTED, "Expected 'from' in a resource declaration.")

        self.advance()

        target = self.atom("Expected a resource target.")

        authenticator: ValueNode | None = None

        if self.check(TokenType.WORD) and self.peek().raw == "with":
            self.advance()
            authenticator = self.value(DECLARATION_STOPS)

        return Resource(
            kind=keyword.raw,
            name=name,
            target=target,
            authenticator=authenticator,
            token=keyword,
        )

    def leaflink(self) -> Leaflink:
        name_token = self.peek()
        name = self.name("Expected a declaration name.")

        # A declaration with nothing after it holds the empty string.
        if self.peek().type in DECLARATION_STOPS:
            value: ValueNode = Scalar(raw="", token=name_token)
        else:
            value = self.value(DECLARATION_STOPS)

        return Leaflink(name=name, value=value, token=name_token)
    # #endregion declarations

    # #region values
    def value(self, stops: frozenset[str]) -> ValueNode:
        """Every value passes through here, which is what makes one guard enough."""
        self.depth += 1

        try:
            if self.depth > MAX_DEPTH:
                raise self.fail(
                    DiagnosticCode.PARSE_EXPECTED,
                    "The document nests more deeply than the parser will follow.",
                )

            return self.value_inner(stops)
        finally:
            self.depth -= 1

    def value_inner(self, stops: frozenset[str]) -> ValueNode:
        if self.check(TokenType.LEFT_CURLY):
            return self.map()

        if self.check(TokenType.LEFT_SQUARE):
            return self.list()

        if self.check(TokenType.LEFT_ANGLE):
            return self.structure()

        if self.check(TokenType.LINK):
            return self.link_or_call()

        return self.scalar(stops)

    def link_or_call(self) -> Link | Call:
        token = self.advance()
        link = Link(reference=token.literal, token=token)

        # `#name(` is a call, and the parenthesis must touch the reference: the grammar puts no space
        # between them, so `#name (note)` is a link followed by some text and not a call with no name.
        if self.check(TokenType.LEFT_PAREN) and self.peek().start == token.end:
            return self.call(link)

        return link

    def call(self, link: Link) -> Call:
        opening = self.consume(TokenType.LEFT_PAREN, "Expected '(' to open the call arguments.")

        arguments: list[Argument] = []

        self.separators()

        while not self.check(TokenType.RIGHT_PAREN) and not self.check(TokenType.EOF):
            name_token = self.peek()
            name = self.name("Expected a call argument name.")

            value = self.value(CALL_STOPS)

            arguments.append(Argument(name=name, value=value, token=name_token))

            if not self.check(TokenType.RIGHT_PAREN):
                if self.check(TokenType.EOF):
                    break

                if self.peek().type not in BOUNDARIES:
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "Expected a separator between call arguments.",
                    )

                self.separators()

        self.consume(TokenType.RIGHT_PAREN, "Expected ')' after the call arguments.")

        # The call is anchored at its parenthesis rather than at its name, because what goes wrong
        # with a call is its arguments, and that is where they are.
        return Call(reference=link.reference, arguments=arguments, token=opening)

    def map(self) -> MapNode:
        opening = self.consume(TokenType.LEFT_CURLY, "Expected '{'.")

        entries: list = []

        # Only newlines lead a map; a leading comma survives to the entry below, where `name` reports
        # it. A comma falls *between* two entries, so one with none before it — leading the map or
        # standing alone in it — is `DEON_PARSE_EXPECTED` at the comma (specification 4.1).
        self.newlines()

        while not self.check(TokenType.RIGHT_CURLY) and not self.check(TokenType.EOF):
            if self.check(TokenType.SPREAD):
                token = self.advance()
                entries.append(SpreadEntry(reference=token.literal, token=token))
            elif self.check(TokenType.LINK):
                # The shortened form: the link names the key it arrives under.
                token = self.peek()
                entries.append(LinkEntry(value=self.link_or_call(), token=token))
            else:
                name_token = self.peek()
                name = self.name("Expected a map key.")

                if self.check(TokenType.LEFT_ANGLE):
                    value: ValueNode = self.value(MAP_STOPS)
                elif self.peek().type in MAP_STOPS:
                    value = Scalar(raw="", token=name_token)
                else:
                    value = self.value(MAP_STOPS)

                entries.append(Entry(name=name, value=value, token=name_token))

            if not self.check(TokenType.RIGHT_CURLY):
                if self.check(TokenType.EOF):
                    break

                if self.peek().type not in BOUNDARIES:
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "Expected a separator between map entries.",
                    )

                self.separators()

        self.consume(TokenType.RIGHT_CURLY, "Expected '}' after the map entries.")

        return MapNode(entries=entries, token=opening)

    def list(self) -> ListNode:
        opening = self.consume(TokenType.LEFT_SQUARE, "Expected '['.")

        items: list = []

        # Only newlines lead a list; a leading comma is caught below. A comma falls *between* two
        # items, so one with none before it — leading the list or standing alone in it — is
        # `DEON_PARSE_EXPECTED` at the comma, and an empty item is written `''` (specification 4.1, 5).
        self.newlines()

        while not self.check(TokenType.RIGHT_SQUARE) and not self.check(TokenType.EOF):
            if self.check(TokenType.COMMA):
                raise self.fail(
                    DiagnosticCode.PARSE_EXPECTED,
                    "A list item was expected before this comma.",
                )

            if self.check(TokenType.SPREAD):
                token = self.advance()
                items.append(SpreadEntry(reference=token.literal, token=token))
            else:
                items.append(self.value(LIST_STOPS))

            if not self.check(TokenType.RIGHT_SQUARE):
                if self.check(TokenType.EOF):
                    break

                if self.peek().type not in BOUNDARIES:
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "Expected a separator between list items.",
                    )

                self.separators()

        self.consume(TokenType.RIGHT_SQUARE, "Expected ']' after the list items.")

        return ListNode(items=items, token=opening)

    def structure(self) -> Structure:
        opening = self.consume(TokenType.LEFT_ANGLE, "Expected '<' to open a structure signature.")

        fields: list[str] = []

        self.separators()

        while not self.check(TokenType.RIGHT_ANGLE) and not self.check(TokenType.EOF):
            fields.append(self.name("Expected a structure field name."))

            if not self.check(TokenType.RIGHT_ANGLE):
                if self.check(TokenType.EOF):
                    break

                if self.peek().type not in BOUNDARIES:
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "Expected a separator between structure fields.",
                    )

                self.separators()

        self.consume(TokenType.RIGHT_ANGLE, "Expected '>' after the structure signature.")

        # The signature contains unique map keys (specification 8). A field written twice would give
        # a row two cells with one destination, so the row can no longer mean what it says.
        if len(set(fields)) != len(fields):
            raise self.fail(
                DiagnosticCode.STRUCTURE_ARITY,
                "A structure signature must not repeat a field name.",
                opening,
            )

        self.newlines()
        self.consume(TokenType.LEFT_SQUARE, "Expected '[' to open the structure rows.")

        rows: list[list[ValueNode]] = []

        self.newlines()

        while not self.check(TokenType.RIGHT_SQUARE) and not self.check(TokenType.EOF):
            if self.check(TokenType.COMMA):
                raise self.fail(
                    DiagnosticCode.PARSE_EXPECTED,
                    "A structure row begins with a cell, not a comma.",
                )

            cells: list[ValueNode] = [self.value(ROW_STOPS)]

            # A logical row ends at a newline with balanced nesting; a comma separates the cells
            # within it. A single trailing comma before the row's end — a newline, the closing ']',
            # or the end of input — contributes no cell, as in a map or a list, and the arity is
            # counted after it is discarded (specification 4.1, 8). A second comma with no cell before
            # it is `DEON_PARSE_EXPECTED` at that comma.
            while self.check(TokenType.COMMA):
                self.advance()

                if (
                    self.check(TokenType.NEWLINE)
                    or self.check(TokenType.RIGHT_SQUARE)
                    or self.check(TokenType.EOF)
                ):
                    break

                if self.check(TokenType.COMMA):
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "A structure cell was expected before this comma.",
                    )

                cells.append(self.value(ROW_STOPS))

            if len(cells) != len(fields):
                raise self.fail(
                    DiagnosticCode.STRUCTURE_ARITY,
                    f"A structure row must hold {len(fields)} cells, and this one holds {len(cells)}.",
                    opening,
                )

            rows.append(cells)

            self.newlines()

        self.consume(TokenType.RIGHT_SQUARE, "Expected ']' after the structure rows.")

        return Structure(fields=fields, rows=rows, token=opening)

    def scalar(self, stops: frozenset[str]) -> Scalar:
        first = self.peek()

        # A value that *begins* with an unterminated quote is the unterminated string it looks like.
        self.reject_unterminated(first)

        if first.type in stops:
            return Scalar(raw="", token=first)

        # A quoted string standing alone is a whole value: it carries its own delimiters, so it needs
        # no slicing and its content already says what it says.
        if first.type == TokenType.STRING and self.peek(1).type in stops:
            self.advance()

            return Scalar(raw=first.raw, token=first)

        last = first
        started = False

        while self.peek().type not in stops:
            token = self.peek()

            # A bracket, a parenthesis, or an angle is a *delimiter*, and no amount of surrounding
            # text makes it text. A value that wants one has to be quoted, and one written bare is a
            # value that would parse as something else — which is the error being reported, at the
            # character that would have done it.
            #
            # Which of the two things went wrong depends on whether anything was read. A delimiter
            # *before* the first word means no value ever started — an unclosed list met the `}` of
            # the map around it, and saying "inside an unquoted string" would name a string the
            # author never wrote.
            if token.type not in (TokenType.WORD, TokenType.STRING):
                raise self.fail(
                    DiagnosticCode.PARSE_EXPECTED,
                    (
                        f"'{token.raw or token.type}' cannot appear inside an unquoted string."
                        if started
                        else "Expected a value."
                    ),
                    token,
                )

            # An unterminated quote is literal only where it continues an *unquoted* value — one whose
            # first token is a word. After a value-initial quoted string the value has already ended,
            # so a stray unterminated quote here is the error it looks like, not more of the value.
            if first.type != TokenType.WORD:
                self.reject_unterminated(token)

            last = self.advance()
            started = True

        # An unquoted string is recovered from the source rather than rebuilt from its tokens, which
        # keeps the whitespace *between* its words exactly as it was written (specification 4.3) while
        # leaving behind the whitespace that separated it from its key.
        raw = self.slice(first.start, last.end)

        return Scalar(raw=raw, token=first)

    def slice(self, start: int, end: int) -> str:
        """The source between two tokens, with any comment written between them taken back out.

        A comment is trivia, and the grammar admits no trivia inside an unquoted string — so a comment
        that happens to fall between two words of one is not part of it, however much it looks like it
        is sitting in the middle. The whitespace around it stays, because that whitespace is the
        string's own.
        """
        if not self.comments:
            return self.source[start:end]

        pieces: list[str] = []
        cursor = start

        for begin, finish in self.comments:
            if finish <= start or begin >= end:
                continue

            pieces.append(self.source[cursor:begin])
            cursor = finish

        pieces.append(self.source[cursor:end])

        return "".join(pieces)
    # #endregion values

    # #region names
    def name(self, message: str) -> str:
        token = self.peek()

        # A name that begins with an unterminated quote is the unterminated string it looks like.
        self.reject_unterminated(token)

        if token.type == TokenType.STRING:
            self.advance()

            # A quoted name decodes its escapes like a single-string value, except that a `#{…}` here
            # is literal text and never a resolved reference (specification 4.4).
            return decode_name(token.raw)

        if token.type != TokenType.WORD:
            raise self.fail(DiagnosticCode.PARSE_EXPECTED, message)

        # A word can be a perfectly good unquoted string and still be no name at all. `a.b` is a
        # value anywhere a value is wanted, and nowhere a name is: the character class of a name is
        # narrower than that of a string, and the difference is not a lexical accident but the reason
        # a key can be told from the text beside it.
        if not is_bare_name(token.raw):
            self.advance()

            raise self.fail(
                DiagnosticCode.LEX_INVALID,
                f"Invalid unquoted name '{token.raw}'.",
                token,
            )

        self.advance()

        return token.raw

    def atom(self, message: str) -> str:
        token = self.peek()

        # A target that begins with an unterminated quote is the unterminated string it looks like.
        self.reject_unterminated(token)

        if token.type in (TokenType.WORD, TokenType.STRING):
            self.advance()
            return token.raw

        raise self.fail(DiagnosticCode.PARSE_EXPECTED, message)
    # #endregion names


def parse_syntax(source: str, source_name: str = DEFAULT_SOURCE_NAME):
    from .scanner import normalize

    normalized = normalize(source)
    tokens, comments = scan(source, source_name)

    return Parser(tokens, normalized, source_name, comments).parse()


# #region linting
def lint(source: str, source_name: str = DEFAULT_SOURCE_NAME) -> list[Diagnostic]:
    """What is legal and almost certainly a mistake.

    A key written twice is valid, and the last write is the one that holds (specification 5), so this
    never fails an evaluation — it only says so. A key *replaced by a spread* is not reported, because
    spreading over a key is what spreading is for.
    """
    document = parse_syntax(source, source_name)
    diagnostics: list[Diagnostic] = []

    def walk(node) -> None:
        if isinstance(node, MapNode):
            written: set[str] = set()

            for entry in node.entries:
                if isinstance(entry, Entry):
                    if entry.name in written:
                        diagnostics.append(
                            Diagnostic.of(
                                DiagnosticCode.LINT_DUPLICATE_KEY,
                                f"Map key '{entry.name}' is written more than once.",
                                entry.token.span(),
                            )
                        )

                    written.add(entry.name)
                    walk(entry.value)

        if isinstance(node, ListNode):
            for item in node.items:
                walk(item)

        if isinstance(node, Structure):
            for row in node.rows:
                for cell in row:
                    walk(cell)

        if isinstance(node, Call):
            for argument in node.arguments:
                walk(argument.value)

    for declaration in document.declarations:
        if isinstance(declaration, Leaflink):
            walk(declaration.value)

    walk(document.root)

    return diagnostics
# #endregion linting
