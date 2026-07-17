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
from .syntax import Access, Reference
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


#: The digits a `\u{…}` escape is made of, read case-insensitively.
HEX_DIGITS = frozenset("0123456789abcdefABCDEF")


def is_control(character: str) -> bool:
    r"""A raw control character, which has no literal form anywhere in the source (specification 4.3).

    A C0 control (U+0000–U+001F) *other than* a horizontal tab, a line feed, or a carriage return —
    those three keep their separator roles and their `\t`, `\n`, `\r` escapes — together with `DEL`
    (U+007F) and the C1 controls (U+0080–U+009F). Written raw in a string, in a comment, or between
    tokens it is a lexical error; a value that must carry one is written with a `\u{…}` escape, the one
    form that reads back unchanged and keeps canonical output plain text.
    """
    code = ord(character)

    if code in (0x09, 0x0A, 0x0D):
        return False

    return code <= 0x1F or code == 0x7F or 0x80 <= code <= 0x9F


def unicode_scalar(digits: str) -> "int | None":
    r"""The code point a `\u{…}` names, or None when the braces do not hold a Unicode scalar value.

    One to six hexadecimal digits, read case-insensitively, name a scalar value: at most U+10FFFF and
    never a surrogate U+D800–U+DFFF (specification 4.3). No digits, a non-hexadecimal character, more
    than six digits, a surrogate, or an out-of-range value is not one, and the escape carrying it is
    `DEON_LEX_INVALID`.
    """
    if not 1 <= len(digits) <= 6 or any(digit not in HEX_DIGITS for digit in digits):
        return None

    code = int(digits, 16)

    if code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
        return None

    return code


def normalize(source: str) -> str:
    """Both LF and CRLF are accepted, and everything downstream sees LF (specification 4.1).

    Every offset, line, and column indexes *this* text, so a diagnostic points at the same character
    whichever way the file happened to be saved.
    """
    return source.replace("\r\n", "\n")


def escaped_interpolation_end(text: str, hash_index: int) -> "int | None":
    r"""The index of the `}` that closes an escaped interpolation whose `#{` begins at `hash_index`,
    or None when no `}` closes the reference before whitespace or the end of the text.

    An escaped interpolation `\#{reference}` is written and lexed exactly as the interpolation it
    mirrors — the same reference between the braces, the same closing `}` — but kept literally rather
    than resolved (specification 4.3, 10). It is recognized only when a `}` follows the reference with
    no intervening whitespace, exactly as a real interpolation is written; `\#{q ` (a space before any
    `}`) is therefore a plain `\#{` escape for the two characters `#{`, and the space ends the value.
    """
    index = hash_index + 2
    length = len(text)

    while index < length:
        character = text[index]

        if character in " \t\r\n":
            return None

        if character == "}":
            return index

        index += 1

    return None


def decode_name(raw: str, token: Token) -> str:
    r"""A quoted name's escapes, decoded.

    A name is never interpolated (specification 4.4). A quoted name is lexed like a single-quoted
    string and its escapes decode identically — `\\`, `\'`, `` \` ``, `\n`, `\r`, `\t` — with the
    single difference that a well-formed `#{name}` in name position is literal text rather than a
    resolved reference. A `\#{` therefore decodes through the common escape to the two literal
    characters `#{`, never through an escaped interpolation, so both `'a#{n}'` and `'a\#{n}'` are the
    one literal name `a#{n}` — which is exactly what a value canonically writes back as `'a\#{n}'` and
    reads in again. An *empty* interpolation `#{}` or `\#{}` is `DEON_PARSE_EXPECTED` all the same,
    anchored at the name's first character: the name is lexed as a single-quoted string and emptiness
    is a lexing fault, not a matter of resolution.
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
                # A `\u{…}` escape decodes to the scalar value it names, exactly as in a value string
                # (specification 4.3, 4.4). The scanner validated it while reading the quoted name, so
                # a well-formed escape is assured here; anything else falls through to the literal
                # preservation below and cannot arise.
                closing = raw.find("}", index + 3)
                code = unicode_scalar(raw[index + 3 : closing]) if closing != -1 else None

                if code is not None:
                    out.append(chr(code))
                    index = closing + 1
                    continue

            if raw.startswith("#{", index + 1):
                # An empty escaped interpolation `\#{}` is `DEON_PARSE_EXPECTED` even in a name (§4.4),
                # anchored at the name's first character. Otherwise `\#{` is the two literal characters
                # `#{`: a name is never interpolated, so this never consumes a closing `}` the way an
                # escaped interpolation does in a value — the rest of the name is ordinary literal text.
                if raw.startswith("#{}", index + 1):
                    raise error(
                        DiagnosticCode.PARSE_EXPECTED,
                        "A reference name was expected here.",
                        token.span(),
                    )

                out.append("#{")
                index += 3
                continue

            # Every other backslash sequence is preserved literally (specification 4.3).
            out.append("\\")
            index += 1
            continue

        # An empty interpolation `#{}` is `DEON_PARSE_EXPECTED` even in a name (§4.4), anchored at the
        # name's first character. Otherwise an unescaped `#{…}` is literal text in name position, so
        # `#`, `{`, and `}` are ordinary characters.
        if raw.startswith("#{}", index):
            raise error(
                DiagnosticCode.PARSE_EXPECTED,
                "A reference name was expected here.",
                token.span(),
            )

        out.append(character)
        index += 1

    return "".join(out)


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

        if is_control(character):
            # A raw control character is a lexical error wherever it is consumed — inside a string,
            # inside a comment, or between tokens (specification 4.3) — and every character passes
            # through here, so one guard catches them all. The cursor steps over it first, so the
            # diagnostic's span covers exactly the offending character, and it is reported at that
            # character's own position rather than at whatever token was being read.
            start = self.mark()

            self.current += 1
            self.byte += len(character.encode("utf-8"))

            raise self.fail(
                DiagnosticCode.LEX_INVALID,
                "A control character must be written with a '\\u{…}' escape.",
                start,
            )

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
                if self.peek(1) == "u" and self.peek(2) == "{":
                    # A `\u{…}` escape carries braces of its own, so it is consumed as a unit — its
                    # `{` must not end the word the way a bare brace would (`x\u{1b}y` is one word,
                    # not `x\u` and a stray map) — and validated here, where the backslash still has a
                    # source position to anchor a malformed escape at (specification 4.3).
                    self.unicode_escape(self.mark())
                    continue

                # A backslash takes what follows it, so an escaped delimiter does not end anything.
                self.advance()

                if self.peek() == "#" and self.peek(1) == "{":
                    # An escaped interpolation `\#{reference}` is lexed exactly as the `#{reference}`
                    # it mirrors, so its closing `}` belongs to it and does not end the word — a word
                    # carrying one (`p\#{x}q`) is not cut in two at the brace. When no `}` closes the
                    # reference before whitespace, the `\#{` is a plain escape for the two characters
                    # `#{` and the rest reads as ordinary text (specification 4.3, 10).
                    if escaped_interpolation_end(self.source, self.current) is not None:
                        self.interpolation(self.mark())
                    else:
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

    def unicode_escape(self, start: tuple[int, int, int, int]) -> str:
        r"""Consume and validate a `\u{…}` escape whose backslash is at `start`.

        On entry the cursor is at the backslash; on return it is just past the closing `}`, and the
        consumed source text is returned so a caller assembling a string's content keeps it verbatim
        for the decoder. The escape names one to six hexadecimal digits of a Unicode scalar value — an
        empty, non-hexadecimal, surrogate, or out-of-range escape is `DEON_LEX_INVALID` at the
        backslash, and input that ends before the closing `}` is `DEON_LEX_UNTERMINATED` there
        (specification 4.3). The code point itself is produced later, where the string is decoded, so
        this only proves the escape well-formed and marks off its extent.
        """
        begin = self.current

        self.advance()  # the backslash
        self.advance()  # `u`
        self.advance()  # `{`

        while True:
            if self.at_end() or self.peek() == "\n":
                raise self.fail(
                    DiagnosticCode.LEX_UNTERMINATED,
                    "A Unicode escape is unterminated.",
                    start,
                )

            if self.peek() == "}":
                self.advance()
                break

            self.advance()

        if unicode_scalar(self.source[begin + 3 : self.current - 1]) is None:
            raise self.fail(
                DiagnosticCode.LEX_INVALID,
                "A Unicode escape names one to six hexadecimal digits of a Unicode scalar value.",
                start,
            )

        return self.source[begin : self.current]

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
                if self.peek(1) == "u" and self.peek(2) == "{":
                    content.append(self.unicode_escape(self.mark()))
                    continue

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
                if self.peek(1) == "u" and self.peek(2) == "{":
                    content.append(self.unicode_escape(self.mark()))
                    continue

                content.append(self.advance())

                if not self.at_end():
                    content.append(self.advance())

                continue

            if character == "`":
                self.advance()
                break

            content.append(self.advance())

        # A backtick trims the ASCII whitespace of its layout (specification 4.1) and nothing else,
        # so a Unicode space such as U+00A0 at a boundary is kept as content.
        self.emit(TokenType.STRING, start, raw="".join(content).strip(" \t\n\r"))

    # #region references
    def reference(self, start: tuple[int, int, int, int]) -> Reference:
        if self.peek() == "$":
            self.advance()

            # An environment head is '$' then a non-empty bare-name (`environment-reference = "$",
            # bare-name`, deon.ebnf:42). A lone '$', or a '$' trailed by a non-bare-name character
            # such as a second '$', has an empty name and is `DEON_PARSE_EXPECTED` at the character
            # where the name was due — not `DEON_LEX_INVALID` at the '#', which is where the shared
            # `bare_name` would point. The name run stops on the first non-bare-name character, so it
            # never swallows the extra '$' of '$$X'.
            name_start = self.mark()
            begin = self.current

            while not self.at_end() and self.peek() in NAME_CHARACTERS:
                self.advance()

            if self.current == begin:
                raise self.fail(
                    DiagnosticCode.PARSE_EXPECTED,
                    "A reference name was expected here.",
                    name_start,
                )

            return Reference(head=self.source[begin : self.current], environment=True)

        if self.peek() == "'":
            head_start = self.mark()
            self.single_string(head_start)
            head_token = self.tokens.pop()
            head = decode_name(head_token.raw, head_token)
        else:
            head = self.bare_name(start, "Expected a reference name after '#'.")

        access: list[Access] = []

        while True:
            # A dot segment is *always* a map key, and a name must follow the dot (specification 6):
            # a dot with nothing a name can be made of after it is `DEON_PARSE_EXPECTED` at that spot,
            # so `#m.a.` faults at the character after its trailing dot rather than resolving.
            if self.peek() == ".":
                self.advance()

                segment_start = self.mark()

                if self.at_end() or self.peek() not in NAME_CHARACTERS:
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "Expected a name after '.'.",
                        segment_start,
                    )

                begin = self.current

                while not self.at_end() and self.peek() in NAME_CHARACTERS:
                    self.advance()

                access.append(Access(name=self.source[begin : self.current]))
                continue

            if self.peek() == "[":
                self.advance()

                access.append(self.bracket_access())

                if self.peek() != "]":
                    raise self.fail(
                        DiagnosticCode.PARSE_EXPECTED,
                        "Expected ']' after an access.",
                        self.mark(),
                    )

                self.advance()
                continue

            break

        return Reference(head=head, access=tuple(access))

    def bracket_access(self) -> Access:
        """The content between `[` and `]`, with the cursor just past the `[` (specification 6).

        A quoted segment is a map key. Otherwise the exact characters up to the `]` — or up to the
        whitespace or delimiter that ends the segment — are read: a run of decimal digits is a list
        index (leading zeros permitted, read as the integer), and anything else is a map key. An
        empty segment, or a space before the `]`, is `DEON_PARSE_EXPECTED` at the character it stops
        on: `#l[]` faults at the `]`, and `#l[ 1 ]` at the space.
        """
        if self.peek() == "'":
            quoted_start = self.mark()
            self.single_string(quoted_start)

            segment_token = self.tokens.pop()
            return Access(name=decode_name(segment_token.raw, segment_token))

        start = self.mark()
        begin = self.current
        digits = True

        while (
            not self.at_end()
            and self.peek() != "]"
            and self.peek() not in TERMINATORS
            and self.peek() not in "'`"
        ):
            if self.peek() not in "0123456789":
                digits = False

            self.advance()

        text = self.source[begin : self.current]

        if text == "":
            raise self.fail(
                DiagnosticCode.PARSE_EXPECTED,
                "A bracket access needs a name or an index.",
                start,
            )

        if digits:
            return Access(name=text, by_index=True, index=int(text))

        return Access(name=text)

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
