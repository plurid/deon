#!/usr/bin/env python3
"""Run every implementation against the same inputs, and require the same outputs.

Each implementation already runs `spec/conformance/cases.json` for itself, and passing it proves that
the implementation agrees with the fixtures. It does not prove that the implementations agree with
*each other* — and that is a different claim, which is the one that matters.

`deon-python` passed all 47 fixtures while indenting a map inside a map inside a map twice as far as
its siblings did, because no fixture nested that deeply. A suite written alongside an implementation
tests what its author thought to test. Only a second implementation tests what the first one assumed.

So this asks: given the same document, does everyone produce the same characters?

    python3 scripts/harness.py            # every implementation, every case and probe
    python3 scripts/harness.py -v         # and print each agreement, not only the failures
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent

CASES = ROOT / "spec" / "conformance" / "cases.json"
PROBES = ROOT / "spec" / "harness" / "probes.json"


IMPLEMENTATIONS = {
    "javascript": {
        "build": ["npm", "run", "build"],
        "directory": ROOT / "packages" / "deon-javascript",
        "run": ["node", "scripts/adapter.mjs"],
    },
    "rust": {
        "build": ["cargo", "build", "--quiet", "--bin", "deon-harness"],
        "directory": ROOT / "packages" / "deon-rust",
        "run": ["./target/debug/deon-harness"],
    },
    "python": {
        "build": None,
        "directory": ROOT / "packages" / "deon-python",
        "run": [sys.executable, "harness/adapter.py"],
        "environment": {"PYTHONPATH": "source"},
    },
    "go": {
        "build": ["go", "build", "-o", "harness/deon-harness", "./harness"],
        "directory": ROOT / "packages" / "deon-go",
        "run": ["./harness/deon-harness"],
    },
    "c": {
        "build": ["make", "harness"],
        "directory": ROOT / "packages" / "deon-c",
        "run": ["./build/harness"],
    },
    "java": {
        "build": ["make", "harness"],
        "directory": ROOT / "packages" / "deon-java",
        "run": ["java", "-cp", "build", "harness.Harness"],
    },
}


def requests_from_cases() -> list[dict]:
    """Every conformance case, asked as a question every implementation can answer.

    A case that expects a value is asked for its *canonical form* rather than its value, because
    canonical form is required to be identical across implementations character for character
    (specification 13), and it carries the value, the map order, and the chosen form of every string
    in one string. One comparison covers all of it — including the things `expected` cannot see, which
    is exactly where the implementations were found to disagree.
    """
    cases = json.loads(CASES.read_text("utf-8"))["cases"]

    asked: list[dict] = []

    for case in cases:
        base: dict = {"id": case["id"]}

        if "file" in case:
            base["source"] = case["files"][case["file"]]
            base["sourceName"] = case["file"]
            base["filebase"] = case["file"].rsplit("/", 1)[0]
            base["files"] = case["files"]
        else:
            base["source"] = case["source"]

        if case.get("environment") is not None:
            base["environment"] = case["environment"]

        given = case.get("options") or {}

        if "absolutePaths" in given:
            base["absolutePaths"] = given["absolutePaths"]

        for name in ("allowFilesystem", "allowNetwork"):
            if name in given:
                base[name] = "true" if given[name] else "false"

        if "sourceName" in given:
            base["sourceName"] = given["sourceName"]

        if "filebase" in given:
            base["filebase"] = given["filebase"]

        # `resource-io-unreadable` is the one case that touches a host filesystem, and it does so only
        # to observe the read fail. That is a fact about a machine, not about the language, so it is
        # not something three implementations are asked to agree on here.
        if case["id"] == "resource-io-unreadable":
            continue

        # A datasign fixture (specification 14.1) is asked as a `datasign` request, not a canonical
        # one: the artifact three implementations must agree on is the *typed* result the contract
        # produces, and canonicalising the raw source would ignore the contract entirely.
        if case.get("datasign") is not None:
            asked.append(
                {
                    **base,
                    "op": "datasign",
                    "files": case.get("files") or base.get("files") or {},
                    "datasignFiles": case["datasign"]["files"],
                    "datasignMap": case["datasign"]["map"],
                }
            )
            continue

        asked.append({**base, "op": "canonical"})

        if case.get("stringify") is not None:
            asked.append(
                {
                    **base,
                    "id": case["id"] + "#stringify",
                    "op": "stringify",
                    "stringifyOptions": {
                        key: ("true" if value is True else "false" if value is False else str(value))
                        for key, value in (case["stringify"].get("options") or {}).items()
                    },
                }
            )

        if case.get("typed") is not None:
            asked.append({**base, "id": case["id"] + "#typed", "op": "typed"})

        if case.get("lint") is not None:
            asked.append({**base, "id": case["id"] + "#lint", "op": "lint"})

    return asked


def requests_from_probes() -> list[dict]:
    """The differential corpus: documents no fixture pins, asked of everyone."""
    if not PROBES.exists():
        return []

    probes = json.loads(PROBES.read_text("utf-8"))

    asked: list[dict] = []

    for probe in probes:
        for operation in probe.get("ops", ["canonical"]):
            asked.append(
                {
                    "id": f"{probe['id']}#{operation}",
                    "op": operation,
                    "source": probe["source"],
                    **{k: v for k, v in probe.items() if k not in ("id", "source", "ops")},
                }
            )

    return asked


def drive(name: str, requests: list[dict]) -> dict[str, dict]:
    implementation = IMPLEMENTATIONS[name]
    directory = implementation["directory"]

    if implementation["build"]:
        subprocess.run(
            implementation["build"],
            cwd=directory,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    environment = None

    if implementation.get("environment"):
        import os

        environment = {**os.environ, **implementation["environment"]}

    payload = "\n".join(json.dumps(request) for request in requests) + "\n"

    finished = subprocess.run(
        implementation["run"],
        cwd=directory,
        input=payload,
        capture_output=True,
        text=True,
        env=environment,
    )

    if finished.returncode != 0:
        raise SystemExit(
            f"the {name} adapter exited {finished.returncode}\n{finished.stderr[:2000]}"
        )

    answers: dict[str, dict] = {}

    for line in finished.stdout.splitlines():
        if not line.strip():
            continue

        answer = json.loads(line)
        answers[answer["id"]] = answer

    return answers


#: Operations whose result is JSON *text*. Three implementations are not required to have chosen the
#: same whitespace, so these are compared as parsed structures rather than as characters — while
#: `canonical` and `stringify`, whose whole point is the characters, are compared as characters.
STRUCTURED = {"typed", "lint", "entities", "datasign"}


def flatten(node: object) -> object:
    """A parsed result, with the host's number types taken out of it.

    An adapter written against a JSON reader that yields strings reports a column as `"3"`; one
    written against a reader that yields numbers reports it as `3`. That is a fact about the reader
    and not about the language, so it is normalised away — but a *boolean* is not, because the
    conservative typer's whole job is to tell `true` from the string `"true"`, and flattening those
    together would throw away the one thing the `typed` operation exists to check.
    """
    if isinstance(node, bool):
        return node

    if isinstance(node, (int, float)):
        return float(node)

    if isinstance(node, str):
        return node

    if isinstance(node, list):
        return [flatten(item) for item in node]

    if isinstance(node, dict):
        return {key: flatten(item) for key, item in node.items()}

    return node


def comparable(request: dict, answer: dict) -> object:
    """What the implementations must agree on, with nothing else in it.

    A failure is compared by its code and its position, and *not* by its message: a message is written
    for a person, and three implementations are not required to have written the same sentence. The
    code and the position are the contract (specification 15).
    """
    if answer.get("ok") != "true":
        return ("error", answer.get("code"), str(answer.get("line")), str(answer.get("column")))

    result = answer["result"]

    if request["op"] in STRUCTURED:
        return ("value", flatten(json.loads(result)))

    return ("value", result)


def main() -> int:
    verbose = "-v" in sys.argv

    requests = requests_from_cases() + requests_from_probes()

    print(f"driving {len(requests)} requests through {len(IMPLEMENTATIONS)} implementations\n")

    results = {}

    for name in IMPLEMENTATIONS:
        print(f"  running {name} ...", flush=True)
        results[name] = drive(name, requests)

    names = list(IMPLEMENTATIONS)
    disagreements = []

    for request in requests:
        identifier = request["id"]

        answers = {name: results[name].get(identifier) for name in names}

        missing = [name for name, answer in answers.items() if answer is None]

        if missing:
            disagreements.append((identifier, {name: "<no answer>" for name in missing}))
            continue

        views = {name: comparable(request, answer) for name, answer in answers.items()}
        distinct = {repr(view) for view in views.values()}

        if len(distinct) > 1:
            disagreements.append((identifier, views))
        elif verbose:
            print(f"    agree  {identifier}")

    print()

    if not disagreements:
        print(f"all {len(requests)} requests: every implementation produced the same answer.")
        return 0

    print(f"{len(disagreements)} of {len(requests)} requests DISAGREE:\n")

    for identifier, views in disagreements:
        print(f"  {identifier}")

        for name, view in views.items():
            print(f"      {name:11} {view!r}")

        print()

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
