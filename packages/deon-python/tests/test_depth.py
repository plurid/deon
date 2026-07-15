"""The nesting limit is uniform.

A value a host builds by hand never meets the parser, so it never meets the parser's depth guard. The
public writers and the typer apply that guard themselves — iteratively, so the check for "too deep to
recurse" does not itself recurse — and they all fail the same way the parser would: a `DeonError` whose
code is `DEON_PARSE_EXPECTED`. A value within the limit is written and typed as if the guard were not
there.
"""

import unittest

from deon.diagnostic import DeonError, DiagnosticCode
from deon.stringifier import canonical, stringify
from deon.typer import typed
from deon.value import DeonMap


def nest_maps(depth: int):
    value = "leaf"

    for _ in range(depth):
        wrapper = DeonMap()
        wrapper.insert("k", value)
        value = wrapper

    return value


def nest_lists(depth: int):
    value = "leaf"

    for _ in range(depth):
        value = [value]

    return value


class TheDepthGuard(unittest.TestCase):
    def _assert_parse_expected(self, callable_, value):
        with self.assertRaises(DeonError) as caught:
            callable_(value)

        self.assertEqual(caught.exception.code, DiagnosticCode.PARSE_EXPECTED)

    def test_too_deep_maps_are_rejected_uniformly(self):
        deep = nest_maps(130)

        self._assert_parse_expected(stringify, deep)
        self._assert_parse_expected(canonical, deep)
        self._assert_parse_expected(typed, deep)

    def test_too_deep_lists_are_rejected_uniformly(self):
        deep = nest_lists(130)

        self._assert_parse_expected(stringify, deep)
        self._assert_parse_expected(canonical, deep)
        self._assert_parse_expected(typed, deep)

    def test_shallow_values_are_untouched_by_the_guard(self):
        shallow = DeonMap()
        shallow.insert("k", "42")

        # Writers do not raise, and produce something.
        self.assertTrue(stringify(shallow))
        self.assertTrue(canonical(shallow))

        # The typer still does its conservative job.
        self.assertEqual(typed(shallow), {"k": 42})
        self.assertEqual(typed(nest_lists(3)), [[["leaf"]]])


if __name__ == "__main__":
    unittest.main()
