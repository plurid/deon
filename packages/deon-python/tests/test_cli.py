"""The `deon` command.

`scripts/cli-harness.py` compares this tool against the other two, and that is the test that matters —
it is the one that found the bugs pinned below. But a divergence it reports is a bug in *one of three*
implementations, and it cannot say which. These say which.
"""

from __future__ import annotations

import contextlib
import io
import os
import pathlib
import tempfile
import unittest

from deon import DiagnosticCode
from deon.cli import main


class Tool(unittest.TestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp())
        self.origin = os.getcwd()

        os.chdir(self.directory)

    def tearDown(self):
        os.chdir(self.origin)

    def write(self, name: str, content: str) -> str:
        path = self.directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, "utf-8")

        return name

    def run_tool(self, *arguments: str) -> tuple[int, str, str]:
        """The tool as a person runs it.

        `main` catches a `DeonError` and *reports* it, which is the whole point of a tool: an exit
        status and a diagnostic on the error stream, never a traceback. So the tests assert on what a
        person sees, and not on an exception that a person never would.
        """
        output = io.StringIO()
        errors = io.StringIO()

        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = main(list(arguments))

        return code, output.getvalue(), errors.getvalue()


class Arguments(Tool):
    def test_a_command_keeps_its_own_options(self):
        """The bug this suite exists for.

        `environment` takes everything after the source verbatim. A helper that skipped anything
        starting with `-` ate the `-c` out of `sh -c '…'`, and `sh` ran something nobody asked for.
        """
        source = self.write("env.deon", "{\n    GREETING hello\n}\n")

        code, _, _ = self.run_tool("environment", source, "sh", "-c", "exit 3")

        # `sh` exited 3, which it could only have done by receiving its `-c`.
        self.assertEqual(code, 3)

    def test_a_commands_option_is_not_read_as_a_capability(self):
        """`deon environment app.deon curl -n https://…` must pass `-n` to `curl`.

        Reading it as `--network true` would be granting the network on the strength of an argument
        that was never addressed to Deon.
        """
        source = self.write("env.deon", "{\n    GREETING hello\n}\n")

        # If the `-n` were read as this tool's own, the document would still evaluate and the command
        # would still run — nothing would look wrong. So the assertion has to be on what the command
        # *received*, which is the only place the difference is visible.
        code, _, _ = self.run_tool(
            "environment",
            source,
            "sh",
            "-c",
            'test "$1" = "-n"',
            "sh",
            "-n",
        )

        self.assertEqual(code, 0)


class Documents(Tool):
    def test_a_missing_document_is_a_diagnostic_and_not_an_oserror(self):
        """It was named, so it was permitted, and it failed to load: `DEON_RESOURCE_IO`.

        A raw `OSError` would carry no code and no position, and an editor could show nothing.
        """
        code, _, reported = self.run_tool("nowhere.deon")

        self.assertEqual(code, 1)
        self.assertIn(DiagnosticCode.RESOURCE_IO, reported)

        # And it carries a position, which is the half a bare sentence would have thrown away.
        self.assertIn(":1:1 error", reported)

    def test_the_filesystem_is_granted_and_the_network_is_not(self):
        """The tool's defaults are not the library's, and the difference is the point.

        A file named on a command line was named by a person, so it may read the disk. Nothing said it
        may reach the network.
        """
        self.write("child.deon", "{\n    inner value\n}\n")
        source = self.write("main.deon", "import c from child.deon\n{\n    ...#c\n}\n")

        code, written, _ = self.run_tool(source)

        self.assertEqual(code, 0)
        self.assertIn("inner value", written)

        remote = self.write(
            "remote.deon",
            "import r from https://example.com/r.deon\n{\n    #r\n}\n",
        )

        code, _, reported = self.run_tool(remote)

        self.assertEqual(code, 1)
        self.assertIn(DiagnosticCode.CAPABILITY_DENIED, reported)

    def test_the_filesystem_can_be_taken_away(self):
        self.write("child.deon", "{\n    inner value\n}\n")
        source = self.write("main.deon", "import c from child.deon\n{\n    ...#c\n}\n")

        code, _, reported = self.run_tool(source, "-f", "false")

        self.assertEqual(code, 1)
        self.assertIn(DiagnosticCode.CAPABILITY_DENIED, reported)


class Exfile(Tool):
    """A `.deon` file is data, and data must not be able to write wherever it likes."""

    def test_an_absolute_path_is_refused(self):
        source = self.write(
            "archive.deon",
            "{\n    '/etc/deon-must-not-exist' {\n        data 'no'\n    }\n}\n",
        )

        code, _, _ = self.run_tool("exfile", source)

        self.assertEqual(code, 1)
        self.assertFalse(pathlib.Path("/etc/deon-must-not-exist").exists())

    def test_a_path_that_climbs_out_is_refused(self):
        source = self.write(
            "archive.deon",
            "{\n    '../escaped.txt' {\n        data 'no'\n    }\n}\n",
        )

        code, _, _ = self.run_tool("exfile", source)

        self.assertEqual(code, 1)
        self.assertFalse((self.directory.parent / "escaped.txt").exists())

    def test_one_bad_entry_writes_nothing_at_all(self):
        """Every entry is checked before any is written.

        A document with one bad path leaving half an archive on the disk would be the worst of both:
        it failed, and it changed things.
        """
        source = self.write(
            "archive.deon",
            "{\n"
            "    'good.txt' {\n        data 'first'\n    }\n"
            "    '../escaped.txt' {\n        data 'no'\n    }\n"
            "}\n",
        )

        code, _, _ = self.run_tool("exfile", source)

        self.assertEqual(code, 1)
        self.assertFalse((self.directory / "good.txt").exists())

    def test_a_safe_archive_round_trips(self):
        self.write("one.txt", "first")
        self.write("two.txt", "second")

        self.run_tool("confile", "one.txt", "two.txt", "-d", "archive.deon")

        (self.directory / "one.txt").unlink()
        (self.directory / "two.txt").unlink()

        code, _, _ = self.run_tool("exfile", "archive.deon")

        self.assertEqual(code, 0)
        self.assertEqual((self.directory / "one.txt").read_text("utf-8"), "first")
        self.assertEqual((self.directory / "two.txt").read_text("utf-8"), "second")


if __name__ == "__main__":
    unittest.main()
