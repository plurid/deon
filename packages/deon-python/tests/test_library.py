"""What the conformance manifest cannot reach.

The fixtures test the language. These test the things a *host* can do to this implementation that a
document cannot — hand it a value the parser never saw, hand it JSON the decoder is too kind about,
ask it a question about a document without evaluating one.
"""

import json
import unittest

import deon
from deon import DeonError, DiagnosticCode, ParseOptions
from deon.diagnostic import Span
from deon.jsonread import read_json
from deon.value import DeonMap


SPAN = Span.head("<test>")


class Depth(unittest.TestCase):
    """No value deeper than the limit may ever exist — and a host can try to make one."""

    def test_a_deep_document_is_refused_rather_than_fatal(self):
        source = "{ a " + "[" * 5000 + "]" * 5000 + " }"

        with self.assertRaises(DeonError) as caught:
            deon.parse(source)

        self.assertEqual(caught.exception.code, DiagnosticCode.PARSE_EXPECTED)
        self.assertIn("nests more deeply", caught.exception.message)

    def test_a_host_built_value_is_refused_before_it_is_written(self):
        """`stringify` takes a value the parser never saw. A `RecursionError` here would be a crash
        with no code and no position, which is exactly what the guard exists to prevent."""
        value = []
        for _ in range(5000):
            value = [value]

        with self.assertRaises(DeonError) as caught:
            deon.stringify(value)

        self.assertEqual(caught.exception.code, DiagnosticCode.PARSE_EXPECTED)

    def test_an_ordinary_nesting_is_written(self):
        value = []
        for _ in range(64):
            value = [value]

        self.assertTrue(deon.stringify(value))


class Json(unittest.TestCase):
    """Specification 9.1, and the three places Python's decoder is too helpful."""

    def test_a_number_keeps_its_source_spelling(self):
        value = read_json('{"a": 1.50, "b": 1e3, "c": -0.0}', SPAN)

        self.assertEqual(value["a"], "1.50")
        self.assertEqual(value["b"], "1e3")
        self.assertEqual(value["c"], "-0.0")

    def test_a_repeated_member_moves_to_its_final_position(self):
        """A plain `dict` keeps the key in the slot it first appeared in, and specification 9.1 defers
        to the last-write-wins rule of specification 5, which moves it."""
        value = read_json('{"a": 1, "b": 2, "a": 3}', SPAN)

        self.assertEqual(list(value.keys()), ["b", "a"])
        self.assertEqual(value["a"], "3")

    def test_the_json_constants_are_refused(self):
        """`json.loads('[NaN]')` succeeds by default and hands back a float. Specification 9.1
        enumerates what a JSON value may be, and NaN is not among them."""
        for text in ("[NaN]", "[Infinity]", "[-Infinity]"):
            with self.subTest(text=text):
                with self.assertRaises(DeonError) as caught:
                    read_json(text, SPAN)

                self.assertEqual(caught.exception.code, DiagnosticCode.RESOURCE_FORMAT)

    def test_booleans_and_null(self):
        value = read_json('{"t": true, "f": false, "n": null}', SPAN)

        self.assertEqual(value["t"], "true")
        self.assertEqual(value["f"], "false")
        self.assertEqual(value["n"], "")

        # And they are strings, not Python objects that happen to compare equal.
        for item in value.values():
            self.assertIsInstance(item, str)

    def test_invalid_json_is_a_resource_format_error(self):
        with self.assertRaises(DeonError) as caught:
            read_json("{ not json", SPAN)

        self.assertEqual(caught.exception.code, DiagnosticCode.RESOURCE_FORMAT)


class Entities(unittest.TestCase):
    """What a document declares, and what each would demand — without evaluating it."""

    def test_the_parameters_are_the_interpolations_it_carries(self):
        found = deon.entities("greet `Hi #{name}, you are #{role}.`\n\n{ a b }\n")

        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].name, "greet")
        self.assertEqual(found[0].parameters, ["name", "role"])
        self.assertEqual(found[0].kind, "scalar")

    def test_a_link_is_not_a_parameter_and_an_interpolation_is(self):
        """The distinction the whole thing rests on. `#voice` is a link, which the document resolves
        for itself; `#{voice}` is a hole, and a hole is a parameter *even where a leaflink of that
        name is sitting right there*."""
        linked = deon.entities("voice terse\nask [{ role a, content #voice }]\n{ ask x }\n")
        held = deon.entities("voice terse\nask `#{voice} do #{task}`\n{ ask x }\n")

        self.assertEqual(next(e for e in linked if e.name == "ask").parameters, [])
        self.assertEqual(next(e for e in held if e.name == "ask").parameters, ["task", "voice"])

    def test_it_needs_no_capability_because_it_reads_rather_than_runs(self):
        found = deon.entities("import remote from https://example.invalid/x.deon\n\n{ a b }\n")

        self.assertEqual(found[0].kind, "resource")
        self.assertEqual(found[0].parameters, [])


class Capabilities(unittest.TestCase):
    def test_a_bare_parse_reaches_nothing(self):
        for source in (
            "import x from ./x\n{ #x }\n",
            "import x from https://example.invalid/x.deon\n{ #x }\n",
        ):
            with self.subTest(source=source):
                with self.assertRaises(DeonError) as caught:
                    deon.parse(source)

                self.assertEqual(caught.exception.code, DiagnosticCode.CAPABILITY_DENIED)

    def test_the_environment_is_never_the_ambient_one(self):
        """`#$HOME` is empty unless the caller passed an environment, whatever the shell exported."""
        self.assertEqual(deon.parse("{ home #$HOME }"), {"home": ""})

        value = deon.parse_with("{ home #$HOME }", ParseOptions(environment={"HOME": "/somewhere"}))

        self.assertEqual(value, {"home": "/somewhere"})


class RoundTrip(unittest.TestCase):
    def test_parse_of_canonical_is_the_value(self):
        """Specification 13, over the awkward strings rather than the easy ones."""
        for text in (
            "plain",
            "with spaces",
            "trailing ",
            " leading",
            "",
            "http://x//y",
            "a/*b",
            "quote'inside",
            "back`tick",
            "line\nbreak",
            "tab\there",
            "brace{inside",
            "paren(inside)",
            "hash#{not}",
            "back\\slash",
            "ключ",
        ):
            with self.subTest(text=text):
                value = {"k": text}

                self.assertEqual(deon.parse(deon.canonical(value)), value)


if __name__ == "__main__":
    unittest.main()
