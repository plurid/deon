"""Deon — the DeObject Notation Format.

A value is exactly a string, an ordered list, or an ordered map. There is no null, no boolean, and no
number, and that is the whole of the data model (specification 2).

    import deon

    deon.parse("{ a one }")                      # {'a': 'one'} — and nothing was reached
    deon.parse_file("configuration.deon")        # the filesystem, because a file was named

Nothing is granted that was not asked for. `parse` on a piece of text grants neither the filesystem
nor the network, so a document that imports is told it may not — which is a diagnostic, with a code
and a position, rather than a surprise.

Everything here is synchronous. The `JavaScript` implementation has an asynchronous parser because its
host forced one on it; Python's file and network reads block, so a caller who wants this off the event
loop already has the way to say so:

    value = await asyncio.to_thread(deon.parse_file, "configuration.deon")
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Optional

from .datasign import Field, apply_datasign, parse_datasign, read_datasign, type_datasign
from .diagnostic import Diagnostic, DiagnosticCode, DeonError, Span
from .interpreter import Interpreter, interpolations, parameters
from .options import DEFAULT_SOURCE_NAME, ParseOptions, StringifyOptions
from .network import parse_link
from .parser import MAX_DEPTH, lint, parse_syntax
from .resources import DenyAll, Fetched, InMemory, ResourceLoader, host_loader
from .stringifier import canonical, stringify
from .syntax import (
    Call,
    Document,
    Leaflink,
    Link,
    ListNode,
    MapNode,
    Resource,
    Scalar,
    Structure,
)
from .typer import typed
from .value import DeonMap, Value, coerce


__version__ = "0.0.0-11"

DEON_FILENAME_EXTENSION = ".deon"
DEON_MEDIA_TYPE = "application/deon"


# #region parsing
def parse_with_loader(source: str, options: ParseOptions, loader) -> Value:
    """A document, against a resolver the caller brought.

    The seam an editor reaches through to read a document that has not been saved, and a build system
    to read one that lives in a tree only it can see.
    """
    document = parse_syntax(source, options.source_name)

    root = Interpreter(options, loader).run(document)

    return sign(root, options)


def sign(root: Value, options: ParseOptions) -> Value:
    """The evaluated root, typed against whatever contracts the caller declared (specification 14.1).

    Post-parse, and nothing happens without a `datasign_map`: an empty map is the identity, and there
    is no reason to read a contract nobody is going to apply.
    """
    if not options.datasign_map:
        return root

    sources = [read_datasign_source(file, options) for file in options.datasign_files]

    return apply_datasign(root, read_datasign(sources), options.datasign_map)


def read_datasign_source(file: str, options: ParseOptions) -> str:
    """A contract, from wherever the caller put it.

    Reading one is filesystem access like any other, and subject to §9: a raw string handed to `parse`
    grants nothing, so a contract it names may not be read from a disk. A contract supplied in
    `resources` needs no grant, because nothing is being reached.
    """
    target = file if os.path.isabs(file) else os.path.join(options.filebase or os.getcwd(), file)

    for key in (target, file):
        if key in options.resources:
            return options.resources[key]

    if not options.allow_filesystem:
        raise DeonError(
            DiagnosticCode.CAPABILITY_DENIED,
            f"Reading the datasign file '{file}' requires filesystem access.",
            Span.head(file),
        )

    try:
        with open(target, "r", encoding="utf-8") as handle:
            return handle.read()
    except (OSError, UnicodeDecodeError):
        raise DeonError(
            DiagnosticCode.RESOURCE_IO,
            f"Unable to read the datasign file '{file}'.",
            Span.head(file),
        ) from None


def parse_with(source: str, options: Optional[ParseOptions] = None) -> Value:
    options = options or ParseOptions()

    return parse_with_loader(source, options, host_loader())


def parse(source: str, options: Optional[ParseOptions] = None) -> Value:
    """A document, granted nothing.

    A document that imports is denied, because nothing said it might. That is the default, and it is
    the safe way to be wrong.
    """
    return parse_with(source, options or ParseOptions())


def read_file(path: str) -> str:
    """A document, as text.

    A document that cannot be read is a *diagnostic*, and not the host's `OSError`. The file was
    named, so it was permitted, and it failed to load — which is exactly `DEON_RESOURCE_IO`. A caller
    should never have to catch an operating-system exception to learn that a document was missing: it
    would carry no code and no position, and nothing an editor could show.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except (OSError, UnicodeDecodeError) as failure:
        raise DeonError(
            DiagnosticCode.RESOURCE_IO,
            f"Unable to read '{path}': {failure}.",
            Span.head(path),
        ) from None


def parse_file(path: str, options: Optional[ParseOptions] = None) -> Value:
    """A file, which grants the filesystem to it and to what it imports.

    Naming a file *is* the grant: a caller who says "read this from my disk" has said the disk may be
    read. The network is a separate sentence, and it has not been said.
    """
    options = options or ParseOptions()

    # A copy, never the caller's own. Naming a file grants the filesystem to *this* parse; a caller who
    # reuses one options object for a later `parse` they meant to sandbox must not silently inherit that
    # grant (specification 9). `replace` leaves the passed-in object untouched.
    options = replace(
        options,
        source_name=path,
        filebase=os.path.dirname(path),
        allow_filesystem=True,
    )

    return parse_with(read_file(path), options)
# #endregion parsing


# #region reading a document without running it
@dataclass(frozen=True)
class Entity:
    name: str
    parameters: list[str]
    kind: str


def entities(source: str, source_name: str = DEFAULT_SOURCE_NAME) -> list[Entity]:
    """What a document declares, and what each of them would demand.

    Syntactic: it parses and does not evaluate, so it reaches nothing and needs no capability. The
    parameters are not declared anywhere — they are the interpolation names an entity carries, which
    is a rule of the language (specification 10) rather than a convention invented here.
    """
    document = parse_syntax(source, source_name)

    found: list[Entity] = []

    for declaration in document.declarations:
        if isinstance(declaration, Resource):
            found.append(Entity(name=declaration.name, parameters=[], kind="resource"))
            continue

        node = declaration.value

        kind = {
            MapNode: "map",
            ListNode: "list",
            Structure: "structure",
            Link: "link",
            Call: "call",
        }.get(type(node), "scalar")

        found.append(
            Entity(
                name=declaration.name,
                parameters=sorted(parameters(node)),
                kind=kind,
            )
        )

    return found


def canonical_source(source: str, options: Optional[ParseOptions] = None) -> str:
    return canonical(parse_with(source, options or ParseOptions()))
# #endregion reading a document without running it


__all__ = [
    "DEON_FILENAME_EXTENSION",
    "DEON_MEDIA_TYPE",
    "DeonError",
    "DeonMap",
    "Diagnostic",
    "DiagnosticCode",
    "Document",
    "Entity",
    "Fetched",
    "MAX_DEPTH",
    "ParseOptions",
    "ResourceLoader",
    "Span",
    "StringifyOptions",
    "Value",
    "apply_datasign",
    "canonical",
    "canonical_source",
    "coerce",
    "entities",
    "parse_datasign",
    "read_datasign",
    "type_datasign",
    "lint",
    "parse",
    "parse_file",
    "parse_link",
    "parse_syntax",
    "parse_with",
    "parse_with_loader",
    "read_file",
    "stringify",
    "typed",
]
