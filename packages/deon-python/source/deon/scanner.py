"""Source text into tokens.

Two things here are worth saying out loud, because both are places the grammar stops short.

**What a token boundary is.** Specification 4.2 says `//` begins a comment "at a token boundary", and
never says what one is. It has to mean *where a token may begin*: a comment starts only when the
scanner is about to read a new token, and never in the middle of one. That is not decoration — the
conformance suite imports `https://example.com/remote.deon`, and if `//` could begin a comment inside
a word then that target would be truncated to `https:` and the fixture could not pass. So a `/` in the
middle of a word is a `/`.

**What an unquoted character is.** The grammar names `unquoted-character` and does not define it.
Specification 4.3 does, negatively: an unquoted string "continues until an unnested comma, newline, or
enclosing delimiter". So a word ends at whitespace, at a comma, at a newline, or at any bracket — and
everything between the first and last token of an unquoted string is recovered by slicing the source,
which is what keeps its internal whitespace as it was written.

Positions. A Python `str` is already a sequence of code points, so the one-based code-point line and
column that a diagnostic shows come out for free. It is the *byte* offsets that cost something here,
and they are accumulated one character at a time — never by re-encoding a prefix, which would be
quadratic and would turn a large document into a hang.
"""

from __future__ import annotations

from .diagnostic import DeonError, DiagnosticCode, Span, error
from .syntax import Reference
from .token import Token, TokenType


#: A word ends here. Everything else is a character an unquoted string may contain, including `/`,
#: `:`, `.`, `\`, and — a `'` or `` ` `` among them. A quote that is not the first character of an
#: unquoted value is ordinary literal text and opens nothing (specification 4.3): it is `token` that
#: opens a quoted string, and only when a value *begins* with a quote, so a word already under way
#: reads `it's` and `p`q`r` straight through. That is what lets a path, a URL, a flag, and an
#: apostrophe be written with no quotes at all.
TERMINATORS = frozenset(" \t\n,{}[]()<>")

NAME_CHARACTERS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
)

PUNCTUATION = {
    "{": TokenType.LEFT_CURLY,
    "}": TokenType.RIGHT_CURLY,
    "[": TokenType.LEFT_SQUARE,
    "]": TokenType.RIGHT_SQUARE,
    "<": TokenType.LEFT_ANGLE,
    ">": TokenType.RIGHT_ANGLE,
    "(": TokenType.LEFT_PAREN,
    ")": TokenType.RIGHT_PAREN,
    ",": TokenType.COMMA,
}


def normalize(source: str) -> str:
    """Both LF and CRLF are accepted, and everything downstream sees LF (specification 4.1).

    Every offset, line, and column indexes *this* text, so a diagnostic points at the same character
    whichever way the file happened to be saved.
    """
    return source.replace("\r\n", "\n")


class Scanner:
    def __init__(self, source: str, source_name: str = "<memory>") -> None:
        self.source = normalize(source)
        self.source_name = source_name

        self.current = 0
        self.byte = 0
        self.line = 1
        self.line_start = 0

        self.tokens: list[Token] = []

        #: Where the comments were, as code-point ranges.
        #:
        #: An unquoted string is recovered by slicing the source between its first and last token, and
        #: a comment written in the middle of one would be sliced up along with it. It cannot be part
        #: of the string — the grammar admits no trivia inside an unquoted string — so the ranges are
        #: kept, and cut back out of the slice.
        self.comments: list[tuple[int, int]] = []

    # #region the cursor
    @property
    def column(self) -> int:
        return self.current - self.line_start + 1

    def at_end(self, ahead: int = 0) -> bool:
        return self.current + ahead >= len(self.source)

    def peek(self, ahead: int = 0) -> str:
        index = self.current + ahead

        return self.source[index] if index < len(self.source) else ""

    def advance(self) -> str:
        character = self.source[self.current]

        self.current += 1
        self.byte += len(character.encode("utf-8"))

        if character == "\n":
            self.line += 1
            self.line_start = self.current

        return character

    def mark(self) -> tuple[int, int, int, int]:
        return (self.current, self.byte, self.line, self.column)

    def emit(
        self,
        type: str,
        start: tuple[int, int, int, int],
        raw: str = "",
        literal=None,
        unterminated_quote: bool = False,
    ) -> None:
        self.tokens.append(
            Token(
                type=type,
                raw=raw,
                literal=literal,
                start=start[0],
                end=self.current,
                byte_start=start[1],
                byte_end=self.byte,
                line=start[2],
                column=start[3],
                end_line=self.line,
                end_column=self.column,
                source=self.source_name,
                unterminated_quote=unterminated_quote,
            )
        )

    def fail(self, code: str, message: str, start: tuple[int, int, int, int]):
        return error(
            code,
            message,
            Span(
                source=self.source_name,
                start=start[1],
                end=self.byte,
                line=start[2],
                column=start[3],
                end_line=self.line,
                end_column=self.column,
            ),
        )
    # #endregion the cursor

    def scan(self) -> list[Token]:
        while True:
            self.trivia()

            if self.at_end():
                break

            self.token()

        self.emit(TokenType.EOF, self.mark())

        return self.tokens

    def trivia(self) -> None:
        """Spaces, tabs, and comments — everything a token may be preceded by and no token is.

        A newline is *not* trivia here: it separates entries, so the parser must see it.
        """
        while not self.at_end():
            character = self.peek()

            if character in " \t":
                self.advance()
                continue

            # A comment begins only here, where a token may begin. Inside a word, `//` is two slashes.
            if character == "/" and self.peek(1) == "/":
                start = self.mark()

                while not self.at_end() and self.peek() != "\n":
                    self.advance()

                self.comments.append((start[0], self.current))

                continue

            if character == "/" and self.peek(1) == "*":
                start = self.mark()

                self.advance()
                self.advance()

                while True:
                    if self.at_end():
                        raise self.fail(
                            DiagnosticCode.LEX_UNTERMINATED,
                            "Unterminated block comment.",
                            start,
                        )

                    if self.peek() == "*" and self.peek(1) == "/":
                        self.advance()
                        self.advance()
                        break

                    self.advance()

                self.comments.append((start[0], self.current))

                continue

            return

    def token(self) -> None:
        start = self.mark()
        character = self.peek()

        if character == "\n":
            self.advance()
            self.emit(TokenType.NEWLINE, start)
            return

        if character == "'":
            self.quoted_or_word(start, self.single_string)
            return

        if character == "`":
            self.quoted_or_word(start, self.multiline_string)
            return

        # `...#reference` spreads. Any other run of dots is an ordinary word, which is what lets
        # `./configurations/file` be written unquoted.
        if self.source.startswith("...#", self.current):
            self.advance()
            self.advance()
            self.advance()
            self.advance()

            reference = self.reference(start)
            self.emit(TokenType.SPREAD, start, literal=reference)
            return

        # `#{` opens an interpolation, which belongs to a string rather than being one; `#` alone
        # opens a link. The two are told apart by the character after the `#` and by nothing else.
        if character == "#" and self.peek(1) != "{":
            self.advance()

            reference = self.reference(start)
            self.emit(TokenType.LINK, start, literal=reference)
            return

        if character in PUNCTUATION:
            self.advance()
            self.emit(PUNCTUATION[character], start, raw=character)
            return

        self.word(start)

    def quoted_or_word(self, start: tuple[int, int, int, int], reader) -> None:
        """A value that begins with a quote is a quoted string; read it as one (specification 4.3).

        A quote opens a string only at a value's first character, and the scanner cannot see a
        value's first character apart from its later ones — a `'` after a key, after a word, and
        after separating whitespace all arrive here the same way. When the string closes, that
        ambiguity never surfaced: the run was a quoted string wherever it stood. When it does *not*
        close it does surface, because now the two readings differ — value-initial the run is the
        `DEON_LEX_UNTERMINATED` the reader would raise, and continuing an unquoted value it is
        ordinary literal text. The scanner declines to guess: it rolls the cursor back, reads the run
        as a word, and marks the word, leaving the parser — which knows whether a value begins here —
        to give the verdict.
        """
        checkpoint = (self.current, self.byte, self.line, self.line_start)

        try:
            reader(start)
        except DeonError as failure:
            if failure.code != DiagnosticCode.LEX_UNTERMINATED:
                raise

            self.current, self.byte, self.line, self.line_start = checkpoint
            self.word(start, unterminated_quote=True)

    def word(
        self, start: tuple[int, int, int, int], unterminated_quote: bool = False
    ) -> None:
        while not self.at_end():
            character = self.peek()

            if character in TERMINATORS:
                break

            if character == "\\":
                # A backslash takes what follows it, so an escaped delimiter does not end anything.
                # `\#{` is the escaped interpolation opener, and it is three characters, not two:
                # taking only two would leave the `{` behind to be read as something it is not.
                self.advance()

                if self.peek() == "#" and self.peek(1) == "{":
                    self.advance()
                    self.advance()
                elif not self.at_end():
                    self.advance()

                continue

            if character == "#" and self.peek(1) == "{":
                self.interpolation(self.mark())
                continue

            self.advance()

        raw = self.source[start[0] : self.current]

        self.emit(TokenType.WORD, start, raw=raw, unterminated_quote=unterminated_quote)

    def interpolation(self, start: tuple[int, int, int, int]) -> None:
        """Consume `#{ ... }` inside a string.

        It is consumed rather than validated: whether the reference inside it resolves is a question
        for the evaluator, and whether it is well-formed is decided when the string is decoded. What
        matters here is only that the closing brace does not end the word that contains it.
        """
        self.advance()
        self.advance()

        while True:
            if self.at_end() or self.peek() == "\n":
                raise self.fail(
                    DiagnosticCode.LEX_UNTERMINATED,
                    "Unterminated interpolation.",
                    start,
                )

            if self.peek() == "}":
                self.advance()
                return

            self.advance()

    def single_string(self, start: tuple[int, int, int, int]) -> None:
        """A single-quoted string is confined to one logical line (specification 4.3)."""
        self.advance()

        content: list[str] = []

        while True:
            if self.at_end() or self.peek() == "\n":
                raise self.fail(
                    DiagnosticCode.LEX_UNTERMINATED,
                    "Unterminated string.",
                    start,
                )

            character = self.peek()

            if character == "\\":
                content.append(self.advance())

                if not self.at_end():
                    content.append(self.advance())

                continue

            if character == "'":
                self.advance()
                break

            content.append(self.advance())

        self.emit(TokenType.STRING, start, raw="".join(content))

    def multiline_string(self, start: tuple[int, int, int, int]) -> None:
        """A backtick string may span lines, and its boundary whitespace is removed.

        The trim runs over the source text, before any escape is decoded (specification 4.3). That
        ordering is the whole point: it means a `\\n` written at the end of a value is content and
        survives, where a real line feed there is layout and does not.
        """
        self.advance()

        content: list[str] = []

        while True:
            if self.at_end():
                raise self.fail(
                    DiagnosticCode.LEX_UNTERMINATED,
                    "Unterminated string.",
                    start,
                )

            character = self.peek()

            if character == "\\":
                content.append(self.advance())

                if not self.at_end():
                    content.append(self.advance())

                continue

            if character == "`":
                self.advance()
                break

            content.append(self.advance())

        self.emit(TokenType.STRING, start, raw="".join(content).strip())

    # #region references
    def reference(self, start: tuple[int, int, int, int]) -> Reference:
        if self.peek() == "$":
            self.advance()

            name = self.bare_name(start, "Expected an environment name after '$'.")

            return Reference(segments=(name,), environment=True)

        if self.peek() == "'":
            head_start = self.mark()
            self.single_string(head_start)
            head = self.tokens.pop().raw
        else:
            head = self.bare_name(start, "Expected a reference name after '#'.")

        segments = [head]

        while True:
            if self.peek() == "." and self.peek(1) in NAME_CHARACTERS:
                self.advance()
                segments.append(self.bare_name(start, "Expected a name after '.'."))
                continue

            if self.peek() == "[":
                self.advance()

                if self.peek() == "'":
                    quoted_start = self.mark()
                    self.single_string(quoted_start)
                    segments.append(self.tokens.pop().raw)
                else:
                    segments.append(self.bare_name(start, "Expected a name or an index after '['."))

                if self.peek() != "]":
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "Expected ']' after an access.",
                        start,
                    )

                self.advance()
                continue

            break

        return Reference(segments=tuple(segments))

    def bare_name(self, start: tuple[int, int, int, int], message: str) -> str:
        begin = self.current

        while not self.at_end() and self.peek() in NAME_CHARACTERS:
            self.advance()

        if self.current == begin:
            raise self.fail(DiagnosticCode.LEX_INVALID, message, start)

        return self.source[begin : self.current]
    # #endregion references


def scan(source: str, source_name: str = "<memory>") -> tuple[list[Token], list[tuple[int, int]]]:
    scanner = Scanner(source, source_name)
    tokens = scanner.scan()

    return tokens, scanner.comments
