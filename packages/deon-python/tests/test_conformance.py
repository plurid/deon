"""The conformance suite.

`spec/conformance/cases.json` is read here, and never copied: an implementation that tests against its
own copy of the fixtures tests that it agrees with itself.

An implementation conforms only when it produces the required diagnostic **code and source position**
for every invalid fixture (specification 15). A code on its own is not conformance, because a
diagnostic an editor cannot place is a diagnostic it cannot show.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
import posixpath
import unittest

import deon
from deon import DeonError, ParseOptions, StringifyOptions
from deon.value import DeonMap


MANIFEST = (
    pathlib.Path(__file__).resolve().parents[3] / "spec" / "conformance" / "cases.json"
)


@dataclasses.dataclass
class Checked:
    """What the harness actually looked at.

    The guard against a fixture that asserts nothing is easy; the guard against a *harness* that
    silently ignores a field it was handed is this. Every branch counts itself, and at the end the
    counts must equal what the manifest declares — so a harness that quietly stops reading `lint`, or
    `position`, fails, rather than going on showing green over an assertion nobody makes any more.
    """

    expected: int = 0
    error: int = 0
    position: int = 0
    canonical: int = 0
    stringify: int = 0
    typed: int = 0
    lint: int = 0


def declared_counts(cases: list[dict]) -> Checked:
    declared = Checked()

    for case in cases:
        for field in dataclasses.fields(Checked):
            if case.get(field.name) is not None:
                setattr(declared, field.name, getattr(declared, field.name) + 1)

    return declared


def source_of(case: dict) -> str:
    if "file" in case:
        return case["files"][case["file"]]

    return case["source"]


def options_of(case: dict) -> ParseOptions:
    options = ParseOptions()

    if "file" in case:
        # Served entirely from the manifest, with the filesystem and the network denied. A conformance
        # harness must not reach a public network service (specification 15).
        options.resources = dict(case["files"])
        options.source_name = case["file"]
        options.filebase = posixpath.dirname(case["file"])

    # An *empty* environment is still an environment. `missing-environment-is-empty` declares `{}`,
    # and a truthiness test would skip it and quietly let the library fall back to something else.
    if case.get("environment") is not None:
        options.environment = dict(case["environment"])

    given = case.get("options") or {}

    if "absolutePaths" in given:
        options.absolute_paths = dict(given["absolutePaths"])

    if "allowFilesystem" in given:
        options.allow_filesystem = bool(given["allowFilesystem"])

    if "allowNetwork" in given:
        options.allow_network = bool(given["allowNetwork"])

    if "sourceName" in given:
        options.source_name = given["sourceName"]

    if "filebase" in given:
        options.filebase = given["filebase"]

    return options


def stringify_options_of(given: dict) -> StringifyOptions:
    return StringifyOptions(
        canonical=given.get("canonical", False),
        readable=given.get("readable", True),
        indentation=given.get("indentation", 4),
        leaflinks=given.get("leaflinks", False),
        leaflink_level=given.get("leaflinkLevel", 1),
        leaflink_shortening=given.get("leaflinkShortening", True),
        generated_header=given.get("generatedHeader", False),
        generated_comments=given.get("generatedComments", False),
    )


def matches(value, expected) -> bool:
    """A Deon value against the manifest's JSON.

    A map is compared by lookup with an equal number of keys, and deliberately not by order: map order
    is presentation rather than data (specification 2), and it is asserted through `canonical` and
    `stringify`, which are the places it means something.
    """
    if isinstance(expected, str):
        return isinstance(value, str) and value == expected

    if isinstance(expected, list):
        return (
            isinstance(value, list)
            and len(value) == len(expected)
            and all(matches(item, want) for item, want in zip(value, expected))
        )

    if isinstance(expected, dict):
        if not isinstance(value, DeonMap) or len(value) != len(expected):
            return False

        return all(key in value and matches(value[key], want) for key, want in expected.items())

    return False


def typed_matches(value, expected) -> bool:
    """The typed value against the manifest's JSON.

    `True == 1` in Python and `isinstance(True, int)` is true, so booleans are settled first, on both
    sides. Without that, `yes` typed into the number 1 would satisfy an assertion that says `true`.
    """
    if isinstance(expected, bool) or isinstance(value, bool):
        return isinstance(value, bool) and isinstance(expected, bool) and value == expected

    if isinstance(expected, (int, float)):
        # Numerically, so that an exponent form typed to 1000.0 matches a manifest that wrote 1000.
        return isinstance(value, (int, float)) and float(value) == float(expected)

    if isinstance(expected, str):
        return isinstance(value, str) and value == expected

    if isinstance(expected, list):
        return (
            isinstance(value, list)
            and len(value) == len(expected)
            and all(typed_matches(item, want) for item, want in zip(value, expected))
        )

    if isinstance(expected, dict):
        if not isinstance(value, dict) or len(value) != len(expected):
            return False

        return all(key in value and typed_matches(value[key], want) for key, want in expected.items())

    return False


class Conformance(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = json.loads(MANIFEST.read_text("utf-8"))["cases"]

    def test_the_manifest_is_there(self):
        self.assertTrue(self.cases, "the conformance manifest is empty")

    def test_conformance(self):
        checked = Checked()
        failures: list[str] = []

        for case in self.cases:
            try:
                self.run_case(case, checked)
            except AssertionError as why:
                failures.append(f"{case['id']}: {why}")
            except Exception as why:  # a crash is a failure, and it names itself
                failures.append(f"{case['id']}: {type(why).__name__}: {why}")

        self.assertEqual(
            failures,
            [],
            f"\n\n{len(failures)} of {len(self.cases)} fixtures failed:\n  "
            + "\n  ".join(failures),
        )

        # And the harness looked at everything the manifest declared.
        self.assertEqual(checked, declared_counts(self.cases))

    def run_case(self, case: dict, checked: Checked) -> None:
        source = source_of(case)
        options = options_of(case)

        if case.get("error") is not None:
            try:
                deon.parse_with(source, options)
            except DeonError as failure:
                self.assertEqual(
                    failure.code,
                    case["error"],
                    f"expected {case['error']}, got {failure.code} ({failure.message})",
                )

                checked.error += 1

                if case.get("position") is not None:
                    span = failure.diagnostics[0].span

                    self.assertEqual(
                        {"line": span.line, "column": span.column},
                        case["position"],
                        f"{case['error']} reported at {span.line}:{span.column}",
                    )

                    checked.position += 1
            else:
                raise AssertionError(
                    f"expected {case['error']}, but the document evaluated successfully"
                )

            # An error case asserts its error and nothing else.
            return

        asserted = False

        if case.get("expected") is not None:
            value = deon.parse_with(source, options)

            self.assertTrue(
                matches(value, case["expected"]),
                f"evaluated to {value!r}, expected {case['expected']!r}",
            )

            checked.expected += 1
            asserted = True

        if case.get("canonical") is not None:
            self.assertEqual(
                deon.canonical_source(source, options),
                case["canonical"],
                "canonical form",
            )

            checked.canonical += 1
            asserted = True

        if case.get("stringify") is not None:
            value = deon.parse_with(source, options)

            self.assertEqual(
                deon.stringify(value, stringify_options_of(case["stringify"].get("options") or {})),
                case["stringify"]["expected"],
                "stringified",
            )

            checked.stringify += 1
            asserted = True

        if case.get("typed") is not None:
            value = deon.parse_with(source, options)

            self.assertTrue(
                typed_matches(deon.typed(value), case["typed"]),
                f"typed to {deon.typed(value)!r}, expected {case['typed']!r}",
            )

            checked.typed += 1
            asserted = True

        if case.get("lint") is not None:
            produced = {diagnostic.code for diagnostic in deon.lint(source)}

            for code in case["lint"]:
                self.assertIn(code, produced, "linted")

            checked.lint += 1
            asserted = True

        self.assertTrue(asserted, "the fixture asserts nothing")


class Invariants(unittest.TestCase):
    """What the manifest cannot say, and the specification does."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = json.loads(MANIFEST.read_text("utf-8"))["cases"]

    def test_canonical_round_trips(self):
        """Specification 13: for every value `v`, `parse(canonical(v))` must equal `v`."""
        for case in self.cases:
            if case.get("error") is not None:
                continue

            with self.subTest(id=case["id"]):
                value = deon.parse_with(source_of(case), options_of(case))
                again = deon.parse(deon.canonical(value))

                self.assertEqual(again, value)

    def test_a_rewritten_key_moves_to_its_final_position(self):
        """Specification 5, asserted where it shows: in the writing."""
        value = deon.parse("{ a one\nb two\na three }")

        self.assertEqual(deon.stringify(value), "{\n    b two\n    a three\n}\n")

    def test_a_column_counts_code_points_and_not_bytes(self):
        """`ключ` is four characters and eight bytes, and a column is a character."""
        with self.assertRaises(DeonError) as caught:
            deon.parse("{\n    ключ value\n}\n")

        span = caught.exception.diagnostics[0].span

        self.assertEqual((span.line, span.column), (2, 5))

    def test_a_document_outside_ascii_is_read(self):
        value = deon.parse("{\n    'ключ' значение\n}\n")

        self.assertEqual(value["ключ"], "значение")


if __name__ == "__main__":
    unittest.main()
