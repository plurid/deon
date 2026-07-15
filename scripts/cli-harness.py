#!/usr/bin/env python3
"""Run every `deon` command line tool against the same arguments, and require the same behaviour.

`scripts/harness.py` is the same question asked of the three *libraries*. This asks it of the three
*tools*, which is not the same question: a tool has defaults, an argument grammar, an exit status, and
a filesystem it writes to, and none of those live in the library that eight of the fixtures test.

They diverged, and every one of the divergences was invisible to the conformance suite:

- `deon environment app.deon sh -c 'echo hi'` — Python's argument parser dropped anything beginning
  with `-`, so `sh` lost its `-c` and ran the wrong thing. The same bug let a command's own `-n` be
  read as a grant of the network.
- `deon nowhere.deon` — Rust reported `DEON_RESOURCE_IO`, `JavaScript` reported a raw `ENOENT` with
  no code and no position, Python reported a bare sentence.
- `deon lint broken.deon` — Rust named the document `<memory>`.

What is compared is what is *normative*: the exit status, the standard output, the files written, and
for each diagnostic its code and its position. Not the prose. A diagnostic's message is not part of
the language — `spec/diagnostics.md` fixes the code and the position and deliberately says nothing
about the sentence, and it could not, because the sentence quotes the host: "No such file or
directory" against "ENOENT: no such file or directory". Requiring three implementations to agree on
English would be requiring them to agree about an operating system.

Wording is still printed when it differs, because a message that names the *wrong fault* is a bug even
when the code is right. That is how a Python parse error came to blame an unquoted string that the
author never wrote.

    python3 scripts/cli-harness.py

It builds the two compiled tools itself. The Rust one is behind `required-features = ["cli"]`, so a
plain `cargo build` does not produce it — which is not a footnote: it left a stale binary in place, and
the harness spent a whole run reporting bugs that had already been fixed.
"""

from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = pathlib.Path(__file__).resolve().parent.parent

RUST = [str(ROOT / "packages/deon-rust/target/debug/deon")]
JAVASCRIPT = ["node", str(ROOT / "packages/deon-javascript/binder/deon")]
PYTHON = [sys.executable, "-m", "deon.cli"]
GO = [str(ROOT / "packages/deon-go/deon")]
C = [str(ROOT / "packages/deon-c/build/deon")]

#: Python runs from the source tree, as the other two do, so that nothing has to be installed first.
PYTHON_ENVIRONMENT = dict(os.environ, PYTHONPATH=str(ROOT / "packages/deon-python/source"))

IMPLEMENTATIONS = (
    ("rust", RUST, None),
    ("javascript", JAVASCRIPT, None),
    ("python", PYTHON, PYTHON_ENVIRONMENT),
    ("go", GO, None),
    ("c", C, None),
)

BUILDS = (
    # `--features cli` and not a plain build: the binary is behind `required-features`, and without
    # the feature `cargo build` reports success and produces nothing.
    (ROOT / "packages/deon-rust", ["cargo", "build", "--quiet", "--features", "cli"]),
    (ROOT / "packages/deon-javascript", ["npm", "run", "build"]),
    (ROOT / "packages/deon-go", ["go", "build", "-o", "deon", "./cmd/deon"]),
    (ROOT / "packages/deon-c", ["make", "deon"]),
)

#: `<path>:<line>:<column> <severity> <CODE> <message>` — everything but the message is normative.
DIAGNOSTIC = re.compile(
    r"^(?P<path>.*?):(?P<line>\d+):(?P<column>\d+) (?P<severity>\w+) (?P<code>DEON_\w+) (?P<message>.*)$"
)


#: The documents every case is run against. Written fresh for each implementation, in its own
#: directory, so that a tool which writes a file cannot be seen by the next one.
DOCUMENTS = {
    "main.deon": "{\n    name deon\n    versions [ one two ]\n    count 42\n    on true\n}\n",
    "imports.deon": "import c from child.deon\n{\n    ...#c\n}\n",
    "child.deon": "{\n    inner value\n}\n",
    "remote.deon": "import r from https://example.com/r.deon\n{\n    #r\n}\n",
    "broken.deon": "{\n    a [ one\n}\n",
    "duplicate.deon": "{\n    a one\n    a two\n}\n",
    "data.json": '{"a": 1.50, "b": [1, 2]}\n',
    "env.deon": "{\n    GREETING hello\n    HOME overwritten\n}\n",
    "archive.deon": "{\n    'out/one.txt' {\n        data 'first'\n    }\n}\n",
    "absolute.deon": "{\n    '/etc/deon-should-never-exist' {\n        data 'no'\n    }\n}\n",
    "escaping.deon": "{\n    '../escaped.txt' {\n        data 'no'\n    }\n}\n",
}

CASES = [
    # The document, and the two ways of writing it back out.
    ("parse", ["main.deon"]),
    ("json typed", ["main.deon", "-o", "json", "-t"]),
    ("json untyped", ["main.deon", "-o", "json"]),

    # The capabilities. Naming a file on a command line grants the disk and grants nothing else, so
    # the default is that an import may read and a remote target may not be reached.
    ("import allowed by default", ["imports.deon"]),
    ("import denied", ["imports.deon", "-f", "false"]),
    ("network denied by default", ["remote.deon"]),

    # A document that will not parse, and one that is not there.
    ("parse error", ["broken.deon"]),
    ("missing file", ["nowhere.deon"]),

    ("convert to standard output", ["convert", "data.json"]),
    ("convert to a file", ["convert", "data.json", "out.deon"]),
    ("convert a missing source", ["convert", "nowhere.json"]),

    ("environment", ["environment", "env.deon", "sh", "-c", "echo $GREETING"]),
    ("environment writeover", ["environment", "env.deon", "-w", "sh", "-c", "echo $HOME"]),
    ("environment without a command", ["environment", "env.deon"]),
    # The command's own options belong to the command. A tool that ate this `-n` would be granting
    # itself the network on the strength of an argument meant for `sh`.
    ("environment passes options through", ["environment", "env.deon", "sh", "-c", "echo -n passed"]),

    ("confile", ["confile", "main.deon", "child.deon"]),

    ("lint a clean document", ["lint", "main.deon"]),
    ("lint a duplicate key", ["lint", "duplicate.deon"]),
    ("lint a duplicate key, strictly", ["lint", "duplicate.deon", "--warnings-as-errors"]),
    ("lint a broken document", ["lint", "broken.deon"]),
    ("lint a missing file", ["lint", "nowhere.deon"]),

    # A `.deon` file is data, and data must not be able to write wherever it likes.
    ("exfile", ["exfile", "archive.deon"]),
    ("exfile an absolute path", ["exfile", "absolute.deon"]),
    ("exfile an escaping path", ["exfile", "escaping.deon"]),

    ("version", ["-v"]),
    ("help", ["-h"]),
    ("no arguments at all", []),
]


def documents() -> pathlib.Path:
    directory = pathlib.Path(tempfile.mkdtemp(prefix="deon-cli-"))

    for name, content in DOCUMENTS.items():
        (directory / name).write_text(content, "utf-8")

    return directory


def anonymize(text: str, directory: pathlib.Path) -> str:
    """The temporary directory, out of the output.

    Each implementation gets its own, and every run gets a new one, so the path is the one thing in
    the output that is *supposed* to differ.
    """
    for spelling in (str(directory.resolve()), str(directory)):
        text = text.replace(spelling, ".")

    return text


def diagnostics(text: str, directory: pathlib.Path):
    """The normative half of each diagnostic, and the prose held separately."""
    normative = []
    prose = []

    for line in anonymize(text, directory).strip().splitlines():
        found = DIAGNOSTIC.match(line)

        if not found:
            # A `deon: …` sentence about the command line rather than about a document. It has no
            # position, because there is no document for it to have one in — the only normative thing
            # about it is that the tool refused.
            normative.append(("refused",))
            prose.append(line)

            continue

        normative.append(
            (
                found["path"],
                found["line"],
                found["column"],
                found["severity"],
                found["code"],
            )
        )
        prose.append(found["message"])

    return normative, prose


def written(directory: pathlib.Path) -> dict[str, str]:
    """What the run left behind, and what is in it."""
    found = {}

    for path in sorted(directory.rglob("*")):
        if path.is_dir() or path.name in DOCUMENTS:
            continue

        found[str(path.relative_to(directory))] = path.read_text("utf-8")

    return found


def run(command: list[str], arguments: list[str], environment):
    directory = documents()

    finished = subprocess.run(
        command + arguments,
        cwd=directory,
        env=environment,
        capture_output=True,
        text=True,
    )

    codes, prose = diagnostics(finished.stderr, directory)

    behaviour = (
        finished.returncode,
        anonymize(finished.stdout, directory),
        codes,
        written(directory),
    )

    shutil.rmtree(directory)

    return behaviour, prose


def main() -> int:
    verbose = "-v" in sys.argv or "--verbose" in sys.argv

    for directory, command in BUILDS:
        print(f"  building {directory.name} ...", file=sys.stderr)

        built = subprocess.run(command, cwd=directory, capture_output=True, text=True)

        if built.returncode != 0:
            print(built.stdout + built.stderr, file=sys.stderr)

            return 2

    print(file=sys.stderr)

    disagreements = 0
    worded = 0

    for title, arguments in CASES:
        results = {
            name: run(command, arguments, environment)
            for name, command, environment in IMPLEMENTATIONS
        }

        if len({repr(behaviour) for behaviour, _ in results.values()}) > 1:
            disagreements += 1

            print(f"DIFFER    {title}")

            for name, (behaviour, _) in results.items():
                status, output, codes, left = behaviour

                print(f"    {name:11} exit={status} out={output!r} diagnostics={codes} wrote={left}")

            continue

        if len({repr(prose) for _, prose in results.values()}) > 1:
            worded += 1

            print(f"AGREE     {title}   (wording differs)")

            for name, (_, prose) in results.items():
                print(f"    {name:11} {prose}")

            continue

        if verbose:
            print(f"AGREE     {title}")

    print()

    if disagreements:
        print(f"{disagreements} of {len(CASES)} cases disagree.")

        return 1

    print(
        f"all {len(CASES)} cases: every tool behaved the same"
        + (f" ({worded} differ only in the wording of a message)." if worded else ".")
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
