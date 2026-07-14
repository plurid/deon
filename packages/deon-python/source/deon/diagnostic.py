"""What went wrong, and exactly where.

A diagnostic that an editor cannot place is a diagnostic it cannot show, so a code on its own is not
conformance: an implementation conforms only when it reports the required code *at the required
source position* (specification 15). Every diagnostic here therefore carries a span, and the span
carries both halves of what a host needs — byte offsets to slice the source with, and a one-based
line and column counted in Unicode code points to show a human.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


class DiagnosticCode:
    """The fourteen codes, and there are no others.

    The catalogue in `spec/diagnostics.md` is normative and closed. The spelling of each is the wire
    name: it appears in a conformance fixture, in a tool's output, and in whatever a host logs, so it
    is a string that must not drift.
    """

    LEX_UNTERMINATED = "DEON_LEX_UNTERMINATED"
    LEX_INVALID = "DEON_LEX_INVALID"
    PARSE_EXPECTED = "DEON_PARSE_EXPECTED"
    PARSE_ROOT = "DEON_PARSE_ROOT"
    DUPLICATE_DECLARATION = "DEON_DUPLICATE_DECLARATION"
    UNRESOLVED_LINK = "DEON_UNRESOLVED_LINK"
    CYCLE = "DEON_CYCLE"
    STRUCTURE_ARITY = "DEON_STRUCTURE_ARITY"
    ENTITY_ARGUMENT = "DEON_ENTITY_ARGUMENT"
    TYPE_MISMATCH = "DEON_TYPE_MISMATCH"
    CAPABILITY_DENIED = "DEON_CAPABILITY_DENIED"
    RESOURCE_IO = "DEON_RESOURCE_IO"
    RESOURCE_FORMAT = "DEON_RESOURCE_FORMAT"
    LINT_DUPLICATE_KEY = "DEON_LINT_DUPLICATE_KEY"


#: Every code is an error except the one that is advice.
WARNINGS = frozenset({DiagnosticCode.LINT_DUPLICATE_KEY})


def severity_of(code: str) -> str:
    return "warning" if code in WARNINGS else "error"


@dataclass(frozen=True)
class Span:
    """Where a diagnostic points.

    `start` and `end` are UTF-8 byte offsets, for a host that wants to slice the source. `line` and
    `column` are one-based and counted in Unicode code points, for a host that wants to show it. The
    two are different numbers and conflating them is the classic way to underline the wrong
    character: `ключ` is four characters and eight bytes.

    Both index the *normalized* source, with CRLF already folded to LF.
    """

    source: str
    start: int = 0
    end: int = 0
    line: int = 1
    column: int = 1
    end_line: int = 1
    end_column: int = 1

    @staticmethod
    def head(source: str) -> "Span":
        """The beginning of a document.

        For a diagnostic about a document as a whole rather than about anything written inside it.
        """
        return Span(source=source)


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    span: Span
    severity: str = field(default="error")

    @staticmethod
    def of(code: str, message: str, span: Span) -> "Diagnostic":
        return Diagnostic(code=code, message=message, span=span, severity=severity_of(code))

    @property
    def line(self) -> int:
        return self.span.line

    @property
    def column(self) -> int:
        return self.span.column


class DeonError(Exception):
    """Evaluation is atomic: the first error ends it, and carries its diagnostics out with it.

    Nothing else crosses the public boundary. A caller should never have to catch a `RecursionError`,
    an `OSError`, or a `json` exception to find out that a document was bad — those are the host's
    accidents leaking through, and each one is a bug in this library rather than a fact about the
    document.
    """

    def __init__(self, code: str, message: str, span: Span) -> None:
        super().__init__(message)

        self.code = code
        self.message = message
        self.diagnostics: list[Diagnostic] = [Diagnostic.of(code, message, span)]

    @property
    def span(self) -> Span:
        return self.diagnostics[0].span

    def __str__(self) -> str:
        span = self.span

        return f"{span.source}:{span.line}:{span.column} {self.code} {self.message}"


def error(code: str, message: str, span: Span) -> "DeonError":
    return DeonError(code, message, span)


def resource_error(code: str, message: str, source_name: str) -> "DeonError":
    """An error about a resource rather than about something written inside a document.

    There is nothing in the text to point at, because nothing was read, so it points at the document
    that named the resource.
    """
    return DeonError(code, message, Span.head(source_name))
