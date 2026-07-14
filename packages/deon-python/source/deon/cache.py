"""The response cache.

Two requirements of specification 9, and they are the reason this is not a dictionary keyed by URL:

> Tokens MUST NOT appear in diagnostics or cache identifiers in plain text.
> Authenticated cache entries MUST be separated by a digest of the credential.

So an entry is keyed by `sha256(name + NUL + token)`. The digest keeps the credential out of the
filename, and folding the token *into* the key is what stops a document fetched under one credential
from being served to the holder of another — which is not a cache miss, it is a data leak.

A cache entry is itself a canonical Deon document. That is a small piece of dogfooding with a real
edge: the format has to survive a round trip, so it is made to, on every write and every read.
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import time
from typing import Optional

from .options import ParseOptions
from .value import DeonMap, Value


DEFAULT_CACHE_DURATION = 3_600_000  # one hour, in milliseconds

DEFAULT_CACHE_DIRECTORY = "~/.deon-cache"


def cache_key(name: str, token: str) -> str:
    """The identity of a cached response.

    The NUL is a separator that cannot occur in either half, so no pair of (name, token) can be spelled
    two ways and collide. Without it, a name ending in a token's prefix would hash to the same place.
    """
    digest = hashlib.sha256()
    digest.update(name.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(token.encode("utf-8"))

    return digest.hexdigest()


def now_milliseconds() -> int:
    return int(time.time() * 1000)


def entry_path(name: str, options: ParseOptions) -> Optional[pathlib.Path]:
    if not options.cache:
        return None

    directory = pathlib.Path(os.path.expanduser(options.cache_directory or DEFAULT_CACHE_DIRECTORY))

    return directory / cache_key(name, options.token)


def read(name: str, options: ParseOptions) -> Optional[Value]:
    """A cached response, if there is one and it has not expired.

    Every failure is silent. A cache that raises is worse than no cache: it turns a performance
    decision into a correctness one, and a document that parsed yesterday would stop parsing because
    of a file nobody meant to be load-bearing.
    """
    from . import parse

    path = entry_path(name, options)

    if path is None:
        return None

    try:
        source = path.read_text("utf-8")
    except OSError:
        return None

    try:
        entry = parse(source)
    except Exception:
        return None

    if not isinstance(entry, DeonMap):
        return None

    try:
        cached_at = int(entry["cachedAt"])
        duration = int(entry["cacheDuration"])
    except (KeyError, TypeError, ValueError):
        return None

    if cached_at + duration < now_milliseconds():
        # Expired, so it is gone. Leaving it would mean reading and re-deciding it every time.
        try:
            path.unlink()
        except OSError:
            pass

        return None

    return entry.get("data")


def write(name: str, value: Value, options: ParseOptions) -> None:
    from .stringifier import canonical

    path = entry_path(name, options)

    if path is None:
        return

    entry = DeonMap()
    entry.insert("cachedAt", str(now_milliseconds()))
    entry.insert("cacheDuration", str(options.cache_duration))
    entry.insert("data", value)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(canonical(entry), "utf-8")
    except OSError:
        # Silent, for the same reason as above.
        pass
