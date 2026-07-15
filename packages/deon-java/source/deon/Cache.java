package deon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;

/**
 * The response cache. Two requirements of specification 9 are the reason this is not a map keyed by URL:
 * a token must not appear in a cache identifier in plain text, and authenticated entries must be
 * separated by a digest of the credential. So an entry is keyed by {@code sha256(name + NUL + token)}.
 * The digest keeps the credential out of the filename, and folding the token into the key is what stops
 * a document fetched under one credential from being served to the holder of another — a data leak, not
 * a miss. An entry is itself a canonical Deon document. Every failure here is silent, because a cache
 * that raised would turn a performance decision into a correctness one.
 */
final class Cache {
    private static final long DEFAULT_DURATION = 3_600_000L; // one hour, milliseconds

    private static String key(String name, String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(name.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(token.getBytes(StandardCharsets.UTF_8));
            byte[] hash = digest.digest();
            StringBuilder hex = new StringBuilder(64);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xf, 16));
                hex.append(Character.forDigit(b & 0xf, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private static String expandUser(String path) {
        if (path.equals("~") || path.startsWith("~/")) {
            String home = System.getProperty("user.home");
            if (home != null) {
                return path.equals("~") ? home : home + path.substring(1);
            }
        }
        return path;
    }

    private static Path entryPath(ParseOptions options, String name, String token) {
        if (!options.cache) {
            return null;
        }
        String directory = options.cacheDirectory == null || options.cacheDirectory.isEmpty()
                ? "~/.deon-cache" : options.cacheDirectory;
        String key = key(name, token);
        if (key == null) {
            return null;
        }
        return Path.of(expandUser(directory), key);
    }

    private static long durationOf(ParseOptions options) {
        return options.cacheDuration > 0 ? options.cacheDuration : DEFAULT_DURATION;
    }

    private static Long asLong(Object value) {
        if (!(value instanceof String s)) {
            return null;
        }
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static String read(ParseOptions options, String name, String token) {
        Path path = entryPath(options, name, token);
        if (path == null) {
            return null;
        }
        String source;
        try {
            source = Files.readString(path);
        } catch (IOException e) {
            return null;
        }
        Object entry;
        try {
            entry = Deon.parse(source);
        } catch (DeonException e) {
            return null;
        }
        if (!(entry instanceof DeonMap map)) {
            return null;
        }
        Long cachedAt = asLong(map.get("cachedAt"));
        Long duration = asLong(map.get("cacheDuration"));
        if (cachedAt == null || duration == null) {
            return null;
        }
        if (cachedAt + duration < System.currentTimeMillis()) {
            try {
                Files.deleteIfExists(path); // expired, so it is gone
            } catch (IOException ignored) {
                // silent
            }
            return null;
        }
        Object data = map.get("data");
        return data instanceof String s ? s : null;
    }

    static void write(ParseOptions options, String name, String token, String body) {
        Path path = entryPath(options, name, token);
        if (path == null) {
            return;
        }
        DeonMap entry = new DeonMap();
        entry.set("cachedAt", Long.toString(System.currentTimeMillis()));
        entry.set("cacheDuration", Long.toString(durationOf(options)));
        entry.set("data", body);
        try {
            if (path.getParent() != null) {
                Files.createDirectories(path.getParent());
            }
            Files.writeString(path, Deon.canonical(entry));
        } catch (IOException ignored) {
            // silent on failure, for the same reason
        }
    }
}
