"""A token, and where it was written."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .diagnostic import Span


class TokenType:
    LEFT_CURLY = "LEFT_CURLY"
    RIGHT_CURLY = "RIGHT_CURLY"
    LEFT_SQUARE = "LEFT_SQUARE"
    RIGHT_SQUARE = "RIGHT_SQUARE"
    LEFT_ANGLE = "LEFT_ANGLE"
    RIGHT_ANGLE = "RIGHT_ANGLE"
    LEFT_PAREN = "LEFT_PAREN"
    RIGHT_PAREN = "RIGHT_PAREN"

    COMMA = "COMMA"
    NEWLINE = "NEWLINE"

    #: A run of unquoted characters. It may be a name, a keyword, or a piece of an unquoted string —
    #: which of the three it is depends on where it is written, and that is the parser's business.
    WORD = "WORD"

    #: A single-quoted or backtick string. `raw` is its content, delimiters removed.
    STRING = "STRING"

    LINK = "LINK"
    SPREAD = "SPREAD"

    EOF = "EOF"


#: The words that are keywords only where a declaration may begin. Anywhere else `import` is an
#: ordinary word, because a document is data and data contains the word "import".
KEYWORDS = frozenset({"import", "inject", "from", "with"})


@dataclass(frozen=True)
class Token:
    type: str

    #: The source text of the token. For a `STRING` this is the content with the delimiters removed
    #: and, for a backtick, with the boundary whitespace already trimmed.
    raw: str

    #: A `Reference`, for a `LINK` or a `SPREAD`.
    literal: Optional[Any]

    #: Code-point indices into the normalized source, which is what makes a column a column.
    start: int
    end: int

    #: UTF-8 byte offsets, which is what makes an offset an offset.
    byte_start: int
    byte_end: int

    line: int
    column: int
    end_line: int
    end_column: int

    source: str

    def span(self) -> Span:
        return Span(
            source=self.source,
            start=self.byte_start,
            end=self.byte_end,
            line=self.line,
            column=self.column,
            end_line=self.end_line,
            end_column=self.end_column,
        )
