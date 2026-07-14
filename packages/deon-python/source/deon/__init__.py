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
from dataclasses import dataclass
from typing import Optional

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

    return Interpreter(options, loader).run(document)


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

    options.source_name = path
    options.filebase = os.path.dirname(path)
    options.allow_filesystem = True

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
    "canonical",
    "canonical_source",
    "coerce",
    "entities",
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
