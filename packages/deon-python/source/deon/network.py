"""Resources over `http` and `https`.

This module *exists* unconditionally, and that is not the same as the capability being granted. The
`Rust` implementation hides its network behind a feature flag because reaching one costs it a TLS
dependency and the crate is meant to stay auditable at a glance; Python's standard library carries TLS
already, so there is nothing to hide and nothing to audit. The gate is where it belongs either way:
`allow_network` is off, and a remote target is refused **before a request is made** rather than after
one comes back (specification 9).

Two failures that must never be confused, because one is a policy and the other is the world:

- `DEON_CAPABILITY_DENIED` — this was never allowed, and no socket was opened.
- `DEON_RESOURCE_IO` — this was allowed, and it failed.
"""

from __future__ import annotations

import urllib.error
import urllib.request
from typing import Optional
from urllib.parse import urlsplit

from . import cache
from .diagnostic import DiagnosticCode, Span, error
from .options import ParseOptions
from .resources import (
    DEON_MEDIA_TYPE,
    IMPORT,
    Fetched,
    ResourceUnreadable,
    directory_of,
    extension_of,
    is_url,
)


TIMEOUT = 30


def accept(kind: str) -> str:
    """What a resource is asked for.

    An import will be parsed, so it asks for the things that can be parsed. An injection is bound as
    text without being parsed at all, so it asks for anything.
    """
    return "text/plain,application/json,application/deon" if kind == IMPORT else "*/*"


def hostname_of(target: str) -> str:
    return (urlsplit(target).hostname or "").lower()


def authorization(target: str, options: ParseOptions) -> Optional[str]:
    """The bearer for a host, if the caller named one.

    Keyed by exact lowercase hostname — no port, no path, no wildcard (specification 9). A credential
    is not something to hand out on a prefix match.
    """
    return options.authorization.get(hostname_of(target))


def get(url: str, headers: dict[str, str]) -> Optional[str]:
    """The body of a URL, or nothing.

    Nothing, rather than an error: the interpreter is what decides what a missing resource *means* —
    a refusal if the capability was never granted, a failure if it was — and deciding it here would
    throw that distinction away before anyone could use it.
    """
    request = urllib.request.Request(url, headers=headers, method="GET")

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            if not 200 <= response.status < 300:
                return None

            return response.read().decode("utf-8")
    except urllib.error.HTTPError:
        # A status outside 200–299 arrives here rather than above, and means the same thing.
        return None
    except (urllib.error.URLError, OSError, UnicodeDecodeError, ValueError):
        return None


class Http:
    """A loader for `http` and `https`, once somebody has said the network may be reached."""

    def load(self, target: str, kind: str, options: ParseOptions, token: Optional[str]) -> Optional[Fetched]:
        if not is_url(target):
            return None

        # The gate, and it is *before* the request. A denied document does not open a socket, which is
        # what makes the denial a fact rather than a promise.
        if not options.allow_network:
            return None

        headers = {"Accept": accept(kind)}

        # An empty token is no token. Sending `Bearer ` would be a credential-shaped nothing, and a
        # server would be right to reject it.
        credential = token if token else authorization(target, options)

        # The cache is keyed by the *resolved* credential, not by `options.token` — a document fetched
        # under one bearer must never be served to the holder of another (specification 9). It stores
        # the raw response body, so a hit skips the socket and the interpreter parses it exactly as it
        # would a fresh one. Off unless `options.cache`; every failure inside is silent.
        cached = cache.read(target, credential or "", options)

        if isinstance(cached, str):
            return self._fetched(cached, target, kind)

        if credential:
            headers["Authorization"] = f"Bearer {credential}"

        data = get(target, headers)

        if data is None:
            raise ResourceUnreadable(f"the request for '{target}' did not succeed")

        cache.write(target, data, credential or "", options)

        return self._fetched(data, target, kind)

    @staticmethod
    def _fetched(data: str, target: str, kind: str) -> Fetched:
        return Fetched(
            data=data,
            filetype=extension_of(target) if kind == IMPORT else "",
            filebase=directory_of(target),
            resource_id=target,
        )


def parse_link(link: str, options: Optional[ParseOptions] = None):
    """A Deon document, fetched from a URL and evaluated.

    The headers here are deliberately *not* the importer's: a link is asked for as Deon and nothing
    else, because a caller who said `parse_link` said what they expect to get.
    """
    from . import parse_with

    options = options or ParseOptions()

    if not options.allow_network:
        raise error(
            DiagnosticCode.CAPABILITY_DENIED,
            f"'{link}' was not fetched: network access is not allowed.",
            Span.head(link),
        )

    headers = {"Accept": DEON_MEDIA_TYPE}

    if options.token:
        headers["Authorization"] = f"Bearer {options.token}"

    data = get(link, headers)

    if data is None:
        raise error(
            DiagnosticCode.RESOURCE_IO,
            f"Unable to read '{link}'.",
            Span.head(link),
        )

    options.source_name = link
    options.filebase = directory_of(link)

    return parse_with(data, options)
