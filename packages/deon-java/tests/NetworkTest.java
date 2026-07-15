package tests;

import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

import com.sun.net.httpserver.HttpServer;

import deon.Code;
import deon.Deon;
import deon.DeonException;
import deon.DeonMap;
import deon.ParseOptions;

/**
 * The network path over a loopback server. Nothing else exercises the socket: the differential harness
 * uses in-memory resources, and every fixture that names the network is a denial. So this test binds a
 * server to 127.0.0.1, never anything routable, and drives an import, a link, a non-success status, and
 * a denial through it. The server is the JDK's own — no third-party dependency.
 */
public final class NetworkTest {
    private static int failures = 0;

    private static void check(boolean ok, String what) {
        if (ok) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/data.json")) {
                respond(exchange, 200, "{\"n\": 1.50}");
            } else if (path.contains("/missing")) {
                respond(exchange, 404, "no");
            } else {
                respond(exchange, 200, "{\n    inner value\n}\n");
            }
        });
        server.start();
        int port = server.getAddress().getPort();
        String base = "http://127.0.0.1:" + port;

        ParseOptions net = new ParseOptions();
        net.allowNetwork = true;

        // an import over the network is evaluated and spread
        try {
            Object v = Deon.parseWith("import c from " + base + "/child.deon\n{\n    ...#c\n}\n", net);
            check(v instanceof DeonMap m && "value".equals(m.get("inner")), "import over http");
        } catch (DeonException e) {
            check(false, "import over http (" + e.code.wire() + ")");
        }

        // an injected JSON resource keeps its number's source spelling
        try {
            Object v = Deon.parseWith("import j from " + base + "/data.json\n{\n    ...#j\n}\n", net);
            check(v instanceof DeonMap m && "1.50".equals(m.get("n")), "json import preserves spelling");
        } catch (DeonException e) {
            check(false, "json import preserves spelling (" + e.code.wire() + ")");
        }

        // a non-success status is DEON_RESOURCE_IO: it was allowed and it failed
        try {
            Deon.parseWith("import m from " + base + "/missing\n{\n    #m\n}\n", net);
            check(false, "non-success status is RESOURCE_IO");
        } catch (DeonException e) {
            check(e.code == Code.RESOURCE_IO, "non-success status is RESOURCE_IO");
        }

        // parseLink fetches and evaluates a document by URL
        try {
            Object v = Deon.parseLink(base + "/child.deon", net);
            check(v instanceof DeonMap m && m.get("inner") instanceof String, "parseLink over http");
        } catch (DeonException e) {
            check(false, "parseLink over http (" + e.code.wire() + ")");
        }

        // the network is refused before any socket opens when it was not granted
        try {
            Deon.parse("import c from " + base + "/child.deon\n{\n    #c\n}\n");
            check(false, "network denied by default");
        } catch (DeonException e) {
            check(e.code == Code.CAPABILITY_DENIED, "network denied by default");
        }

        server.stop(0);

        if (failures == 0) {
            System.out.println("\nall network cases passed");
            return;
        }
        System.err.println("\n" + failures + " network failure(s)");
        System.exit(1);
    }
}
