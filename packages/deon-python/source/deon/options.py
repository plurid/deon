"""What a document is allowed to reach, and what it is given.

Nothing is granted by default (specification 9). Calling a parser on a piece of text grants it
neither the filesystem nor the network; each is a decision somebody has to make out loud. This is
what lets a host evaluate a document it did not write.
"""

from __future__ import annotations

from dataclasses import dataclass, field


DEFAULT_SOURCE_NAME = "<memory>"

#: The default expansion budget (specification 11): the number of Unicode code points that
#: substitution may produce before evaluation is stopped. 2^26 is far above anything a document a
#: person wrote assembles, and far below what a billion-laughs blow-up would — a tiny document doubling
#: an interpolation twenty times reaches gigabytes, and bounding the count is what stops it.
DEFAULT_EXPANSION = 2 ** 26


@dataclass
class ParseOptions:
    #: The name the document is known by, and what a diagnostic points at.
    source_name: str = DEFAULT_SOURCE_NAME

    #: What a relative target inside this document resolves against.
    filebase: str = ""

    #: Resources handed to the evaluator directly, keyed by target. Consulted before any loader, so a
    #: document that imports can be evaluated while reaching nothing at all — which is how the
    #: conformance suite runs, and how an editor reads a document it has open but has not saved.
    resources: dict[str, str] = field(default_factory=dict)

    #: Logical absolute targets, mapped to host paths. Exact keys win; among `/prefix/*` wildcards
    #: the longest wins. The mapping is a property of the *target* rather than of whoever resolves
    #: it, so a resource handed over directly maps exactly as one read from a disk would.
    absolute_paths: dict[str, str] = field(default_factory=dict)

    #: The evaluation environment read by `#$NAME`.
    #:
    #: It defaults to empty and it is never filled in from `os.environ`. A library that read the
    #: ambient environment would make a document mean one thing on one machine and another thing on
    #: the next, and would make the conformance suite pass or fail depending on what the developer
    #: running it happened to have exported. The CLI reads `os.environ` and passes it in; the library
    #: does not go looking.
    environment: dict[str, str] = field(default_factory=dict)

    allow_filesystem: bool = False
    allow_network: bool = False

    #: The most Unicode code points substitution — an interpolation `#{…}`, or a string spread — may
    #: produce before evaluation is stopped with `DEON_LIMIT_EXCEEDED` (specification 11). A tiny
    #: document can otherwise assemble gigabytes by interpolation doubling, which is a denial of
    #: service the host has no other way to refuse. Absent or 0 means `DEFAULT_EXPANSION`; a host that
    #: wants a tighter bound names a smaller number.
    expansion: int = 0

    #: A bearer token per exact lowercase hostname. Exact: no port, no path, no wildcard. A
    #: credential is not something to hand out on a prefix match.
    authorization: dict[str, str] = field(default_factory=dict)

    #: The credential `parse_link` fetches with. It is not what an *importer* sends — that comes from
    #: the declaration's `with`, or from `authorization` — and it is the importer's resolved credential,
    #: not this one, that a cache entry is separated by (specification 9).
    token: str = ""

    cache: bool = False
    cache_duration: int = 3_600_000
    cache_directory: str = ""

    #: The `.datasign` contracts that type the parsed data, and the root keys each type applies to
    #: (specification 14.1). Both are needed: an empty map is the identity, and reading a contract
    #: without one to apply would be reading a file for nothing.
    datasign_files: list[str] = field(default_factory=list)
    datasign_map: dict[str, str] = field(default_factory=dict)



@dataclass
class StringifyOptions:
    #: The canonical form is the one two implementations must agree on, character for character
    #: (specification 13). It is not a style; it is an identity.
    canonical: bool = False

    readable: bool = True
    indentation: int = 4

    leaflinks: bool = False
    leaflink_level: int = 1
    leaflink_shortening: bool = True

    generated_header: bool = False
    generated_comments: bool = False
