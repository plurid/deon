package tests;

import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import com.sun.net.httpserver.HttpServer;

import deon.Code;
import deon.Deon;
import deon.DeonException;
import deon.DeonMap;
import deon.ParseOptions;

/**
 * The response cache, keyed by a digest of the credential (specification 9). The proof that the cache is
 * a cache is that a second fetch succeeds after the server has served its one request; the proof that
 * the digest separates credentials is that a fetch under a different token, against the same URL, misses
 * and so has nowhere to go.
 */
public final class CacheTest {
    private static int failures = 0;

    private static void check(boolean ok, String what) {
        if (ok) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    public static void main(String[] args) throws Exception {
        AtomicInteger served = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", exchange -> {
            served.incrementAndGet();
            byte[] body = "{\n    inner value\n}\n".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        server.start();
        int port = server.getAddress().getPort();
        String base = "http://127.0.0.1:" + port;
        String src = "import c from " + base + "/child.deon\n{\n    ...#c\n}\n";

        Path dir = Files.createTempDirectory("deon-java-cache-");

        ParseOptions o = new ParseOptions();
        o.allowNetwork = true;
        o.cache = true;
        o.cacheDirectory = dir.toString();
        o.authorization = Map.of("127.0.0.1", "secret");

        // the first fetch reaches the server and writes the cache
        Object first = Deon.parseWith(src, o);
        check(first instanceof DeonMap m && "value".equals(m.get("inner")), "first fetch reaches the server");

        try (Stream<Path> entries = Files.list(dir)) {
            check(entries.anyMatch(p -> p.getFileName().toString().length() == 64), "a digest-named cache entry is written");
        }

        server.stop(0); // the server is gone

        // the second fetch, same credential, is served from the cache
        Object second = Deon.parseWith(src, o);
        check(second instanceof DeonMap m && "value".equals(m.get("inner")), "second fetch is served from cache");

        // a different credential is a different key, so it misses — and with the server gone, fails
        o.authorization = Map.of("127.0.0.1", "other");
        try {
            Deon.parseWith(src, o);
            check(false, "a different token misses the cache");
        } catch (DeonException e) {
            check(e.code == Code.RESOURCE_IO, "a different token misses the cache");
        }

        try (Stream<Path> entries = Files.walk(dir)) {
            entries.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (Exception ignored) {
                    // best effort cleanup
                }
            });
        }

        if (failures == 0) {
            System.out.println("\nall cache cases passed");
            return;
        }
        System.err.println("\n" + failures + " cache failure(s)");
        System.exit(1);
    }
}
