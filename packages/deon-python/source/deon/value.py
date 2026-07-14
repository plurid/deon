"""What a Deon value is.

A value is exactly one of three things — a string, an ordered list, or an ordered map (specification
2). There is no null, no boolean, and no number. `1` is the string `"1"`, and so is `true`. A host
that wants numbers asks the conservative typer for them (specification 14), and it is told what it
may and may not have.
"""

from __future__ import annotations

from typing import Iterator, Mapping, Union


MISSING = object()


class DeonMap:
    """An ordered map from string keys to Deon values.

    Not a `dict`, and the reason is one sentence of the specification: a map is built from top to
    bottom, and a later write to a key *replaces the value and moves the key to its final write
    position* (specification 5). `dict.__setitem__` does half of that — it replaces the value and
    leaves the key in the slot it first appeared in. So

        { a one, b two, a three }

    is `{b: two, a: three}` in Deon, and `{a: three, b: two}` in a Python dict. The difference is
    invisible to a lookup and plain in a stringification, which is exactly the kind of bug that
    survives a test suite. Hence a type whose only mutator gets it right.
    """

    __slots__ = ("_entries",)

    def __init__(self, entries: Union[Mapping[str, "Value"], list, None] = None) -> None:
        self._entries: dict[str, "Value"] = {}

        if entries is None:
            return

        pairs = entries.items() if isinstance(entries, Mapping) else entries

        for key, value in pairs:
            self.insert(key, value)

    def insert(self, key: str, value: "Value") -> None:
        """Write a key, at the position of this write.

        The removal is what moves the key. Without it the key would keep the slot of its first
        write, and a rewritten map would stringify in an order the document never asked for.
        """
        if key in self._entries:
            del self._entries[key]

        self._entries[key] = value

    # #region the mapping protocol
    def __getitem__(self, key: str) -> "Value":
        return self._entries[key]

    def __setitem__(self, key: str, value: "Value") -> None:
        self.insert(key, value)

    def __contains__(self, key: object) -> bool:
        return key in self._entries

    def __iter__(self) -> Iterator[str]:
        return iter(self._entries)

    def __len__(self) -> int:
        return len(self._entries)

    def get(self, key: str, default: "Value | None" = None) -> "Value | None":
        return self._entries.get(key, default)

    def keys(self):
        return self._entries.keys()

    def values(self):
        return self._entries.values()

    def items(self):
        return self._entries.items()
    # #endregion the mapping protocol

    def __eq__(self, other: object) -> bool:
        """Two maps are equal when they hold the same keys and the same values.

        Order is deliberately not compared. Map order is presentation rather than data
        (specification 2) — it is retained so that stringification is stable, and it is asserted
        through `stringify` and `canonical`, which are the places it means something.
        """
        if isinstance(other, DeonMap):
            return self._entries == other._entries

        if isinstance(other, dict):
            return self._entries == other

        return NotImplemented

    def __repr__(self) -> str:
        return f"DeonMap({self._entries!r})"


Value = Union[str, list, DeonMap]


def coerce(value: object) -> Value:
    """A host's value, as a Deon value.

    A caller holding an ordinary `dict` should be able to hand it to `stringify` without first
    converting it, so this is the one place a plain mapping becomes a `DeonMap`. It is a conversion
    and not a validation: anything that is not a string, a list, or a map is refused here rather
    than written out as its `repr` and discovered by whoever reads the file.
    """
    if isinstance(value, str):
        return value

    if isinstance(value, DeonMap):
        return DeonMap([(key, coerce(item)) for key, item in value.items()])

    if isinstance(value, Mapping):
        return DeonMap([(str(key), coerce(item)) for key, item in value.items()])

    if isinstance(value, (list, tuple)):
        return [coerce(item) for item in value]

    raise TypeError(
        f"A Deon value is a string, a list, or a map, and {type(value).__name__} is none of them."
    )
