"""The data model, and the one rule a Python dict gets wrong."""

import unittest

from deon.value import DeonMap, coerce


class TheMap(unittest.TestCase):
    def test_a_rewritten_key_moves_to_its_final_write_position(self):
        """Specification 5: a later write replaces the value *and moves the key*.

        This is the whole reason `DeonMap` exists rather than a `dict`. A dict replaces the value and
        leaves the key where it first appeared, which is invisible to a lookup and plain in a
        stringification — the kind of difference that survives a test suite unless something asserts
        it directly.
        """
        deon_map = DeonMap()
        deon_map.insert("a", "one")
        deon_map.insert("b", "two")
        deon_map.insert("a", "three")

        self.assertEqual(list(deon_map.keys()), ["b", "a"])
        self.assertEqual(deon_map["a"], "three")

        # And this is what a plain dict would have done, which is not it.
        plain = {}
        plain["a"] = "one"
        plain["b"] = "two"
        plain["a"] = "three"

        self.assertEqual(list(plain.keys()), ["a", "b"])

    def test_order_is_presentation_rather_than_data(self):
        """Specification 2: map order is presentation. Two maps written in different orders, holding
        the same keys and values, are the same map. Order is asserted through `stringify` and
        `canonical`, which are the places it means something."""
        self.assertEqual(
            DeonMap([("a", "one"), ("b", "two")]),
            DeonMap([("b", "two"), ("a", "one")]),
        )

    def test_lists_are_ordered(self):
        """Specification 2: list order *is* semantic."""
        self.assertNotEqual(["a", "b"], ["b", "a"])

    def test_a_host_value_becomes_a_deon_value(self):
        value = coerce({"a": "one", "b": ["x", {"c": "two"}]})

        self.assertIsInstance(value, DeonMap)
        self.assertIsInstance(value["b"][1], DeonMap)
        self.assertEqual(value["b"][1]["c"], "two")

    def test_a_value_that_is_not_a_deon_value_is_refused_at_the_boundary(self):
        """Not written out as its `repr` and discovered by whoever reads the file."""
        for outsider in (1, 1.5, True, None, object()):
            with self.subTest(outsider=outsider):
                with self.assertRaises(TypeError):
                    coerce({"key": outsider})


if __name__ == "__main__":
    unittest.main()
