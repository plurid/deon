"""Resources over HTTP.

Bound to `127.0.0.1`, always. Specification 15 requires that tests resolve resources through injected
or local resolvers and never through a public network service — a suite that reaches the internet is a
suite that fails when the internet does, and tells you nothing about the language either way.
"""

from __future__ import annotations

import http.server
import threading
import unittest

import deon
from deon import DeonError, DiagnosticCode, ParseOptions
from deon.network import parse_link


class Responder(http.server.BaseHTTPRequestHandler):
    #: What the last request carried, so a test can assert on the headers that were *sent*.
    seen: dict = {}

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

        body, status = self.routes.get(self.path, ("", 404))

        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *_):  # keep the suite quiet
        pass


class Network(unittest.TestCase):
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


class Cache(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
