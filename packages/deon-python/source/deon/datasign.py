"""Typing a document against a declared contract (specification 14.1).

The conservative typer of §14 guesses from the value, so it has to refuse whenever a guess could be
wrong: `007` stays a string, because a postal code that becomes the number 7 is a bug. A contract is
the other half. It supplies the intent the value cannot carry, and `007` becomes `7` exactly where
somebody declared it a number — and nowhere else.

    data Account {
        id: string;
        age: number;
        nickname?: string;
    }

The `?` is the whole of the optionality: a field that is declared and not optional and not present is
an error, and a key the contract never mentions passes through untouched rather than being dropped. A
contract describes what it knows about, and silence is not a claim.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping, Optional

from .diagnostic import DiagnosticCode, Span, error
from .value import DeonMap, Value


ENTITY_START = re.compile(r"^\s*data\s+(\w+)\s*\{")
ENTITY_END = re.compile(r"^\s*\}")
ANNOTATION = re.compile(r"^\s*@")
COMMENT = re.compile(r"^\s*(//|/\*|\*)")
TRAILING_COMMENT = re.compile(r"//.*$")

#: What the source is called when a diagnostic has to point somewhere and there is nowhere to point.
DATASIGN_SOURCE = "<datasign>"

PRIMITIVES = frozenset({"string", "number", "boolean"})


@dataclass(frozen=True)
class Field:
    name: str
    type: str
    required: bool


#: An entity name, and the fields it declares.
Signatures = dict[str, list[Field]]


# #region reading a contract
def parse_datasign(source: str) -> Signatures:
    """`.datasign` source, as the shape it declares.

    Only the shape is taken. An annotation (`@graphql ID`) and a comment describe the type to some
    other tool and say nothing about what the data must look like, so both are skipped.
    """
    signatures: Signatures = {}
    fields: Optional[list[Field]] = None

    for line in source.split("\n"):
        if COMMENT.match(line) or ANNOTATION.match(line):
            continue

        value = TRAILING_COMMENT.sub("", line)

        if not value.strip():
            continue

        start = ENTITY_START.match(value)

        if start:
            fields = []
            signatures[start.group(1)] = fields

            continue

        if ENTITY_END.match(value):
            fields = None

            continue

        if fields is None:
            continue

        separator = value.find(":")

        if separator == -1:
            continue

        # A `?` *anywhere* on the line marks the field optional, which is datasign's own rule and
        # not a tidier one invented here: `nickname?: string` and `nickname: string?` are both
        # optional to the compiler that owns the format, and an adapter that read only the first
        # would demand a field that datasign says may be absent.
        optional = "?" in value

        name = value[:separator].strip().replace("?", "")
        declared = re.sub(r";\s*$", "", value[separator + 1 :]).strip().replace("?", "")

        if not name or not declared:
            continue

        fields.append(Field(name=name, type=declared, required=not optional))

    return signatures


def read_datasign(sources: list[str]) -> Signatures:
    """Every contract as one. A repeated entity takes its fields from the last source to declare it."""
    signatures: Signatures = {}

    for source in sources:
        signatures.update(parse_datasign(source))

    return signatures
# #endregion reading a contract


# #region numbers
#: A decimal number, as ECMAScript reads one — which is what §14.1 requires, and it is wider than the
#: conservative typer's grammar on purpose. `.5`, `5.`, `+5`, and `007` are all numbers here, because
#: a contract that says `number` is not guessing, and §14 is.
DECIMAL = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")

RADICES = {"0x": 16, "0X": 16, "0o": 8, "0O": 8, "0b": 2, "0B": 2}


def numeric(text: str) -> Optional[float | int]:
    """A string as a number, or `None` if it is not one.

    Deliberately *not* `float(text)`: Python and ECMAScript disagree about the edges, and the contract
    has to mean the same thing in every implementation. Python's `float` accepts `1_000`, `infinity`,
    and `nan`, all of which are a mismatch here; and it rejects `0x10`, which is 16.
    """
    trimmed = text.strip()

    if not trimmed:
        return None

    radix = RADICES.get(trimmed[:2])

    if radix is not None:
        digits = trimmed[2:]

        try:
            return int(digits, radix)
        except ValueError:
            return None

    if not DECIMAL.match(trimmed):
        return None

    number = float(trimmed)

    # An integral value is an integer. ECMAScript has one number type and prints `42` for it, so a
    # Python `42.0` would be the same number written differently — and the implementations are
    # required to agree character for character.
    if number.is_integer() and abs(number) <= 2**53 - 1:
        return int(number)

    return number
# #endregion numbers


# #region applying a contract
#: Anything that behaves as a Deon map: the parser's own, or a plain `dict` a host built.
MAPS = (DeonMap, dict)


def describe(value: Value) -> str:
    if isinstance(value, str):
        return "a string"

    if isinstance(value, list):
        return "a list"

    if isinstance(value, MAPS):
        return "a map"

    return "a value"


def verbatim(value: Value):
    """A value the contract said nothing about, carried across unchanged.

    Emphatically *not* `typed`, which guesses: a key the contract does not mention has not been
    declared to be anything, and §14's guessing is exactly what a contract exists to replace, so
    `007` stays `'007'`.

    A `DeonMap` widens to a plain `dict` on the way through, because the result of typing is no longer
    a Deon value — it holds numbers and booleans, which the data model has none of — and because the
    move-on-rewrite rule that `DeonMap` exists for cannot arise here: every key is written once.
    """
    if isinstance(value, MAPS):
        return {key: verbatim(item) for key, item in value.items()}

    if isinstance(value, list):
        return [verbatim(item) for item in value]

    return value


def mismatch(message: str, source: str):
    # Typing happens after evaluation, so no source token survives to point at. The path through the
    # data (`accounts[0].age`) is what makes the diagnostic actionable, and not a line number.
    raise error(DiagnosticCode.TYPE_MISMATCH, message, Span.head(source))


def type_datasign(
    value: Value,
    declared: str,
    signatures: Signatures,
    path: str,
    source: str = DATASIGN_SOURCE,
):
    """One evaluated value, as the type its contract declares."""
    declared = declared.strip()

    if declared.endswith("[]"):
        if not isinstance(value, list):
            mismatch(
                f"Expected '{path}' to be a list for '{declared}', found {describe(value)}.",
                source,
            )

        item = declared[:-2].strip()

        return [
            type_datasign(entry, item, signatures, f"{path}[{index}]", source)
            for index, entry in enumerate(value)
        ]

    if declared in PRIMITIVES:
        if not isinstance(value, str):
            mismatch(
                f"Expected '{path}' to be a string for '{declared}', found {describe(value)}.",
                source,
            )

        if declared == "string":
            return value

        if declared == "boolean":
            if value == "true":
                return True

            if value == "false":
                return False

            mismatch(
                f"Expected '{path}' to be 'true' or 'false' for 'boolean', found '{value}'.",
                source,
            )

        number = numeric(value)

        if number is None:
            mismatch(f"Expected '{path}' to be a number, found '{value}'.", source)

        return number

    entity = signatures.get(declared)

    if entity is None:
        # A type defined somewhere else. Datasign does not describe it, so neither does this — and a
        # value is not to be guessed at merely because its type was not found.
        return verbatim(value)

    if not isinstance(value, MAPS):
        mismatch(
            f"Expected '{path}' to be a map for '{declared}', found {describe(value)}.",
            source,
        )

    fields = {field.name: field for field in entity}
    result: dict = {}

    # The write order of §5 is kept, and a key the contract does not mention passes through untyped
    # rather than being dropped.
    for key, entry in value.items():
        field = fields.get(key)

        result[key] = (
            type_datasign(entry, field.type, signatures, f"{path}.{key}", source)
            if field
            else verbatim(entry)
        )

    for field in entity:
        if field.required and field.name not in result:
            mismatch(
                f"Required field '{path}.{field.name}' of '{declared}' is missing.",
                source,
            )

    return result


def apply_datasign(
    root: Value,
    signatures: Signatures,
    mapping: Mapping[str, str],
    source: str = DATASIGN_SOURCE,
):
    """An evaluated root, with each named root key converted to the type declared for it.

    A key named in the map and absent from the data is skipped rather than invented, and a key in the
    data and not in the map is left exactly as it was parsed.
    """
    if not mapping:
        return verbatim(root)

    if not isinstance(root, MAPS):
        mismatch(f"A datasign map requires a root map, found {describe(root)}.", source)

    result: dict = {}

    # Built in one pass over the *data*, and not by rewriting keys afterwards. A rewrite would have to
    # move the key (§5), and typing a value must not reorder the map it sits in.
    for key, entry in root.items():
        declared = mapping.get(key)

        result[key] = (
            type_datasign(entry, declared, signatures, key, source)
            if declared is not None
            else verbatim(entry)
        )

    return result
# #endregion applying a contract
