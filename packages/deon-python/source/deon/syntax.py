"""The tree a document is, before anything is evaluated.

Parsing produces this; it reaches nothing and loads nothing. `parse_syntax` hands it out, and
`entities` reads it, because "what would this entity ask me for" is a question about the text rather
than about the world.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

from .token import Token


@dataclass(frozen=True)
class Access:
    """One navigation step after a reference head (specification 6).

    A dot segment is always a map key. A bracket segment is a **list index** only when its content is
    a run of decimal digits — leading zeros permitted, read as the integer — and is otherwise a **map
    key** (a quoted string, or the exact characters written between the brackets). `name` is the key,
    or the digit run for an index; `by_index` and `index` carry the position an index resolves to.
    """

    name: str
    by_index: bool = False
    index: int = 0


@dataclass(frozen=True)
class Reference:
    """What a `#link`, a `...#spread`, or a `#{interpolation}` names.

    `head` is the initial name; `access` is each dot or bracket step after it, already unquoted and
    already classified as a key or an index. `environment` marks the `#$NAME` form, which reads the
    evaluation environment rather than the declaration namespace (specification 6).
    """

    head: str
    access: tuple[Access, ...] = ()
    environment: bool = False

    @property
    def receiving_key(self) -> str:
        """The map key a shortened link contributes: its final access segment, or its head."""
        return self.access[-1].name if self.access else self.head

    def __str__(self) -> str:
        if self.environment:
            return "$" + self.head

        return ".".join([self.head, *(segment.name for segment in self.access)])


# #region values
@dataclass
class Scalar:
    """A string, as it was written.

    `raw` is the source text of the string with a quoted form's delimiters removed and a backtick
    form's boundary whitespace already trimmed — but with its escapes *not yet decoded* and its
    interpolations *not yet resolved*. Specification 4.3 requires exactly that order: trimming
    applies to the source text before escapes are decoded, so that an escaped line break is content
    rather than layout and is never trimmed away.
    """

    raw: str
    token: Token


@dataclass
class MapNode:
    entries: list["Entry | SpreadEntry | LinkEntry"]
    token: Token


@dataclass
class ListNode:
    items: list["ValueNode | SpreadEntry"]
    token: Token


@dataclass
class Structure:
    """Sugar for a list of maps (specification 8)."""

    fields: list[str]
    rows: list[list["ValueNode"]]
    token: Token


@dataclass
class Link:
    reference: Reference
    token: Token


@dataclass
class Call:
    reference: Reference
    arguments: list["Argument"]
    token: Token


ValueNode = Union[Scalar, MapNode, ListNode, Structure, Link, Call]
# #endregion values


# #region entries
@dataclass
class Entry:
    name: str
    value: ValueNode
    token: Token


@dataclass
class SpreadEntry:
    reference: Reference
    token: Token


@dataclass
class LinkEntry:
    """The shortened form: `#name` inside a map, where the link names the key it arrives under."""

    value: "Link | Call"
    token: Token


@dataclass
class Argument:
    name: str
    value: ValueNode
    token: Token
# #endregion entries


# #region declarations
@dataclass
class Leaflink:
    name: str
    value: ValueNode
    token: Token


@dataclass
class Resource:
    """An `import` or an `inject`."""

    kind: str  # "import" | "inject"
    name: str
    target: str
    authenticator: Optional[ValueNode]
    token: Token


Declaration = Union[Leaflink, Resource]


@dataclass
class Document:
    declarations: list[Declaration]
    root: Union[MapNode, ListNode]
    source: str
# #endregion declarations
