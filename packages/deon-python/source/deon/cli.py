"""The `deon` command.

The same surface as the `JavaScript` and `Rust` implementations, command for command, and it is meant
to stay that way — the three were differentially tested against each other, and `confile` output is
byte-identical.

The defaults are load-bearing, and they are not the library's:

    --output deon    --typed false    --filesystem TRUE    --network false

A file named on a command line was named by a *person*, so it may read the disk. Nothing said it may
reach the network. The library grants neither, because a document handed to a library came from
somewhere unknown; a document handed to this came from whoever typed the command.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
from typing import Optional

import deon
from deon import DeonError, DiagnosticCode, ParseOptions, Span, StringifyOptions


USAGE = """Usage: deon <file> [options]
       deon convert <source.json> [destination.deon]
       deon environment <source.deon> <command...>
       deon confile <files...> [--destination confile.deon]
       deon exfile <source.deon> [--unsafe-paths]
       deon lint <files...> [--warnings-as-errors]

Options:
  -o, --output <deon|json>
  -t, --typed
  -f, --filesystem <true|false>
  -n, --network <true|false>
  -d, --destination <path>
  -w, --writeover
      --unsafe-paths
      --warnings-as-errors
  -v, --version
  -h, --help
"""


class Failure(Exception):
    pass


def option(arguments: list[str], short: str, long: str, fallback: str) -> str:
    for index, argument in enumerate(arguments):
        if argument in (short, long) and index + 1 < len(arguments):
            return arguments[index + 1]

    return fallback


def flag(arguments: list[str], *names: str) -> bool:
    return any(argument in names for argument in arguments)


def positional(arguments: list[str]) -> list[str]:
    """The arguments that are not options, and not the values of options."""
    values: list[str] = []
    skip = False

    for index, argument in enumerate(arguments):
        if skip:
            skip = False
            continue

        if argument in ("-o", "--output", "-f", "--filesystem", "-n", "--network", "-d", "--destination"):
            skip = True
            continue

        if argument.startswith("-"):
            continue

        values.append(argument)

    return values


def resolve(path: str) -> str:
    """A path as the other two resolve it: joined onto the working directory, symlinks left alone.

    This is what a diagnostic names the document by, so it has to be the same string in all three or a
    tool reading the output would have to know which one produced it.
    """
    if os.path.isabs(path):
        return path

    return os.path.join(os.getcwd(), path)


def read(path: str) -> str:
    try:
        return pathlib.Path(path).read_text("utf-8")
    except OSError as failure:
        raise Failure(f"Unable to read '{path}': {failure}") from None


def read_document(path: str) -> str:
    """The document named on the command line, named by its resolved path.

    A failure here is a *diagnostic* and not a sentence, which is the library's rule rather than this
    tool's: the file was named, so it was permitted, and it failed to load. `read` is the other half —
    a file that is not a document (a JSON source, a file being archived) is read plainly, and a
    failure there has no position because there is no document to have one in.
    """
    return deon.read_file(resolve(path))


def parse_options(arguments: list[str], path: str) -> ParseOptions:
    options = ParseOptions()

    resolved = resolve(path)

    options.source_name = resolved
    options.filebase = os.path.dirname(resolved)

    # Strict `== "true"`, so a bare `-n` is false rather than an accidental grant. The comparison is
    # the same in all three implementations, and it is the conservative way round.
    options.allow_filesystem = option(arguments, "-f", "--filesystem", "true") == "true"
    options.allow_network = option(arguments, "-n", "--network", "false") == "true"

    options.environment = dict(os.environ)

    return options


# #region commands
def evaluate(arguments: list[str]) -> int:
    path = arguments[0]

    options = parse_options(arguments, path)
    value = deon.parse_with(read_document(path), options)

    output = option(arguments, "-o", "--output", "deon")
    wants_types = flag(arguments, "-t", "--typed")

    if output == "json":
        sys.stdout.write(
            json.dumps(deon.typed(value) if wants_types else plain(value), indent=4) + "\n"
        )
        return 0

    sys.stdout.write(deon.stringify(value, StringifyOptions()))

    return 0


def plain(value):
    """A Deon value as ordinary JSON containers, with every scalar still a string."""
    from deon.value import DeonMap

    if isinstance(value, DeonMap):
        return {key: plain(item) for key, item in value.items()}

    if isinstance(value, list):
        return [plain(item) for item in value]

    return value


def convert(arguments: list[str]) -> int:
    if len(arguments) < 2:
        raise Failure("convert requires a source file.")

    source = arguments[1]

    # Deon's own JSON reader, and not the host's: a JSON number keeps its source token spelling
    # (specification 9.1), so `1.50` converts to `1.50` and not to `1.5`. Reading it with the host's
    # decoder would give the same file two different meanings depending on how it arrived.
    from deon.diagnostic import Span
    from deon.jsonread import read_json

    value = read_json(read(source), Span.head(source))
    written = deon.stringify(value, StringifyOptions())

    destinations = positional(arguments[2:])

    if destinations:
        pathlib.Path(destinations[0]).write_text(written, "utf-8")
        return 0

    sys.stdout.write(written)

    return 0


def environment(arguments: list[str]) -> int:
    if len(arguments) < 3:
        raise Failure("environment requires a source file and a command.")

    source = arguments[1]

    # Not `parse_options`, which reads the flags out of the argument list — and here the argument list
    # is somebody else's. `deon environment app.deon curl -n https://…` must pass that `-n` to `curl`
    # and must not read it as a grant of the network.
    value = deon.parse_file(source)

    from deon.value import DeonMap

    if not isinstance(value, DeonMap):
        raise Failure("An environment source must contain a root map.")

    variables = dict(os.environ)
    writeover = flag(arguments, "-w", "--writeover")

    for name, item in value.items():
        if isinstance(item, list):
            item = os.pathsep.join(part for part in item if isinstance(part, str))

        if not isinstance(item, str):
            continue

        if writeover or name not in variables:
            variables[name] = item

    # Everything after the source is the command, *verbatim*, with only this command's own flag taken
    # out. It cannot be filtered for things that look like options: `sh -c '...'` has a `-c` that
    # belongs to `sh`, and a CLI that ate it would silently run something the caller did not ask for.
    command = positional(arguments[2:])

    if not command:
        raise Failure("environment requires a command to run.")

    finished = subprocess.run(command, env=variables)

    return finished.returncode


def confile(arguments: list[str]) -> int:
    destination = option(arguments, "-d", "--destination", "confile.deon")

    files = [file for file in positional(arguments[1:]) if file != destination]

    if not files:
        raise Failure("confile requires at least one input file.")

    from deon.value import DeonMap

    root = DeonMap()

    for file in files:
        entry = DeonMap()
        entry.insert("data", read(file))

        # Keyed by the path as it was typed, so that `exfile` puts it back where it came from.
        root.insert(file, entry)

    pathlib.Path(destination).write_text(deon.stringify(root, StringifyOptions()), "utf-8")

    return 0


def exfile(arguments: list[str]) -> int:
    if len(arguments) < 2:
        raise Failure("exfile requires a source file.")

    source = arguments[1]
    unsafe_paths = flag(arguments, "--unsafe-paths")

    value = deon.parse_file(source)

    from deon.value import DeonMap

    if not isinstance(value, DeonMap):
        raise Failure("An exfile source must contain a root map.")

    planned: list[tuple[pathlib.Path, str]] = []

    # Every entry is checked before *any* is written, so a document with one bad path writes nothing
    # at all rather than leaving half an archive on the disk. A `.deon` file is data, and data must
    # not be able to write wherever it likes.
    for path, entry in value.items():
        if isinstance(entry, str):
            data = entry
        elif isinstance(entry, DeonMap) and isinstance(entry.get("data"), str):
            data = entry["data"]
        else:
            raise Failure(
                f"Exfile entry '{path}' must be a string or a map with a string data field."
            )

        target = pathlib.Path(path)

        if not unsafe_paths:
            escapes = os.path.normpath(path).startswith("..")

            if target.is_absolute() or escapes:
                raise Failure(f"Unsafe exfile path '{path}'. Use --unsafe-paths to permit it.")

        planned.append((target, data))

    for target, data in planned:
        if target.parent != pathlib.Path(""):
            target.parent.mkdir(parents=True, exist_ok=True)

        target.write_text(data, "utf-8")

    return 0


def lint(arguments: list[str]) -> int:
    files = positional(arguments[1:])

    if not files:
        raise Failure("lint requires at least one file.")

    warnings_are_errors = flag(arguments, "--warnings-as-errors")
    warned = False

    for file in files:
        source = read_document(file)
        path = resolve(file)

        for diagnostic in deon.lint(source, path):
            warned = True

            sys.stdout.write(
                f"{path}:{diagnostic.line}:{diagnostic.column} "
                f"{diagnostic.severity} {diagnostic.code} {diagnostic.message}\n"
            )

        # Linting reports what is legal and questionable; evaluation is what surfaces what is wrong.
        # A `lint` that only did the first would call a broken document clean.
        deon.parse_with(source, parse_options(arguments, file))

    return 1 if (warned and warnings_are_errors) else 0
# #endregion commands


COMMANDS = {
    "convert": convert,
    "environment": environment,
    "confile": confile,
    "exfile": exfile,
    "lint": lint,
}


def main(argv: Optional[list[str]] = None) -> int:
    arguments = list(argv if argv is not None else sys.argv[1:])

    if not arguments or flag(arguments, "-h", "--help"):
        sys.stdout.write(USAGE)
        return 0

    if flag(arguments, "-v", "--version"):
        sys.stdout.write(deon.__version__ + "\n")
        return 0

    command = COMMANDS.get(arguments[0], evaluate)

    try:
        return command(arguments)
    except DeonError as failure:
        # Every diagnostic it managed to collect, each with its own code and position — the same line
        # an editor would underline. Flattening them into one sentence would throw away the only part
        # a tool can read.
        for diagnostic in failure.diagnostics:
            span = diagnostic.span

            sys.stderr.write(
                f"{span.source}:{span.line}:{span.column} "
                f"{diagnostic.severity} {diagnostic.code} {diagnostic.message}\n"
            )

        return 1
    except Failure as failure:
        # A complaint about the command line rather than about a document. It has no position, because
        # there is no document to have one in.
        sys.stderr.write(f"deon: {failure}\n")

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
