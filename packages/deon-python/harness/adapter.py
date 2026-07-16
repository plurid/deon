"""The cross-implementation harness adapter (`spec/harness/README.md`).

A filter: newline-delimited JSON in, newline-delimited JSON out. Nothing escapes it but a response —
a host exception crossing this boundary would be reported as a disagreement, and it would be one.
"""

from __future__ import annotations

import json
import sys

import deon
from deon import DeonError, ParseOptions, StringifyOptions


def flag(request: dict, name: str, fallback: bool = False) -> bool:
    return request.get(name, "true" if fallback else "false") == "true"


def options_of(request: dict) -> ParseOptions:
    options = ParseOptions()

    options.source_name = request.get("sourceName", "<memory>")
    options.filebase = request.get("filebase", "")
    options.resources = dict(request.get("files") or {})
    options.absolute_paths = dict(request.get("absolutePaths") or {})
    options.environment = dict(request.get("environment") or {})
    options.allow_filesystem = flag(request, "allowFilesystem")
    options.allow_network = flag(request, "allowNetwork")

    # A configurable resource budget arrives as a string count under `budgets` (specification 11).
    # Absent or 0 leaves the evaluator on its default expansion limit.
    budgets = request.get("budgets") or {}
    options.expansion = int(budgets.get("expansion") or 0)

    # The contracts of specification 14.1. They arrive through `files` like every other resource, so
    # no adapter reaches a disk.
    options.datasign_files = list(request.get("datasignFiles") or [])
    options.datasign_map = dict(request.get("datasignMap") or {})

    return options


def stringify_options_of(given: dict) -> StringifyOptions:
    return StringifyOptions(
        canonical=given.get("canonical") == "true",
        readable=given.get("readable", "true") == "true",
        indentation=int(given.get("indentation", "4")),
        leaflinks=given.get("leaflinks") == "true",
        leaflink_level=int(given.get("leaflinkLevel", "1")),
        leaflink_shortening=given.get("leaflinkShortening", "true") == "true",
        generated_header=given.get("generatedHeader") == "true",
        generated_comments=given.get("generatedComments") == "true",
    )


def run(request: dict) -> str:
    operation = request["op"]
    source = request["source"]
    options = options_of(request)

    if operation == "entities":
        found = deon.entities(source, options.source_name)

        return json.dumps(
            [
                {"name": e.name, "parameters": list(e.parameters), "kind": e.kind}
                for e in found
            ]
        )

    if operation == "lint":
        return json.dumps(
            [
                {"code": d.code, "line": str(d.line), "column": str(d.column)}
                for d in deon.lint(source, options.source_name)
            ]
        )

    value = deon.parse_with(source, options)

    if operation == "canonical":
        return deon.canonical(value)

    if operation == "stringify":
        return deon.stringify(value, stringify_options_of(request.get("stringifyOptions") or {}))

    if operation == "typed":
        return json.dumps(deon.typed(value))

    if operation == "datasign":
        # `parse_with` has already applied the contracts, as the reference implementation does.
        return json.dumps(value)

    raise ValueError(f"unknown operation '{operation}'")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()

        if not line:
            continue

        request = json.loads(line)

        try:
            answer = {"id": request["id"], "ok": "true", "result": run(request)}
        except DeonError as failure:
            span = failure.diagnostics[0].span

            answer = {
                "id": request["id"],
                "ok": "false",
                "code": failure.code,
                "severity": failure.diagnostics[0].severity,
                "start": str(span.start),
                "line": str(span.line),
                "column": str(span.column),
                "related": [
                    [str(s.start), str(s.line), str(s.column)] for s in failure.diagnostics[0].related
                ],
            }
        except Exception as failure:  # the host leaking through is a disagreement, and it says so
            answer = {
                "id": request["id"],
                "ok": "false",
                "code": f"HOST_{type(failure).__name__}",
                "line": "0",
                "column": "0",
            }

        sys.stdout.write(json.dumps(answer) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
