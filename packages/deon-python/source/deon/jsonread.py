"""JSON, as Deon values.

The mapping is specification 9.1, and one line of it decides the whole design:

> JSON number to its source token spelling.

Not to its value — to *the way it was written*. `1.50` is the string `"1.50"`, not `"1.5"`, and `1e3`
is `"1e3"`, not `"1000"`. A Deon value is a string, so a number that arrived through a `float` and
came back out through a `repr` would already have lost the only thing about it that was ever there.

Python's `json` can do this, which is the one place Python is kinder than a language without a
batteries-included decoder: `parse_float` and `parse_int` are handed the **raw matched substring**, so
asking for `str` preserves the spelling exactly. But the stdlib decoder must be told three further
things, and each of them is silent when it is wrong:

1. `parse_constant` must be supplied *and must raise*. By default `json.loads('[NaN, Infinity]')`
   succeeds and yields floats. Specification 9.1 enumerates what a JSON value may be, and those are
   not in it.
2. Repeated members need `object_pairs_hook`. The default decoder builds a `dict`, which keeps a
   repeated key in the slot it *first* appeared in — and specification 9.1 defers to Deon's
   last-write-wins rule, which moves the key to its *final* write position (specification 5).
3. `bool` is an `int` in Python. `True` must be tested for with `is`, before any numeric test, or a
   boolean quietly becomes a number.
"""

from __future__ import annotations

import json

from .diagnostic import DiagnosticCode, Span, error
from .parser import MAX_DEPTH
from .value import DeonMap, Value


class _Refused(Exception):
    pass


def _refuse_constant(literal: str):
    raise _Refused(f"'{literal}' is not a JSON value Deon admits.")


def _pairs(pairs) -> DeonMap:
    deon_map = DeonMap()

    for key, value in pairs:
        # `insert`, not assignment: a repeated member moves the key to its final write position.
        deon_map.insert(key, value)

    return deon_map


def _convert(node, depth: int, span: Span) -> Value:
    if depth > MAX_DEPTH:
        raise error(
            DiagnosticCode.RESOURCE_FORMAT,
            "The imported resource nests more deeply than Deon will read.",
            span,
        )

    # `is`, and before everything: `True == 1` and `isinstance(True, int)` are both true in Python,
    # so a boolean tested for numerically is a boolean silently read as a number.
    if node is True:
        return "true"

    if node is False:
        return "false"

    if node is None:
        return ""

    if isinstance(node, str):
        return node

    if isinstance(node, list):
        return [_convert(item, depth + 1, span) for item in node]

    if isinstance(node, DeonMap):
        return DeonMap([(key, _convert(value, depth + 1, span)) for key, value in node.items()])

    # Nothing else can arrive: numbers were handed to `str` by the decoder, and the constants were
    # refused. If something does, it is a bug here rather than a fact about the document.
    raise error(
        DiagnosticCode.RESOURCE_FORMAT,
        f"A JSON {type(node).__name__} is not a value Deon can read.",
        span,
    )


def read_json(text: str, span: Span) -> Value:
    """JSON text, as a Deon value.

    `span` is where the failure will be reported, which for an imported resource is the statement that
    imported it rather than anywhere inside the resource itself.
    """
    try:
        decoded = json.loads(
            text,
            parse_float=str,
            parse_int=str,
            parse_constant=_refuse_constant,
            object_pairs_hook=_pairs,
        )
    except _Refused as refusal:
        raise error(DiagnosticCode.RESOURCE_FORMAT, str(refusal), span) from None
    except RecursionError:
        raise error(
            DiagnosticCode.RESOURCE_FORMAT,
            "The imported resource nests more deeply than Deon will read.",
            span,
        ) from None
    except ValueError as failure:
        raise error(DiagnosticCode.RESOURCE_FORMAT, f"Invalid JSON: {failure}.", span) from None

    return _convert(decoded, 1, span)
