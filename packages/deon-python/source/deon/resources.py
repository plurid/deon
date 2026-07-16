"""Where a resource comes from, and whether it may be reached at all.

The capability model is the point (specification 9). A document is data, and a host that evaluates a
document it did not write must be able to say what that document may touch. Nothing is granted by
default: a target is refused *before* a request is made, not after one comes back, which is the whole
difference between a decision and an accident.

Two failures that must never be confused, because one is a policy and the other is the world:

- `DEON_CAPABILITY_DENIED` — this was never allowed.
- `DEON_RESOURCE_IO` — this was allowed, and it failed.
"""

from __future__ import annotations

import os
import posixpath
from dataclasses import dataclass
from typing import Optional, Protocol
from urllib.parse import urljoin, urlsplit

from .options import ParseOptions


IMPORT = "import"
INJECT = "inject"

DEON_EXTENSION = ".deon"
JSON_EXTENSION = ".json"

DEON_MEDIA_TYPE = "application/deon"


@dataclass(frozen=True)
class Fetched:
    #: The resource text.
    data: str

    #: The extension the content is read as. An injection has none: it retains its target exactly and
    #: is bound as text without being parsed at all.
    filetype: str

    #: What a relative target *inside* the loaded document resolves against.
    filebase: str

    #: The canonical identity of the resource. This is what the cycle check compares, so two spellings
    #: of one resource must arrive here as one string, or a cycle would go unseen.
    resource_id: str


def is_url(target: str) -> bool:
    scheme = urlsplit(target).scheme

    return scheme in ("http", "https")


def directory_of(target: str) -> str:
    if is_url(target):
        return urljoin(target, ".")

    return os.path.dirname(target)


def extension_of(target: str) -> str:
    if is_url(target):
        target = urlsplit(target).path

    return posixpath.splitext(target)[1]


def resolve_absolute_path(target: str, absolute_paths: dict[str, str]) -> str:
    """A logical absolute target, as a host path.

    Exact keys win before wildcards; among wildcards the longest prefix wins, and the part of the
    target it did not match is appended to the directory it mapped to (specification 9).

    This runs *above* the loader rather than inside one, and that is not an implementation detail —
    the specification says the mapping is a property of the target rather than of whoever resolves it,
    so a resource handed to the evaluator directly must map exactly as one read from a disk would. A
    document that meant one thing when its resources were supplied and another when they were read
    would not be a document at all.
    """
    if not absolute_paths:
        return target

    if target in absolute_paths:
        return absolute_paths[target]

    best: Optional[str] = None

    for key in absolute_paths:
        if not key.endswith("/*"):
            continue

        prefix = key[:-1]  # keep the trailing slash

        if target.startswith(prefix) and (best is None or len(prefix) > len(best)):
            best = prefix

    if best is None:
        return target

    mapped = absolute_paths[best + "*"]
    remainder = target[len(best) :]

    return posixpath.join(mapped.rstrip("/"), remainder)


def resolve_target(target: str, options: ParseOptions) -> str:
    """A target, as it is written, made into the target it names.

    A relative filesystem target resolves against the directory containing the document; a relative
    URL target resolves against the URL of the document (specification 9).
    """
    if is_url(target):
        return target

    base = options.filebase

    if target.startswith("/"):
        return target

    if base and is_url(base):
        return urljoin(base if base.endswith("/") else base + "/", target)

    # Normalised whether or not there is a base to resolve against. `./child` and `child` name the
    # same resource, and a target that kept its `./` would miss a resource supplied under the plain
    # name — which is a capability denial for a resource that was, in fact, handed over.
    return posixpath.normpath(posixpath.join(base, target))


class ResourceLoader(Protocol):
    """The seam a host reaches through.

    A `Protocol` rather than a base class, so that a host bringing its own reader — an editor serving
    unsaved buffers, a build system serving a virtual tree — writes an object and not a subclass.

    `None` means *not mine*: the caller decides whether that is a denial or a failure, because only
    the caller knows what was granted.
    """

    def load(
        self,
        target: str,
        kind: str,
        options: ParseOptions,
        token: Optional[str],
    ) -> Optional[Fetched]:
        ...


class DenyAll:
    """The default. A document that was handed nothing reaches nothing."""

    def load(self, target, kind, options, token):  # noqa: D102
        return None


class InMemory:
    """Resources supplied to the evaluator directly.

    Consulted before any loader, which is what lets a document that imports be evaluated while
    touching neither a disk nor a network — how the conformance suite runs, and how an editor reads a
    document that has not been saved.
    """

    def load(self, target, kind, options, token):  # noqa: D102
        resources = options.resources

        if target in resources:
            return Fetched(
                data=resources[target],
                filetype=extension_of(target) if kind == IMPORT else "",
                filebase=directory_of(target),
                resource_id=target,
            )

        return None


class Filesystem:
    """A disk, once somebody has said it may be read."""

    def load(self, target, kind, options, token):  # noqa: D102
        if is_url(target) or not options.allow_filesystem:
            return None

        try:
            with open(target, "r", encoding="utf-8") as handle:
                data = handle.read()
        except UnicodeDecodeError as failure:
            # The bytes were read; their encoding is the fault, not the I/O (specification 1, 9).
            raise ResourceMalformed(str(failure)) from None
        except OSError as failure:
            raise ResourceUnreadable(str(failure)) from None

        return Fetched(
            data=data,
            filetype=extension_of(target) if kind == IMPORT else "",
            filebase=directory_of(target),
            resource_id=target,
        )


class ResourceUnreadable(Exception):
    """A resource that was allowed and could not be read.

    Carried out of a loader so the interpreter can tell it apart from "not mine", which is what
    keeps `DEON_RESOURCE_IO` and `DEON_CAPABILITY_DENIED` from being confused for one another.
    """


class ResourceMalformed(Exception):
    """A resource that was read, whose bytes are not valid UTF-8.

    The bytes arrived; their *encoding* is the fault (specification 1, 9). Carried out of a loader,
    like `ResourceUnreadable`, but its sibling — so the interpreter reports `DEON_RESOURCE_FORMAT` at
    the importing statement, rather than the `DEON_RESOURCE_IO` earned by bytes it could not read at
    all.
    """


class Chain:
    def __init__(self, *loaders) -> None:
        self.loaders = loaders

    def load(self, target, kind, options, token):  # noqa: D102
        for loader in self.loaders:
            fetched = loader.load(target, kind, options, token)

            if fetched is not None:
                return fetched

        return None


def host_loader() -> Chain:
    """What a document gets when a caller has said what it may reach.

    Each loader gates itself on the capability it needs, so composing them grants nothing that was not
    already granted. The in-memory resources come first, so a document handed its own resources never
    reaches a disk or a network to find them.
    """
    from .network import Http

    return Chain(InMemory(), Http(), Filesystem())
