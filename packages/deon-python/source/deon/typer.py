"""The conservative typer.

Typing is outside the Deon data model (specification 14). A Deon value is a string, and this is an
*optional* adapter for a host that wants `true` to be a boolean and `42` to be a number.

The word doing the work is **conservative**. It converts only what it could write back out unchanged:

- `true` and `false`, exactly;
- an integer matching `-?(0|[1-9][0-9]*)` and within the IEEE-754 safe 53-bit range;
- a finite decimal or exponent form with no leading zeroes.

Everything else stays the string it already was, and each exclusion is a lesson somebody learned the
hard way. `007` is a string, because a zip code that becomes the number 7 is a bug. `null` is the
string `"null"`, because Deon has no null. `9007199254740993` is a string, because a float cannot hold
it and would hand back a different number than the one that was written.
"""

from __future__ import annotations

import re

from .value import DeonMap, Value


#: The largest integer an IEEE-754 double holds exactly.
SAFE_INTEGER = 2**53 - 1

INTEGER = re.compile(r"^-?(0|[1-9][0-9]*)$")
DECIMAL = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$")


Typed = object


def type_scalar(text: str) -> Typed:
    if text == "true":
        return True

    if text == "false":
        return False

    if INTEGER.match(text):
        number = int(text)

        # Out of range, and so it stays a string: a number that cannot survive being written back is
        # not a number this may hand out.
        if abs(number) > SAFE_INTEGER:
            return text

        return number

    if DECIMAL.match(text) and ("." in text or "e" in text or "E" in text):
        number = float(text)

        if number != number or number in (float("inf"), float("-inf")):
            return text

        return number

    return text


def typed(value: Value) -> Typed:
    if isinstance(value, str):
        return type_scalar(value)

    if isinstance(value, DeonMap):
        return {key: typed(item) for key, item in value.items()}

    if isinstance(value, list):
        return [typed(item) for item in value]

    return value
