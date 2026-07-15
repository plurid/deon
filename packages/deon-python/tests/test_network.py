"""Resources over HTTP.

Bound to `127.0.0.1`, always. Specification 15 requires that tests resolve resources through injected
or local resolvers and never through a public network service — a suite that reaches the internet is a
suite that fails when the internet does, and tells you nothing about the language either way.
"""

from __future__ import annotations

import http.server
import shutil
import tempfile
import threading
import unittest
from unittest import mock

import deon
from deon import DeonError, DiagnosticCode, ParseOptions
from deon.network import parse_link


class Responder(http.server.BaseHTTPRequestHandler):
    #: What the last request carried, so a test can assert on the headers that were *sent*.
    seen: dict = {}

    #: How many times each path was actually requested, so a cache test can prove a hit reached no
    #: socket at all — a served-from-cache response and a re-fetch look identical from the value alone.
    hits: dict = {}

    routes = {
        "/child.deon": ("{ name imported }", 200),
        "/data.json": ('{"a": 1.50}', 200),
        "/private.deon": ("{ name secret }", 200),
        "/missing.deon": ("gone", 404),
        "/text.txt": ("raw text", 200),
    }

    def do_GET(self):  # noqa: N802
        Responder.seen = {
            "path": self.path,
            "accept": self.headers.get("Accept"),
            "authorization": self.headers.get("Authorization"),
        }
        Responder.hits[self.path] = Responder.hits.get(self.path, 0) + 1

        body, status = self.routes.get(self.path, ("", 404))

        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *_):  # keep the suite quiet
        pass


class Served(unittest.TestCase):
    """A loopback HTTP server for the duration of the class. `127.0.0.1` only (specification 15)."""

    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), Responder)
        cls.host = f"http://127.0.0.1:{cls.server.server_port}"

        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def allowed(self, **extra) -> ParseOptions:
        options = ParseOptions(allow_network=True)

        for name, value in extra.items():
            setattr(options, name, value)

        return options


class Network(Served):
    # #region the gate
    def test_the_network_is_denied_by_default_and_nothing_is_requested(self):
        """The gate is *before* the request, which is what makes a denial a fact and not a promise."""
        Responder.seen = {}

        with self.assertRaises(DeonError) as caught:
            deon.parse(f"import c from {self.host}/child.deon\n{{ #c }}")

        self.assertEqual(caught.exception.code, DiagnosticCode.CAPABILITY_DENIED)

        # And no socket was opened. Erroring after the fact would look the same from the outside and
        # would not be the same thing at all.
        self.assertEqual(Responder.seen, {})

    def test_an_import_over_http(self):
        value = deon.parse_with(
            f"import c from {self.host}/child.deon\n{{ #c.name }}",
            self.allowed(),
        )

        self.assertEqual(value, {"name": "imported"})
        self.assertEqual(Responder.seen["accept"], "text/plain,application/json,application/deon")

    def test_an_injection_asks_for_anything(self):
        value = deon.parse_with(
            f"inject t from {self.host}/text.txt\n{{ #t }}",
            self.allowed(),
        )

        self.assertEqual(value, {"t": "raw text"})
        self.assertEqual(Responder.seen["accept"], "*/*")

    def test_json_over_http_keeps_its_number_spelling(self):
        value = deon.parse_with(
            f"import d from {self.host}/data.json\n{{ ...#d }}",
            self.allowed(),
        )

        self.assertEqual(value, {"a": "1.50"})
    # #endregion the gate

    # #region credentials
    def test_a_with_token_is_sent_as_a_bearer(self):
        deon.parse_with(
            f"t s3cret\nimport c from {self.host}/private.deon with #t\n{{ #c }}",
            self.allowed(),
        )

        self.assertEqual(Responder.seen["authorization"], "Bearer s3cret")

    def test_the_authorization_map_is_used_when_the_declaration_says_nothing(self):
        deon.parse_with(
            f"import c from {self.host}/private.deon\n{{ #c }}",
            self.allowed(authorization={"127.0.0.1": "from-the-map"}),
        )

        self.assertEqual(Responder.seen["authorization"], "Bearer from-the-map")

    def test_the_declaration_wins_over_the_map(self):
        deon.parse_with(
            f"t mine\nimport c from {self.host}/private.deon with #t\n{{ #c }}",
            self.allowed(authorization={"127.0.0.1": "theirs"}),
        )

        self.assertEqual(Responder.seen["authorization"], "Bearer mine")

    def test_an_empty_token_sends_no_header_at_all(self):
        """`Bearer ` is a credential-shaped nothing, and a server would be right to reject it."""
        deon.parse_with(
            f"t ''\nimport c from {self.host}/private.deon with #t\n{{ #c }}",
            self.allowed(),
        )

        self.assertIsNone(Responder.seen["authorization"])
    # #endregion credentials

    def test_a_non_success_status_is_an_io_failure_and_not_a_denial(self):
        """It was allowed, and it failed. That is a different thing from never having been allowed,
        and a caller reading the diagnostic has to be able to tell them apart."""
        with self.assertRaises(DeonError) as caught:
            deon.parse_with(
                f"import c from {self.host}/missing.deon\n{{ #c }}",
                self.allowed(),
            )

        self.assertEqual(caught.exception.code, DiagnosticCode.RESOURCE_IO)

    def test_a_relative_import_inside_a_fetched_document_resolves_against_its_url(self):
        value = deon.parse_with(
            f"import c from {self.host}/child.deon\n{{ #c.name }}",
            self.allowed(),
        )

        self.assertEqual(value["name"], "imported")

    # #region parse_link
    def test_parse_link_is_denied_before_any_request(self):
        Responder.seen = {}

        with self.assertRaises(DeonError) as caught:
            parse_link(f"{self.host}/child.deon", ParseOptions())

        self.assertEqual(caught.exception.code, DiagnosticCode.CAPABILITY_DENIED)
        self.assertEqual(Responder.seen, {})

    def test_parse_link_asks_for_deon_and_nothing_else(self):
        value = parse_link(f"{self.host}/child.deon", ParseOptions(allow_network=True))

        self.assertEqual(value, {"name": "imported"})
        self.assertEqual(Responder.seen["accept"], "application/deon")
    # #endregion parse_link


class CacheKey(unittest.TestCase):
    """Specification 9: a token must not appear in a cache identifier, and an authenticated entry must
    be separated by a digest of the credential."""

    def test_the_token_never_appears_in_the_key(self):
        from deon.cache import cache_key

        key = cache_key("https://example.com/a.deon", "super-secret")

        self.assertNotIn("super-secret", key)
        self.assertNotIn("example.com", key)

    def test_a_different_token_is_a_different_entry(self):
        """Not a cache miss — a data leak, if it were not. A document fetched under one credential must
        never be served to the holder of another."""
        from deon.cache import cache_key

        self.assertNotEqual(
            cache_key("https://example.com/a.deon", "alice"),
            cache_key("https://example.com/a.deon", "bob"),
        )

    def test_the_separator_cannot_be_spelled_two_ways(self):
        """The NUL cannot occur in either half, so `("ab", "c")` and `("a", "bc")` cannot collide."""
        from deon.cache import cache_key

        self.assertNotEqual(cache_key("ab", "c"), cache_key("a", "bc"))


class Cache(Served):
    """The response cache, end to end: a hit reaches no socket, a second credential is a separate entry,
    it is off unless asked for, and an expired entry is fetched afresh (specification 9)."""

    def setUp(self):
        Responder.hits = {}
        # A fresh directory per test, so one test's entries never decide another's outcome.
        self._directory = tempfile.mkdtemp(prefix="deon-cache-test-")
        self.addCleanup(shutil.rmtree, self._directory, ignore_errors=True)
        # The routes are class state; restore whatever a test rewrites.
        self._routes = dict(Responder.routes)
        self.addCleanup(setattr, Responder, "routes", self._routes)

    def caching(self, **extra) -> ParseOptions:
        return self.allowed(cache=True, cache_directory=self._directory, **extra)

    def fetch(self, options: ParseOptions):
        return deon.parse_with(
            f"import c from {self.host}/cached.deon\n{{ #c.name }}",
            options,
        )

    def test_a_second_fetch_is_served_from_cache_and_opens_no_socket(self):
        Responder.routes["/cached.deon"] = ("{ name first }", 200)
        options = self.caching()

        self.assertEqual(self.fetch(options), {"name": "first"})
        self.assertEqual(Responder.hits.get("/cached.deon"), 1)

        # The server now says something different. A real hit ignores it — the body came off disk.
        Responder.routes["/cached.deon"] = ("{ name second }", 200)

        self.assertEqual(self.fetch(options), {"name": "first"})
        self.assertEqual(Responder.hits.get("/cached.deon"), 1)

    def test_without_the_cache_flag_every_fetch_reaches_the_server(self):
        Responder.routes["/cached.deon"] = ("{ name first }", 200)
        options = self.allowed()  # cache off, the default

        self.fetch(options)
        Responder.routes["/cached.deon"] = ("{ name second }", 200)
        self.assertEqual(self.fetch(options), {"name": "second"})
        self.assertEqual(Responder.hits.get("/cached.deon"), 2)

    def test_a_different_credential_is_a_separate_entry_and_is_not_served_the_first(self):
        """The data-leak guard, exercised rather than asserted about the key: alice's cached body must
        never satisfy bob's request, so bob's fetch reaches the server anew."""
        Responder.routes["/cached.deon"] = ("{ name shared }", 200)
        alice = self.caching(authorization={"127.0.0.1": "alice"})
        bob = self.caching(authorization={"127.0.0.1": "bob"})

        self.fetch(alice)
        self.assertEqual(Responder.hits.get("/cached.deon"), 1)

        # Bob has never fetched this, whatever alice cached. A hit here would be the leak.
        self.fetch(bob)
        self.assertEqual(Responder.hits.get("/cached.deon"), 2)

        # And alice is still served from her own entry.
        self.fetch(alice)
        self.assertEqual(Responder.hits.get("/cached.deon"), 2)

    def test_an_expired_entry_is_fetched_afresh(self):
        Responder.routes["/cached.deon"] = ("{ name first }", 200)

        # The clock is under the test's control, so expiry is a decision and not a race: the entry is
        # written at t=0 with a one-second life, then read once inside that life and once past it.
        clock = {"now": 0}
        with mock.patch("deon.cache.now_milliseconds", side_effect=lambda: clock["now"]):
            options = self.caching(cache_duration=1000)

            self.assertEqual(self.fetch(options), {"name": "first"})  # writes at t=0
            Responder.routes["/cached.deon"] = ("{ name second }", 200)

            clock["now"] = 500  # still within the second — the cache still answers
            self.assertEqual(self.fetch(options), {"name": "first"})
            self.assertEqual(Responder.hits.get("/cached.deon"), 1)

            clock["now"] = 2000  # past it — the stale entry is dropped and the server is asked again
            self.assertEqual(self.fetch(options), {"name": "second"})
            self.assertEqual(Responder.hits.get("/cached.deon"), 2)


class Waypoint(http.server.BaseHTTPRequestHandler):
    """A loopback stop that either sends the client onward or records what reached it.

    `/redirect` answers 302 to `location`; anything else records the Authorization it was handed and
    serves a Deon document. Subclassed per role so two servers standing up at once keep their own
    `location` and `seen` — `type(self)` binds each read and write to the concrete subclass. Loopback
    only, 127.0.0.1 / localhost, per specification 15.
    """

    location = ""

    #: The Authorization the landing request carried. The sentinel is distinct from None on purpose:
    #: None is precisely what a *scrubbed* request produces, and telling the two apart is the test.
    seen = "<<unset>>"

    def do_GET(self):  # noqa: N802
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", type(self).location)
            self.end_headers()
            return

        type(self).seen = self.headers.get("Authorization")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"{ name landed }")

    def log_message(self, *_):  # keep the suite quiet
        pass


class Alpha(Waypoint):
    """Cross-host source: bound on 127.0.0.1, its redirect names `localhost` — a different host."""


class Beta(Waypoint):
    """Cross-host target: records whether the bearer meant for Alpha followed the redirect to here."""


class Loop(Waypoint):
    """Same-host source and target at once: it redirects to its own landing on the identical origin."""


class Redirects(unittest.TestCase):
    """Specification 9: a bearer must not escape the host it was named for when a redirect crosses to
    another origin, and must survive one that stays on the same origin. Python's urllib re-sends
    request headers across a 302 even to a different host, so this is the one implementation that could
    leak; the fix scrubs `Authorization` on a cross-origin hop and keeps it on a same-origin one. Every
    server here is loopback (127.0.0.1 / localhost), per specification 15."""

    @classmethod
    def setUpClass(cls):
        cls.servers = []

        # The cross-host target (B) comes up first, so its port is known when A is pointed at it.
        beta = http.server.HTTPServer(("127.0.0.1", 0), Beta)
        cls.beta_port = beta.server_port

        # The cross-host source (A) is bound on 127.0.0.1 but redirects to `localhost` on B's port —
        # a different host by name and by port, so the hop is unmistakably cross-origin.
        Alpha.location = f"http://localhost:{cls.beta_port}/landing"
        alpha = http.server.HTTPServer(("127.0.0.1", 0), Alpha)
        cls.alpha_port = alpha.server_port

        # The same-host case is one origin that redirects to its own landing (same scheme/host/port).
        loop = http.server.HTTPServer(("127.0.0.1", 0), Loop)
        cls.loop_port = loop.server_port
        Loop.location = f"http://127.0.0.1:{cls.loop_port}/landing"

        for server in (beta, alpha, loop):
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            cls.servers.append(server)

    @classmethod
    def tearDownClass(cls):
        for server in cls.servers:
            server.shutdown()
            server.server_close()

    def test_a_bearer_does_not_survive_a_cross_host_redirect(self):
        """The leak, closed: a bearer handed to Alpha must not arrive at Beta."""
        Beta.seen = "<<unset>>"

        value = parse_link(
            f"http://127.0.0.1:{self.alpha_port}/redirect",
            ParseOptions(allow_network=True, token="s3cret"),
        )

        # The redirect was followed — Beta served the document ...
        self.assertEqual(value, {"name": "landed"})
        # ... but the bearer was scrubbed at the cross-host hop, so Beta never saw it.
        self.assertIsNone(Beta.seen)

    def test_a_bearer_survives_a_same_host_redirect(self):
        """The friendly half: a redirect that never leaves the origin still authenticates."""
        Loop.seen = "<<unset>>"

        value = parse_link(
            f"http://127.0.0.1:{self.loop_port}/redirect",
            ParseOptions(allow_network=True, token="s3cret"),
        )

        self.assertEqual(value, {"name": "landed"})
        self.assertEqual(Loop.seen, "Bearer s3cret")


if __name__ == "__main__":
    unittest.main()
