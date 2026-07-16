#!/usr/bin/env python3
"""Generative differential fuzzer for Deon.

A hand-written corpus tests what its author thought to test. A *generator* tests what nobody thought
of: it builds thousands of structurally-varied documents from the grammar and requires all seven
implementations to answer each one identically — the same canonical characters for a document that
resolves, and the same diagnostic code, severity, and position for one that does not. A single
disagreement is a bug in at least one implementation, and the fuzzer hands back the smallest document
that still triggers it.

    python3 scripts/fuzz.py                      # 500 cases, seed 0, shrink every divergence
    python3 scripts/fuzz.py --count 5000         # a longer hunt
    python3 scripts/fuzz.py --seed 7 --count 2000
    python3 scripts/fuzz.py --case 123           # regenerate and inspect one case exactly
    python3 scripts/fuzz.py --only rust,go       # a fast two-implementation pass
    python3 scripts/fuzz.py --ops canonical,typed,lint
    python3 scripts/fuzz.py --save-corpus spec/harness/probes.json   # promote divergences to probes

Every case is generated from `Random(f"{seed}:{index}")`, so `--seed S --case I` reproduces case I of
run S exactly, on any machine, forever. Reproducibility is the whole point: a fuzzer that cannot
replay its own failure is a fuzzer that finds bugs nobody can fix.

The generator, the driver, and the comparison are separate on purpose. The generator knows Deon's
grammar and nothing about the implementations; the driver knows how to run seven programs and nothing
about the grammar; `harness.comparable` — reused verbatim — knows what the contract says they must
agree on and nothing about either. A divergence the fuzzer reports is therefore a divergence the real
conformance harness would report, because it *is* the real conformance harness's judgement.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from harness import IMPLEMENTATIONS, comparable  # noqa: E402


# ---------------------------------------------------------------------------
# The generator.
#
# Every `gen_*` takes the random source `r` first and returns a fragment of Deon text. A `Scope` is
# the list of reference names a fragment may point at; a generator that introduces a name appends it,
# so a reference is usually resolvable and occasionally — deliberately — is not. Nothing here reaches
# for a global: a fragment is a pure function of the `Random` it is handed, which is what makes
# `--case I` able to reproduce case I and nothing else.
# ---------------------------------------------------------------------------

# Names are drawn from a small pool so that references collide, keys repeat, and shadowing happens —
# the interesting cases live where two things share a name, not where every name is unique.
NAMES = ["a", "b", "c", "x", "y", "z", "k", "n", "m", "id", "name", "val", "item", "r", "s", "t"]

# Bare words that a string-only model must keep as strings. `true`, `null`, and `42` are the whole
# argument for Deon: canonical form must round-trip them untouched, and the typer must call them
# strings, so any implementation that treats one as a keyword or a number diverges here first.
WORDS = [
    "hello", "world", "foo", "bar", "value", "item", "true", "false", "null",
    "yes", "no", "on", "off", "None", "nil", "undefined", "NaN", "Infinity", "a1", "x2y",
]

# Number-shaped strings, which are still strings. The conservative typer draws its line somewhere in
# this list, and the line is exactly where implementations were found to disagree.
NUMBERS = [
    "0", "-0", "+5", "42", "-1", "3.14", ".5", "5.", "1_000", "0x10", "0o17", "0b101",
    "1e10", "1E10", "007", "0.0", "1.0", "-3.5", "99999999999999999999", "3.14.15", "1.2e3",
]

# Text that exercises the encoder's escaping and normalization decisions: a non-BMP character (two
# UTF-16 units, four UTF-8 bytes), a combining mark, a zero-width joiner, a titlecase codepoint.
UNICODE = ["é", "ü", "中", "文", "😀", "🎉", "é", "à", "‍", "ǅ", "ﬁ", "Ⅻ", "①", " "]

# Escape sequences: the known ones the encoder must preserve or fold, and the unknown `\q`, which the
# grammar's `unquoted-first` forbids but several implementations accept — a real, filed divergence.
ESCAPES = ["\\n", "\\t", "\\\\", "\\r", "\\q", "\\z", "\\u0041", "\\x41", "\\0"]


def pick_name(r: random.Random) -> str:
    return r.choice(NAMES)


def pick_reference(r: random.Random, scope: list[str]) -> str:
    """A name to point at: usually one in scope, sometimes one that was never declared."""
    if scope and r.random() < 0.8:
        return r.choice(scope)
    return pick_name(r)


def gen_access(r: random.Random, scope: list[str]) -> str:
    """An access chain onto a reference: `.key`, `[0]`, `['key']`, chained a few deep."""
    chain = ""
    for _ in range(r.randint(0, 3)):
        kind = r.random()
        if kind < 0.4:
            chain += "." + pick_name(r)
        elif kind < 0.7:
            chain += "[" + r.choice(["0", "1", "2", "-1", "00", "0x1", "1.0", "99", " 1 ", "1 ", ""]) + "]"
        elif kind < 0.9:
            chain += "['" + pick_name(r) + "']"
        else:
            chain += "." + r.choice(NUMBERS[:6])
    return chain


def gen_interpolation(r: random.Random, scope: list[str]) -> str:
    """`#{ ref }` — with the reference expression, and the surrounding spaces, both fuzzed."""
    if r.random() < 0.06:
        return "#{}"  # the empty interpolation, which is either an error or the text `#{}`
    if r.random() < 0.08:
        return "#$" + r.choice(["HOME", "PATH", "NOPE", "X", "EMPTY"])  # an environment reference
    inner = pick_reference(r, scope) + gen_access(r, scope)
    pad_l = " " * r.randint(0, 2)
    pad_r = " " * r.randint(0, 2)
    return "#{" + pad_l + inner + pad_r + "}"


def gen_scalar(r: random.Random, scope: list[str]) -> str:
    """A single string value in one of its written forms."""
    kind = r.random()
    if kind < 0.30:
        return r.choice(WORDS)
    if kind < 0.50:
        return r.choice(NUMBERS)
    if kind < 0.62:
        return r.choice(UNICODE)
    if kind < 0.78:
        return gen_single_quoted(r, scope)
    if kind < 0.92:
        return gen_backtick(r, scope)
    # A bare word carrying an escape or an interpolation.
    body = r.choice(WORDS)
    if r.random() < 0.5:
        body += r.choice(ESCAPES)
    else:
        body += gen_interpolation(r, scope)
    return body


def gen_single_quoted(r: random.Random, scope: list[str]) -> str:
    parts = []
    for _ in range(r.randint(0, 4)):
        p = r.random()
        if p < 0.4:
            parts.append(r.choice(WORDS))
        elif p < 0.55:
            parts.append(" ")
        elif p < 0.7:
            parts.append(r.choice(ESCAPES))
        elif p < 0.85:
            parts.append("\\'")
        elif p < 0.95:
            parts.append(gen_interpolation(r, scope))
        else:
            parts.append(r.choice(UNICODE))
    return "'" + "".join(parts) + "'"


def gen_backtick(r: random.Random, scope: list[str]) -> str:
    parts = []
    for _ in range(r.randint(0, 4)):
        p = r.random()
        if p < 0.4:
            parts.append(gen_interpolation(r, scope))
        elif p < 0.6:
            parts.append(r.choice(WORDS))
        elif p < 0.75:
            parts.append(" ")
        elif p < 0.9:
            parts.append(r.choice(ESCAPES))
        else:
            parts.append(r.choice(UNICODE))
    return "`" + "".join(parts) + "`"


def gen_separator(r: random.Random) -> str:
    """Between items: a comma, a newline, both, or — the pathological ones — neither or doubled."""
    return r.choice([", ", ",\n", "\n", " ,\n", ",", "  ", "\n\n", " , ", ",, ", ",\n,"])


def gen_list(r: random.Random, scope: list[str], depth: int) -> str:
    n = r.randint(0, 4)
    items = []
    for _ in range(n):
        if r.random() < 0.15 and scope:
            items.append("...#" + pick_reference(r, scope) + gen_access(r, scope))
        else:
            items.append(gen_value(r, scope, depth + 1))
    sep = gen_separator(r)
    body = sep.join(items)
    if items and r.random() < 0.15:
        body += r.choice([",", ", "])  # a trailing separator
    pad = r.choice(["", " ", "\n"])
    return "[" + pad + body + pad + "]"


def gen_map(r: random.Random, scope: list[str], depth: int) -> str:
    n = r.randint(0, 4)
    entries = []
    local = list(scope)
    for _ in range(n):
        kind = r.random()
        if kind < 0.10 and local:
            entries.append("...#" + pick_reference(r, local) + gen_access(r, local))
        elif kind < 0.22 and depth < 2:
            entries.append(gen_structure(r, local, depth))
        elif kind < 0.34:
            # A referenced link `#name value`: declares a reference the rest of the document can use.
            name = pick_name(r)
            entries.append("#" + name + " " + gen_value(r, local, depth + 1))
            local.append(name)
        else:
            # An ordinary leaflink `name value`.
            name = pick_name(r)
            entries.append(name + " " + gen_value(r, local, depth + 1))
            local.append(name)
    scope.extend(local[len(scope):])
    sep = gen_separator(r)
    body = sep.join(entries)
    if entries and r.random() < 0.15:
        body += r.choice([",", ", "])
    pad = r.choice([" ", "\n", ""])
    return "{" + pad + body + pad + "}"


def gen_structure(r: random.Random, scope: list[str], depth: int) -> str:
    """`name <f, f> [cells]` — a table that expands into a list of maps."""
    name = pick_name(r)
    fields = [pick_name(r) for _ in range(r.randint(0, 3))]
    width = max(len(fields), 1)
    rows = r.randint(0, 3)
    count = rows * width
    # Occasionally emit a cell count that is not a whole number of rows, to probe the arity error.
    if r.random() < 0.25:
        count += r.randint(1, width)
    cells = [gen_scalar(r, scope) for _ in range(count)]
    return name + " <" + ", ".join(fields) + "> [" + ", ".join(cells) + "]"


def gen_value(r: random.Random, scope: list[str], depth: int) -> str:
    """Any value: a scalar near the leaves, a container higher up."""
    if depth >= 4:
        return gen_scalar(r, scope)
    kind = r.random()
    if kind < 0.45:
        return gen_scalar(r, scope)
    if kind < 0.68:
        return gen_map(r, scope, depth)
    if kind < 0.88:
        return gen_list(r, scope, depth)
    # A bare reference, resolving to whatever it points at.
    return "#" + pick_reference(r, scope) + gen_access(r, scope)


# ---------------------------------------------------------------------------
# Document shapes. Each returns a request dict the harness driver understands.
# ---------------------------------------------------------------------------

def shape_plain(r: random.Random) -> dict:
    """Leading declarations, then a top-level container that may point back at them."""
    scope: list[str] = []
    lines = []
    for _ in range(r.randint(0, 3)):
        name = pick_name(r)
        lines.append(name + " " + gen_value(r, scope, 1))
        scope.append(name)
    top = gen_map(r, scope, 0) if r.random() < 0.6 else gen_list(r, scope, 0)
    lines.append(top)
    return {"source": "\n".join(lines)}


def shape_call(r: random.Random) -> dict:
    """A template declared with `#{param}` placeholders, then called with arguments."""
    scope: list[str] = []
    tname = pick_name(r)
    params = list(dict.fromkeys(pick_name(r) for _ in range(r.randint(1, 3))))
    template = "`" + "".join("#{" + p + "}-" for p in params) + "`"
    lines = [tname + " " + template]
    scope.append(tname)
    # Build a call whose arguments usually match the parameters, sometimes miss or duplicate one.
    args = list(params)
    if r.random() < 0.3:
        args = args[:-1] or args  # a missing argument
    if r.random() < 0.2 and args:
        args.append(args[0])  # a duplicate argument
    if r.random() < 0.2:
        args.append(pick_name(r))  # an unexpected argument
    call_args = ", ".join(a + " " + gen_scalar(r, scope) for a in args)
    lines.append("{ v #" + tname + "(" + call_args + ") }")
    return {"source": "\n".join(lines)}


def shape_import(r: random.Random) -> dict:
    """An in-memory resource tree with an import or an inject reaching across it."""
    scope: list[str] = []
    sub_is_json = r.random() < 0.3
    if sub_is_json:
        sub_name, sub_body = "/sub.json", json.dumps({pick_name(r): r.choice(WORDS)})
    else:
        sub_name, sub_body = "/sub.deon", gen_map(r, scope, 1)
    verb = r.choice(["import", "inject"])
    target = r.choice(["./sub", "./sub.deon", "./sub.json", "/sub.deon", "./missing", "./sub.txt"])
    if verb == "inject":
        target = r.choice(["./sub.deon", "./sub.json", "/sub.deon", "./missing"])
    main = verb + " child from " + target + "\n{ out #child }"
    files = {"/main.deon": main, sub_name: sub_body}
    return {
        "source": main,
        "sourceName": "/main.deon",
        "filebase": "",
        "files": files,
    }


def shape_environment(r: random.Random) -> dict:
    """A document that reads environment references, with the environment supplied per request."""
    env = {"HOME": r.choice(["/root", "x", ""]), "X": "1", "EMPTY": ""}
    body = "{ h #$HOME, x `#{$X}`, n #$" + r.choice(["NOPE", "HOME", "X"]) + " }"
    return {"source": body, "environment": env}


def mutate(r: random.Random, source: str) -> str:
    """Injects a little chaos into an otherwise-plausible document: the malformations a generator
    following the grammar would never reach on its own but a careless author reaches every day."""
    for _ in range(r.randint(1, 3)):
        if not source:
            break
        kind = r.random()
        i = r.randint(0, len(source) - 1)
        if kind < 0.2:
            source = source[:i] + r.choice([",", "{", "}", "[", "]", ";", "#"]) + source[i:]
        elif kind < 0.35:
            source = source[:i] + source[i + 1:]  # drop a character
        elif kind < 0.5:
            source = source[:i] + r.choice(["/* c */", "// c\n", "\t", "\r\n", " "]) + source[i:]
        elif kind < 0.65:
            source = source[:i]  # truncate
        elif kind < 0.8:
            source = source[:i] + source[i] + source[i:]  # duplicate a character
        else:
            source = source[:i] + r.choice(UNICODE) + source[i:]
    return source


SHAPES = [
    (shape_plain, 0.42),
    (shape_call, 0.12),
    (shape_import, 0.12),
    (shape_environment, 0.08),
]


def gen_case(r: random.Random, ops: list[str]) -> dict:
    """One request: a shape, a possible mutation, and the operation to ask it under."""
    roll = r.random()
    cumulative = 0.0
    request = None
    for shape, weight in SHAPES:
        cumulative += weight
        if roll < cumulative:
            request = shape(r)
            break
    if request is None:  # the remaining probability mass is "plain, then mutated"
        request = shape_plain(r)
        request["source"] = mutate(r, request["source"])
    elif r.random() < 0.25:
        request["source"] = mutate(r, request["source"])
    request["op"] = r.choice(ops)
    return request


def case_for(seed: int, index: int, ops: list[str]) -> dict:
    """Case `index` of run `seed`, reproducible anywhere from those two numbers alone."""
    request = gen_case(random.Random(f"{seed}:{index}"), ops)
    request["id"] = f"fuzz-{seed}-{index}"
    return request


# ---------------------------------------------------------------------------
# The driver. `harness.drive` rebuilds before every run, which is wasteful across many chunks and
# fatal on a crash — one adapter exiting non-zero would abort the whole hunt and take every other
# case's verdict with it. So the build happens once, the run happens in chunks, and a chunk that
# crashes an implementation is bisected down to the single case that did it, which is recorded as its
# own kind of divergence rather than ending the run.
# ---------------------------------------------------------------------------

CRASH = {"ok": "false", "code": "ADAPTER_CRASH", "severity": "crash", "start": "?", "line": "?", "column": "?"}


def build_once(name: str) -> None:
    impl = IMPLEMENTATIONS[name]
    if impl["build"]:
        subprocess.run(impl["build"], cwd=impl["directory"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run_adapter(name: str, requests: list[dict]) -> dict[str, dict] | None:
    """Run the already-built adapter over `requests`. Returns the answers, or None if it crashed."""
    import os

    impl = IMPLEMENTATIONS[name]
    environment = None
    if impl.get("environment"):
        environment = {**os.environ, **impl["environment"]}
    payload = "\n".join(json.dumps(request) for request in requests) + "\n"
    finished = subprocess.run(impl["run"], cwd=impl["directory"], input=payload,
                              capture_output=True, text=True, env=environment)
    if finished.returncode != 0:
        return None
    answers: dict[str, dict] = {}
    for line in finished.stdout.splitlines():
        if line.strip():
            answer = json.loads(line)
            answers[answer["id"]] = answer
    return answers


def drive_localizing(name: str, requests: list[dict], chunk: int) -> dict[str, dict]:
    """Every answer for `name`, with a crash blamed on the exact case that caused it."""
    answers: dict[str, dict] = {}
    for start in range(0, len(requests), chunk):
        batch = requests[start:start + chunk]
        got = run_adapter(name, batch)
        if got is not None:
            answers.update(got)
        else:
            answers.update(_bisect_crash(name, batch))
    return answers


def _bisect_crash(name: str, batch: list[dict]) -> dict[str, dict]:
    """A batch crashed the adapter. Narrow it to the single case, which is a finding, not a stop."""
    if len(batch) == 1:
        return {batch[0]["id"]: {"id": batch[0]["id"], **CRASH}}
    mid = len(batch) // 2
    left, right = batch[:mid], batch[mid:]
    out: dict[str, dict] = {}
    for half in (left, right):
        got = run_adapter(name, half)
        out.update(got if got is not None else _bisect_crash(name, half))
    return out


# ---------------------------------------------------------------------------
# Comparison and shrinking.
# ---------------------------------------------------------------------------

def canon(value: object) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def divergence(request: dict, answers: dict[str, dict]) -> dict[str, list[str]] | None:
    """The implementations grouped by the answer they gave, if they did not all give the same one."""
    groups: dict[str, list[str]] = {}
    for name, table in answers.items():
        answer = table.get(request["id"])
        key = canon(comparable(request, answer)) if answer is not None else canon(("MISSING",))
        groups.setdefault(key, []).append(name)
    return groups if len(groups) > 1 else None


def signature(request: dict, answers: dict[str, dict], names: list[str]) -> tuple:
    """A divergence's identity for shrinking: each implementation's verdict and — for a failure — its
    code, with positions and values dropped.

    Positions move and values change as text is deleted, so pinning them would make shrinking
    impossible; the code an implementation raises does not move with the text, so pinning it keeps the
    shrink on the bug that was found instead of drifting to a different disagreement between the same
    implementations. Two implementations reporting different codes is a different, stronger finding
    than the same two reporting one code at two positions, and collapsing the first into the second
    would misreport it.
    """
    sig = []
    for name in names:
        answer = answers[name].get(request["id"])
        if answer is None:
            sig.append((name, "missing", None))
        elif answer.get("ok") == "true":
            sig.append((name, "ok", None))
        else:
            sig.append((name, "err", answer.get("code")))
    return tuple(sig)


def shrink(request: dict, names: list[str], chunk: int) -> tuple[str, dict[str, list[str]]]:
    """The smallest source that still divides the implementations the same way, by repeated deletion.

    Delta-debugging: try ever-coarser-then-finer deletions, keep any that still diverges *with the
    same code signature*, and stop when a full pass at single-character granularity buys nothing.
    Returns the shrunk source and the groups recomputed on it, so the report never pairs one source
    with another's verdicts.
    """
    def answers_for(source: str) -> dict[str, dict]:
        probe = {**request, "source": source}
        return {n: drive_localizing(n, [probe], chunk) for n in names}

    def probe_of(source: str) -> dict:
        return {**request, "source": source}

    target = signature(request, answers_for(request["source"]), names)
    source = request["source"]
    granularity = max(len(source) // 2, 1)
    while granularity >= 1:
        i = 0
        shrunk = False
        while i < len(source):
            candidate = source[:i] + source[i + granularity:]
            if candidate and candidate != source:
                answers = answers_for(candidate)
                probe = probe_of(candidate)
                if divergence(probe, answers) is not None and signature(probe, answers, names) == target:
                    source = candidate
                    shrunk = True
                    continue
            i += granularity
        if not shrunk:
            if granularity == 1:
                break
            granularity = max(granularity // 2, 1)
    groups = divergence(probe_of(source), answers_for(source)) or {}
    return source, groups


# ---------------------------------------------------------------------------
# Reporting and the command line.
# ---------------------------------------------------------------------------

def show_case(seed: int, index: int, ops: list[str], names: list[str], chunk: int) -> int:
    """Regenerate one case and print its source and every implementation's answer, verbatim."""
    request = case_for(seed, index, ops)
    print(f"# case fuzz-{seed}-{index}  op={request['op']}")
    for key in ("sourceName", "filebase"):
        if key in request:
            print(f"# {key}: {request[key]!r}")
    if "files" in request:
        print(f"# files: {json.dumps(request['files'])}")
    if "environment" in request:
        print(f"# environment: {json.dumps(request['environment'])}")
    print("# --- source ---")
    print(request["source"])
    print("# --- answers ---")
    for name in names:
        answers = drive_localizing(name, [request], chunk)
        answer = answers.get(request["id"])
        print(f"  {name:11s} {canon(comparable(request, answer)) if answer else '(missing)'}")
    return 0


def classify(groups: dict[str, list[str]]) -> str:
    """Rank a divergence: implementations disagreeing on a resolved *value* is the gravest; on an
    error *code* next; on only the *position* of one agreed code, the least. The report leads with the
    gravest, because that is the one whose fix teaches the most."""
    verdicts = [json.loads(key) for key in groups]
    if any(v[0] == "value" for v in verdicts):
        return "value"
    codes = {v[1] for v in verdicts if v and v[0] == "error"}
    if len(codes) > 1:
        return "error-code"
    return "error-position"


RANK = {"value": 0, "error-code": 1, "error-position": 2}


def report(diverged: list[dict], names: list[str]) -> None:
    for finding in sorted(diverged, key=lambda f: RANK.get(f["kind"], 9)):
        request = finding["request"]
        groups = finding["groups"]
        source = finding["shrunk_source"] if finding["shrunk_source"] is not None else request["source"]
        print(f"\n{'=' * 78}")
        print(f"  [{finding['kind']}]  {request['id']}   op={request['op']}")
        print(f"  reproduce: python3 scripts/fuzz.py --seed {finding['seed']} --case {finding['index']}")
        print("  --- source ---")
        print("    " + source.replace("\n", "\n    "))
        for key, members in sorted(groups.items(), key=lambda kv: sorted(kv[1])):
            print(f"    {','.join(sorted(members)):32s} {key}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generative differential fuzzer for Deon.")
    parser.add_argument("--count", type=int, default=500, help="how many documents to generate")
    parser.add_argument("--seed", type=int, default=0, help="the base seed; run S, case I is Random('S:I')")
    parser.add_argument("--ops", default="canonical", help="comma-separated: canonical,typed,lint")
    parser.add_argument("--only", default="", help="comma-separated implementation subset")
    parser.add_argument("--chunk", type=int, default=50, help="cases per adapter launch")
    parser.add_argument("--case", type=int, default=None, help="regenerate and inspect a single case")
    parser.add_argument("--no-shrink", action="store_true", help="report raw divergences without shrinking")
    parser.add_argument("--save-corpus", default=None, help="append shrunk divergences to a probes file")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    ops = [op.strip() for op in args.ops.split(",") if op.strip()]
    names = [n.strip() for n in args.only.split(",") if n.strip()] or list(IMPLEMENTATIONS)
    for name in names:
        if name not in IMPLEMENTATIONS:
            print(f"unknown implementation: {name}", file=sys.stderr)
            return 2

    print(f"building {len(names)} implementations ...", flush=True)
    for name in names:
        build_once(name)

    if args.case is not None:
        return show_case(args.seed, args.case, ops, names, args.chunk)

    requests = [case_for(args.seed, i, ops) for i in range(args.count)]
    print(f"fuzzing {len(requests)} cases through {len(names)} implementations "
          f"(seed {args.seed}, ops {'+'.join(ops)})\n", flush=True)

    answers: dict[str, dict[str, dict]] = {}
    for name in names:
        print(f"  running {name} ...", flush=True)
        answers[name] = drive_localizing(name, requests, args.chunk)

    diverged = []
    for request in requests:
        groups = divergence(request, answers)
        if groups is None:
            if args.verbose:
                print(f"  ok  {request['id']}")
            continue
        finding = {
            "request": request,
            "seed": args.seed,
            "index": int(request["id"].rsplit("-", 1)[1]),
            "groups": groups,
            "kind": classify(groups),
            "shrunk_source": None,
        }
        if not args.no_shrink:
            print(f"  shrinking {request['id']} [{finding['kind']}] ...", flush=True)
            finding["shrunk_source"], shrunk_groups = shrink(request, names, args.chunk)
            if shrunk_groups:
                finding["groups"] = shrunk_groups
                finding["kind"] = classify(shrunk_groups)
        diverged.append(finding)

    print(f"\n{'#' * 78}")
    print(f"# {len(diverged)} of {len(requests)} cases DIVERGE across {len(names)} implementations")
    print(f"{'#' * 78}")
    if diverged:
        report(diverged, names)
        if args.save_corpus:
            _save_corpus(args.save_corpus, diverged)
    else:
        print("\nall implementations agreed on every generated document.")
    return 1 if diverged else 0


def _save_corpus(path: str, diverged: list[dict]) -> None:
    """Promote each shrunk divergence to a permanent probe, so a bug found once is tested forever."""
    target = pathlib.Path(path)
    existing = json.loads(target.read_text("utf-8")) if target.exists() else []
    seen = {probe.get("source") for probe in existing}
    added = 0
    for finding in diverged:
        request = finding["request"]
        source = finding.get("shrunk_source") or request["source"]
        if source in seen:
            continue
        probe = {"id": request["id"], "source": source, "ops": [request["op"]]}
        for key in ("sourceName", "filebase", "files", "environment"):
            if key in request:
                probe[key] = request[key]
        existing.append(probe)
        seen.add(source)
        added += 1
    target.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"\nwrote {added} new probe(s) to {path}")


if __name__ == "__main__":
    sys.exit(main())
