"""A value, written back out.

The rule that governs everything here is one sentence of specification 12: *a string must be emitted
in a form that reads back unchanged*. So the question asked of every string is not "how shall this
look" but "what would this be, read again" — and a form that would come back as something else is not
available, however much tidier it looks.

Canonical form (specification 13) is the same writer under a different set of answers, and it is not a
style: it is an identity. `parse(canonical(v))` must equal `v`, and two implementations must produce
the same bytes, or nothing downstream of either can be compared.
"""

from __future__ import annotations

from typing import Mapping

from .options import StringifyOptions
from .parser import MAX_DEPTH, is_bare_name
from .scanner import is_control
from .value import DeonMap, Value, coerce


#: A character that would end an unquoted string, or start something other than text.
UNSAFE = frozenset("\n\r\t,{}[]()<>'`\\")


def depth_of(value: object) -> int:
    """How deep a value goes, without recursing to find out.

    `stringify` accepts a value a *host* built, which never met the parser and never met its depth
    guard. So the guard is applied here too, iteratively — because a recursive check for "is this too
    deep to recurse into" is a joke that only works until it doesn't.

    It runs over the value as the host handed it over, before any conversion: a plain `dict` and a
    plain `list` have to be walked here, because whatever converts them will itself recurse, and it
    would hit the wall first.
    """
    # The root is depth 0 and its members are depth 1, matching the parser's guard: a value nests
    # when it *contains* another, so the depth is the count of enclosing values, and 128 of them is
    # accepted while a 129th is refused (specification 11.1).
    deepest = 0
    stack: list[tuple[object, int]] = [(value, 0)]

    while stack:
        current, depth = stack.pop()

        deepest = max(deepest, depth)

        if depth > MAX_DEPTH:
            return depth

        if isinstance(current, DeonMap):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, Mapping):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, (list, tuple)):
            stack.extend((item, depth + 1) for item in current)

    return deepest


def can_be_bare(text: str) -> bool:
    """Whether a string can stand with no quotes at all and come back as itself."""
    if not text:
        return False

    if text[0] in " \t" or text[-1] in " \t":
        return False

    if any(character in UNSAFE for character in text):
        return False

    # A raw control character is a lexical error, and has no literal form to stand bare as: it is
    # written with a `\u{…}` escape, which only a quoted string carries (specification 4.3, 12).
    if any(is_control(character) for character in text):
        return False

    # A `#` forces a quote wherever it falls. At a token boundary a bare `#` reads back as a link and
    # `#{` as an interpolation; an interior `#` is harmless literal text under specification 4.3, and
    # is quoted all the same, because where a shorter safe form and a safer one both read back the
    # canonical form (specification 12, 13) is the safer one, and every implementation must agree on
    # it. So `x#y`, `c#minor`, and `...#x` are all single-quoted rather than left bare.
    if "#" in text:
        return False

    # A comment marker anywhere is quoted, and not only a leading one. Read back, a `//` in the middle
    # of a word *is* two slashes and would survive — but the two sibling implementations quote it, and
    # the canonical form is the one output that all of them must agree on, character for character
    # (specification 13). An implementation that is right on its own and different from the others has
    # misunderstood what canonical form is for.
    if "//" in text or "/*" in text:
        return False

    return True


def escaped(text: str, delimiter: str) -> str:
    out: list[str] = []

    for character in text:
        if character == "\\":
            out.append("\\\\")
        elif character == delimiter:
            out.append("\\" + delimiter)
        elif character == "\n":
            out.append("\\n" if delimiter == "'" else "\n")
        elif character == "\r":
            out.append("\\r")
        elif character == "\t":
            out.append("\\t")
        elif is_control(character):
            # Every other control character is written `\u{h}`, its code point in lowercase hex with
            # no leading zeros (specification 12): the escape character is `\u{1b}`, a null `\u{0}`, a
            # DEL `\u{7f}`. A tab, a line feed, and a carriage return kept their spellings above.
            out.append("\\u{" + format(ord(character), "x") + "}")
        else:
            out.append(character)

    return "".join(out).replace("#{", "\\#{")


def write_string(text: str) -> str:
    if can_be_bare(text):
        return text

    # A backtick string carries a value only when that value begins and ends with a non-whitespace
    # character and contains no carriage return and no other control character (specification 12) —
    # a backtick trims its boundary whitespace on the way back in, so a value with any would not
    # survive the round trip, and a control has no literal form a backtick could hold, so it is
    # single-quoted and its control written `\u{…}` instead.
    if (
        "\n" in text
        and "\r" not in text
        and not any(is_control(character) for character in text)
        and text[:1].strip(" \t\n\r") != ""
        and text[-1:].strip(" \t\n\r") != ""
    ):
        return "`" + escaped(text, "`") + "`"

    return "'" + escaped(text, "'") + "'"


def write_key(key: str) -> str:
    return key if is_bare_name(key) else "'" + escaped(key, "'") + "'"


class Stringifier:
    def __init__(self, options: StringifyOptions) -> None:
        self.options = options

        self.readable = True if options.canonical else options.readable
        self.indentation = 4 if options.canonical else options.indentation

        #: Canonical output contains only the fully evaluated inline root: no comments, and no
        #: generated leaflinks.
        self.leaflinks = False if options.canonical else options.leaflinks

        self.declarations: list[tuple[str, Value]] = []

    # #region containers
    def entries(self, value: DeonMap):
        items = list(value.items())

        # Canonical output sorts every map by Unicode code-point order, which is what Python's `<`
        # on a `str` already is.
        if self.options.canonical:
            items.sort(key=lambda pair: pair[0])

        return items

    def write(self, value: Value, level: int, path: list[str]) -> str:
        if isinstance(value, str):
            return write_string(value)

        if isinstance(value, DeonMap):
            return self.write_map(value, level, path)

        if isinstance(value, list):
            return self.write_list(value, level, path)

        raise TypeError(f"A Deon value is a string, a list, or a map, and {type(value).__name__} is none.")

    def child(self, value: Value, level: int, path: list[str], key: str) -> str:
        """A child of a container — which, at the extraction level, becomes a declaration instead."""
        if (
            self.leaflinks
            and level >= self.options.leaflink_level
            and isinstance(value, (DeonMap, list))
        ):
            name = leaflink_name(path + [key])

            # Once an ancestor is extracted, its descendants are not separately extracted — which is
            # what handing the value straight over says: it is written later, by a writer that has
            # leaflinks turned off, so nothing inside it is pulled out again.
            self.declarations.append((name, value))

            return "#" + name

        # `level` is already the child's level: the caller advanced it. Advancing it again here would
        # indent every container twice — which no fixture nests deeply enough to notice, and which the
        # other two implementations noticed immediately.
        return self.write(value, level, path + [key])

    def write_map(self, value: DeonMap, level: int, path: list[str]) -> str:
        items = self.entries(value)

        if not items:
            return "{}"

        pieces: list[str] = []

        for key, item in items:
            written = self.child(item, level + 1, path, key)

            # `leaflinkShortening` emits `#name` alone only when the receiving key is the name it
            # would have been given anyway; otherwise the key has to be said out loud, or the value
            # would arrive under the wrong one.
            if written.startswith("#") and self.options.leaflink_shortening:
                if written[1:] == key:
                    pieces.append(written)
                    continue

            pieces.append(f"{write_key(key)} {written}")

        return self.group(pieces, "{", "}", level)

    def write_list(self, value: list, level: int, path: list[str]) -> str:
        if not value:
            return "[]"

        pieces = [
            self.child(item, level + 1, path, str(index))
            for index, item in enumerate(value)
        ]

        return self.group(pieces, "[", "]", level)

    def group(self, pieces: list[str], opening: str, closing: str, level: int) -> str:
        if not self.readable:
            # One line, with the comma the grammar accepts wherever it accepts a newline.
            return opening + ", ".join(pieces) + closing

        inner = " " * (self.indentation * (level + 1))
        outer = " " * (self.indentation * level)

        body = "".join(f"{inner}{piece}\n" for piece in pieces)

        return f"{opening}\n{body}{outer}{closing}"
    # #endregion containers


def leaflink_name(path: list[str]) -> str:
    """A generated declaration name: the root-relative path, escaped so it can be taken apart again.

    `~` becomes `~0` and `/` becomes `~1`, *in that order* — the reverse would turn a real `/` into a
    `~1` and then into a `~01`, and the path could no longer be read back.
    """
    return "/".join(segment.replace("~", "~0").replace("/", "~1") for segment in path)


def stringify(value: Value, options: StringifyOptions | None = None) -> str:
    options = options or StringifyOptions()

    # Measured *before* the value is converted, and not after. `coerce` recurses, so a value too deep
    # to write is also too deep to convert — checking afterwards means the check never runs, and the
    # caller gets the `RecursionError` this exists to spare them.
    if depth_of(value) > MAX_DEPTH:
        from .diagnostic import DiagnosticCode, Span, error

        raise error(
            DiagnosticCode.PARSE_EXPECTED,
            "The value nests more deeply than Deon will write.",
            Span.head("<value>"),
        )

    value = coerce(value)

    writer = Stringifier(options)

    root = writer.write(value, 0, [])

    out: list[str] = []

    if options.generated_header and not options.canonical:
        out.append("// Generated by Deon.\n")

    if options.generated_comments and not options.canonical:
        out.append("// Root.\n")

    out.append(root + "\n")

    if writer.declarations:
        if options.generated_comments and not options.canonical:
            out.append("// Leaflinks.\n")

        for name, declared in writer.declarations:
            inner = Stringifier(
                StringifyOptions(
                    canonical=options.canonical,
                    readable=options.readable,
                    indentation=options.indentation,
                    leaflinks=False,
                )
            )

            out.append(f"{write_key(name)} {inner.write(declared, 0, [])}\n")

    return "\n".join(out)


def canonical(value: Value) -> str:
    return stringify(value, StringifyOptions(canonical=True))
