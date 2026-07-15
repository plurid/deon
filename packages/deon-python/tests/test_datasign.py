"""Typing a document against a declared contract (specification 14.1)."""

from __future__ import annotations

import os
import pathlib
import tempfile
import unittest

import deon
from deon import DeonError, DiagnosticCode, ParseOptions
from deon.datasign import numeric, parse_datasign


CONTRACT = """
// The shape of an account.
@graphql
data Account {
    id: string;
    age: number;
    admin: boolean;
    nickname?: string;      // optional
}

data Team {
    name: string;
    members: Account[];
}
"""


class Reading(unittest.TestCase):
    def test_the_shape_is_taken_and_nothing_else(self):
        signatures = parse_datasign(CONTRACT)

        self.assertEqual(sorted(signatures), ["Account", "Team"])

        account = {field.name: (field.type, field.required) for field in signatures["Account"]}

        self.assertEqual(
            account,
            {
                "id": ("string", True),
                "age": ("number", True),
                "admin": ("boolean", True),
                # The `?` is the whole of the optionality, and it is not part of the name.
                "nickname": ("string", False),
            },
        )

    def test_the_last_source_wins_on_a_repeated_entity(self):
        signatures = deon.read_datasign(
            ["data A {\n    x: string;\n}", "data A {\n    x: number;\n}"]
        )

        self.assertEqual(signatures["A"][0].type, "number")


class Numbers(unittest.TestCase):
    """§14.1 fixes the numeric grammar as ECMAScript's, which is not Python's.

    `float('1_000')` is 1000 in Python and a mismatch in ECMAScript; `float('0x10')` raises in Python
    and is 16 in ECMAScript. A contract has to mean the same thing in every implementation, so the
    grammar is written out rather than delegated to the host.
    """

    def test_what_is_a_number(self):
        for text, expected in [
            ("42", 42),
            ("007", 7),
            ("1.50", 1.5),
            (" 12 ", 12),
            ("0x10", 16),
            ("0b11", 3),
            ("0o7", 7),
            ("1e3", 1000),
            ("-0", 0),
            ("+5", 5),
            (".5", 0.5),
            ("5.", 5),
        ]:
            with self.subTest(text=text):
                self.assertEqual(numeric(text), expected)

    def test_what_is_not(self):
        for text in ["1_000", "", "   ", "Infinity", "NaN", "1,2", "true", "0x", "12px"]:
            with self.subTest(text=text):
                self.assertIsNone(numeric(text))

    def test_an_integral_number_is_an_integer(self):
        """ECMAScript has one number type and prints `42`. A Python `42.0` is the same number written
        differently, and the implementations are required to agree character for character."""
        self.assertIsInstance(numeric("42"), int)
        self.assertIsInstance(numeric("1e3"), int)
        self.assertIsInstance(numeric("1.5"), float)


class Applying(unittest.TestCase):
    def options(self, **extra) -> ParseOptions:
        options = ParseOptions(
            resources={"account.datasign": CONTRACT},
            datasign_files=["account.datasign"],
        )

        for name, value in extra.items():
            setattr(options, name, value)

        return options

    def test_a_declaration_beats_a_guess(self):
        """The whole point. `007` stays a string to the conservative typer, because it cannot know;
        a contract knows."""
        value = deon.parse_with(
            "{\n    account {\n        id 007\n        age 007\n        admin true\n    }\n}",
            self.options(datasign_map={"account": "Account"}),
        )

        self.assertEqual(value["account"]["id"], "007")
        self.assertEqual(value["account"]["age"], 7)
        self.assertIs(value["account"]["admin"], True)

    def test_an_optional_field_may_be_absent_and_an_unknown_key_passes_through(self):
        value = deon.parse_with(
            "{\n    account {\n        id a\n        age 30\n        admin false\n        extra kept\n    }\n}",
            self.options(datasign_map={"account": "Account"}),
        )

        self.assertNotIn("nickname", value["account"])

        # A contract describes what it knows about, and silence is not a claim.
        self.assertEqual(value["account"]["extra"], "kept")

    def test_the_write_order_is_kept(self):
        value = deon.parse_with(
            "{\n    account {\n        admin true\n        age 30\n        id a\n    }\n}",
            self.options(datasign_map={"account": "Account"}),
        )

        self.assertEqual(list(value["account"]), ["admin", "age", "id"])

    def test_a_list_and_a_nested_entity(self):
        value = deon.parse_with(
            "{\n"
            "    team {\n"
            "        name Ops\n"
            "        members [\n"
            "            { id a, age 30, admin true }\n"
            "            { id b, age 40, admin false }\n"
            "        ]\n"
            "    }\n"
            "}",
            self.options(datasign_map={"team": "Team"}),
        )

        self.assertEqual(value["team"]["members"][1]["age"], 40)
        self.assertIs(value["team"]["members"][1]["admin"], False)

    def test_a_value_that_contradicts_its_contract(self):
        with self.assertRaises(DeonError) as caught:
            deon.parse_with(
                "{\n    account {\n        id a\n        age thirty\n        admin true\n    }\n}",
                self.options(datasign_map={"account": "Account"}),
            )

        self.assertEqual(caught.exception.code, DiagnosticCode.TYPE_MISMATCH)

        # No token survives evaluation, so the path through the data is what makes it actionable.
        self.assertIn("account.age", caught.exception.message)

    def test_a_missing_required_field(self):
        with self.assertRaises(DeonError) as caught:
            deon.parse_with(
                "{\n    account {\n        id a\n        admin true\n    }\n}",
                self.options(datasign_map={"account": "Account"}),
            )

        self.assertEqual(caught.exception.code, DiagnosticCode.TYPE_MISMATCH)

    def test_an_unknown_type_leaves_its_value_alone(self):
        """Datasign permits types defined elsewhere, and a value is not to be guessed at merely
        because its type was not found."""
        value = deon.parse_with(
            "{\n    when 2024-01-01\n}",
            self.options(datasign_map={"when": "Date"}),
        )

        self.assertEqual(value["when"], "2024-01-01")

    def test_no_map_leaves_everything_a_string(self):
        value = deon.parse_with("{\n    age 30\n}", self.options())

        self.assertEqual(value["age"], "30")


class Capabilities(unittest.TestCase):
    def test_reading_a_contract_needs_the_filesystem(self):
        """A contract on a disk is filesystem access like any other (§9). A raw string handed to
        `parse` grants nothing, so it may not go and read one."""
        with self.assertRaises(DeonError) as caught:
            deon.parse(
                "{ account { id a } }",
                ParseOptions(
                    datasign_files=["account.datasign"],
                    datasign_map={"account": "Account"},
                ),
            )

        self.assertEqual(caught.exception.code, DiagnosticCode.CAPABILITY_DENIED)

    def test_a_contract_that_was_allowed_and_could_not_be_read(self):
        """Allowed and failed is not the same as never allowed, and the codes must not be confused."""
        with self.assertRaises(DeonError) as caught:
            deon.parse_with(
                "{ account { id a } }",
                ParseOptions(
                    allow_filesystem=True,
                    datasign_files=["nowhere.datasign"],
                    datasign_map={"account": "Account"},
                ),
            )

        self.assertEqual(caught.exception.code, DiagnosticCode.RESOURCE_IO)

    def test_a_contract_beside_the_document(self):
        directory = pathlib.Path(tempfile.mkdtemp())

        (directory / "account.datasign").write_text(CONTRACT, "utf-8")
        (directory / "main.deon").write_text(
            "{\n    account {\n        id 007\n        age 30\n        admin true\n    }\n}\n",
            "utf-8",
        )

        options = ParseOptions(
            datasign_files=["account.datasign"],
            datasign_map={"account": "Account"},
        )

        value = deon.parse_file(str(directory / "main.deon"), options)

        self.assertEqual(value["account"]["age"], 30)
        self.assertEqual(value["account"]["id"], "007")


#: `Text.datasign`, copied verbatim from the `datasign` project's own test suite.
#:
#: The format belongs to that project, and this is an adapter to it. A reader written from a sibling's
#: source could drift from the format for years and nothing here would notice, so the thing it must
#: read is a file the format's own compiler reads.
DATASIGN_OWN_TEST_FILE = """/**
 * Documentation Comment
 *
 */
@sign: TextEntity; // assigns an ID to the type itself
@graphql: type: input;
data Text {
    // type the `id` field to `ID` in GraphQL, and `string` for TypeScript/Protocol Buffers/gRPC
    @graphql: ID;
    id: string;

    name: string;
    value: string;
    @graphql: Int;
    characters: number;
    public: boolean;

    @graphql: Date;
    @protobuf: number;
    generatedAt: Date;
    generatedBy: User;
}

data User {
    id: string;
    name: string;
}
"""


class TheFormatItself(unittest.TestCase):
    def test_datasigns_own_test_file_reads(self):
        signatures = parse_datasign(DATASIGN_OWN_TEST_FILE)

        self.assertEqual(sorted(signatures), ["Text", "User"])

        text = {field.name: field.type for field in signatures["Text"]}

        self.assertEqual(
            text,
            {
                "id": "string",
                "name": "string",
                "value": "string",
                "characters": "number",
                "public": "boolean",
                # A type datasign expects to be defined elsewhere. It is not an entity here, so a
                # value declared with it is left exactly as it was parsed.
                "generatedAt": "Date",
                "generatedBy": "User",
            },
        )

        # The entity annotations (`@sign:`, `@graphql:`), the field annotations, and the documentation
        # comment carry no shape and are all skipped.
        self.assertTrue(all(field.required for field in signatures["Text"]))

    def test_a_question_mark_anywhere_makes_the_field_optional(self):
        """datasign's own rule, and not a tidier one invented here.

        Its reader is `required = !/\\?/.test(line)`, so both spellings below are optional to the
        compiler that owns the format. An adapter that read only the first would demand a field that
        datasign says may be absent.
        """
        for line in ["    nickname?: string;", "    nickname: string?;"]:
            with self.subTest(line=line):
                fields = parse_datasign("data A {\n" + line + "\n}")["A"]

                self.assertEqual(fields[0].name, "nickname")
                self.assertEqual(fields[0].type, "string")
                self.assertFalse(fields[0].required)

    def test_a_composed_type_is_not_an_entity_and_fails_safe(self):
        """`C = A & { … }` is a datasign declaration this reader takes no entity from.

        So a value typed `C` falls under 'defined elsewhere' and is left exactly as it was parsed.
        That is a limitation, and it is the safe one: it never converts a value it does not
        understand.
        """
        signatures = parse_datasign(
            "data Base {\n    id: string;\n}\n\nComposed = Base & {\n    extra: number;\n}\n"
        )

        self.assertEqual(sorted(signatures), ["Base"])


if __name__ == "__main__":
    unittest.main()
