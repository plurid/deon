#!/usr/bin/env python3
"""Every command-line tool, the same loopback HTTP responses, the same behaviour.

The differential harness and `cli-harness.py` hand the implementations in-memory or on-disk resources;
neither opens a socket. But the network client is real code — it decodes a response body, and a body
that is not valid UTF-8 is a resource-format fault, exactly as a file that is not is. Whether the seven
agree there is not otherwise checked: every conformance fixture that names the network is a denial, and
each implementation's own `make network` test drives its client in isolation, never against the others.

So this binds an HTTP server to 127.0.0.1 — never a routable address, per specification 15 — serves a
set of vectors, and drives every CLI's `import ... from http://127.0.0.1:<port>/...` against them,
requiring the same exit status and the same diagnostic — code and position — from all seven.

    python3 scripts/cli-network-harness.py
    python3 scripts/cli-network-harness.py -v   # print each agreement, not only the failures
"""

from __future__ import annotations

import http.server
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading


ROOT = pathlib.Path(__file__).resolve().parent.parent

RUST = [str(ROOT / "packages/deon-rust/target/debug/deon")]
JAVASCRIPT = ["node", str(ROOT / "packages/deon-javascript/binder/deon")]
PYTHON = [sys.executable, "-m", "deon.cli"]
GO = [str(ROOT / "packages/deon-go/deon")]
C = [str(ROOT / "packages/deon-c/build/deon")]
JAVA = ["java", "-cp", str(ROOT / "packages/deon-java/build"), "cli.Cli"]
SWIFT = [str(ROOT / "packages/deon-swift/build/deon")]

#: Python runs from the source tree, so that nothing has to be installed first.
PYTHON_ENVIRONMENT = dict(os.environ, PYTHONPATH=str(ROOT / "packages/deon-python/source"))

IMPLEMENTATIONS = (
    ("rust", RUST, None),
    ("javascript", JAVASCRIPT, None),
    ("python", PYTHON, PYTHON_ENVIRONMENT),
    ("go", GO, None),
    ("c", C, None),
    ("java", JAVA, None),
    ("swift", SWIFT, None),
)

BUILDS = (
    (ROOT / "packages/deon-rust", ["cargo", "build", "--quiet", "--features", "cli"]),
    (ROOT / "packages/deon-javascript", ["npm", "run", "build"]),
    (ROOT / "packages/deon-go", ["go", "build", "-o", "deon", "./cmd/deon"]),
    (ROOT / "packages/deon-c", ["make", "deon"]),
    (ROOT / "packages/deon-java", ["make", "deon"]),
    (ROOT / "packages/deon-swift", ["make", "deon"]),
)

#: `<path>:<line>:<column> <severity> <CODE> <message>` — everything but the message is normative.
DIAGNOSTIC = re.compile(
    r"^(?P<path>.*?):(?P<line>\d+):(?P<column>\d+) (?P<severity>\w+) (?P<code>DEON_\w+) (?P<message>.*)$"
)


#: The loopback vectors. Each serves one HTTP response and states the one normative diagnostic every
#: implementation must produce when a document imports it — code, line, and column (the message is
#: prose and may differ). A resource read over the network is reported at the importing statement,
#: which is on line 1 of the generated document (specification 11.2), so the position is 1:1.
VECTORS = (
    {
        "name": "a response body that is not valid UTF-8",
        "path": "/not-utf8.deon",
        "status": 200,
        "content_type": "application/deon",
        # A lone 0xFF: invalid UTF-8 at any position, inside an otherwise-valid map.
        "body": b"{ a \xff }\n",
        "diagnostic": ("DEON_RESOURCE_FORMAT", "1", "1"),
    },
)

ROUTES = {vector["path"]: vector for vector in VECTORS}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *arguments):
        pass

    def do_GET(self):
        vector = ROUTES.get(self.path)
        if vector is None:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.send_header("Connection", "close")
            self.end_headers()
            return
        body = vector["body"]
        self.send_response(vector["status"])
        self.send_header("Content-Type", vector["content_type"])
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)


def build() -> None:
    for directory, command in BUILDS:
        print(f"  building {directory.name} ...", flush=True)
        subprocess.run(command, cwd=directory, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def normative(text: str) -> list[tuple[str, str, str]]:
    """The (code, line, column) of each diagnostic — the normative part, the prose dropped."""
    found = []
    for line in text.strip().splitlines():
        match = DIAGNOSTIC.match(line)
        if match:
            found.append((match["code"], match["line"], match["column"]))
    return found


def run(command: list[str], environment, source: str) -> tuple[int, list[tuple[str, str, str]]]:
    directory = pathlib.Path(tempfile.mkdtemp(prefix="deon-net-"))
    (directory / "main.deon").write_text(source, "utf-8")
    finished = subprocess.run(
        command + ["main.deon", "-n", "true"],
        cwd=directory,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return finished.returncode, normative(finished.stdout + finished.stderr)


def main() -> int:
    verbose = "-v" in sys.argv

    print("building the seven tools ...", flush=True)
    build()

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    disagreements = 0

    for vector in VECTORS:
        source = f"import remote from http://127.0.0.1:{port}{vector['path']}\n{{ #remote }}\n"
        expected_code, expected_line, expected_column = vector["diagnostic"]
        expected = [(expected_code, expected_line, expected_column)]

        behaviours = {}
        for name, command, environment in IMPLEMENTATIONS:
            code, diagnostics = run(command, environment, source)
            behaviours[name] = (code, diagnostics)

        agree = all(
            diagnostics == expected and code != 0
            for code, diagnostics in behaviours.values()
        )

        if agree:
            print(f"AGREE     {vector['name']}   → {expected_code} at {expected_line}:{expected_column}")
            if verbose:
                for name in behaviours:
                    print(f"    {name}")
        else:
            disagreements += 1
            print(f"DIFFER    {vector['name']}   (expected {expected_code} at {expected_line}:{expected_column})")
            for name, (code, diagnostics) in behaviours.items():
                print(f"    {name:11} exit={code} diagnostics={diagnostics}")

    server.shutdown()

    total = len(VECTORS)
    if disagreements == 0:
        print(f"\nall {total} network vector(s): every tool behaved the same.")
        return 0
    print(f"\n{disagreements} of {total} network vector(s) disagree.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
