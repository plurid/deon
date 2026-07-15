package harness;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import deon.Deon;
import deon.DeonException;
import deon.DeonMap;
import deon.Diagnostic;
import deon.Entity;
import deon.ParseOptions;
import deon.StringifyOptions;

/**
 * The cross-implementation harness adapter (spec/harness/README.md). A filter: newline-delimited JSON
 * in, newline-delimited JSON out. Every value in a request and a response is a string, so the request
 * itself parses with the implementation's own JSON reader and no third-party decoder is needed.
 */
public final class Harness {
    public static void main(String[] args) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isEmpty()) {
                continue;
            }
            DeonMap request;
            try {
                Object parsed = Deon.readJson(line, "<request>");
                if (!(parsed instanceof DeonMap map)) {
                    continue;
                }
                request = map;
            } catch (DeonException e) {
                continue;
            }
            out.println(answer(request));
        }
    }

    private static String answer(DeonMap request) {
        String id = str(request, "id", "");
        try {
            return perform(request, id);
        } catch (DeonException e) {
            Diagnostic d = e.primary();
            StringBuilder b = new StringBuilder();
            b.append("{\"id\":");
            jsonString(b, id);
            b.append(",\"ok\":\"false\",\"code\":");
            jsonString(b, e.code.wire());
            b.append(",\"line\":");
            jsonString(b, Integer.toString(d.span.line));
            b.append(",\"column\":");
            jsonString(b, Integer.toString(d.span.column));
            b.append('}');
            return b.toString();
        } catch (RuntimeException e) {
            return "{\"id\":" + quoted(id) + ",\"ok\":\"false\",\"code\":\"HOST_PANIC\",\"line\":\"0\",\"column\":\"0\"}";
        }
    }

    private static String perform(DeonMap request, String id) {
        String op = str(request, "op", "");
        String source = str(request, "source", "");
        String sourceName = str(request, "sourceName", "<memory>");

        if (op.equals("entities")) {
            StringBuilder j = new StringBuilder("[");
            List<Entity> entities = Deon.entities(source, sourceName);
            for (int i = 0; i < entities.size(); i++) {
                if (i > 0) {
                    j.append(',');
                }
                Entity e = entities.get(i);
                j.append("{\"name\":");
                jsonString(j, e.name());
                j.append(",\"parameters\":[");
                for (int p = 0; p < e.parameters().size(); p++) {
                    if (p > 0) {
                        j.append(',');
                    }
                    jsonString(j, e.parameters().get(p));
                }
                j.append("],\"kind\":");
                jsonString(j, e.kind());
                j.append('}');
            }
            j.append(']');
            return ok(id, j.toString());
        }

        if (op.equals("lint")) {
            StringBuilder j = new StringBuilder("[");
            List<Diagnostic> diagnostics = Deon.lint(source, sourceName);
            for (int i = 0; i < diagnostics.size(); i++) {
                if (i > 0) {
                    j.append(',');
                }
                Diagnostic d = diagnostics.get(i);
                j.append("{\"code\":");
                jsonString(j, d.code.wire());
                j.append(",\"line\":");
                jsonString(j, Integer.toString(d.span.line));
                j.append(",\"column\":");
                jsonString(j, Integer.toString(d.span.column));
                j.append('}');
            }
            j.append(']');
            return ok(id, j.toString());
        }

        Object value = Deon.parseWith(source, optionsOf(request));
        return switch (op) {
            case "canonical" -> ok(id, Deon.canonical(value));
            case "stringify" -> ok(id, Deon.stringify(value, stringifyOptionsOf(request)));
            case "typed" -> ok(id, marshal(Deon.typed(value)));
            case "datasign" -> ok(id, marshal(value)); // parseWith already applied the contracts
            default -> "{\"id\":" + quoted(id) + ",\"ok\":\"false\",\"code\":\"HOST_PANIC\",\"line\":\"0\",\"column\":\"0\"}";
        };
    }

    private static String ok(String id, String result) {
        StringBuilder b = new StringBuilder();
        b.append("{\"id\":");
        jsonString(b, id);
        b.append(",\"ok\":\"true\",\"result\":");
        jsonString(b, result);
        b.append('}');
        return b.toString();
    }

    // #region request access
    private static ParseOptions optionsOf(DeonMap request) {
        ParseOptions o = new ParseOptions();
        o.sourceName = str(request, "sourceName", "<memory>");
        o.filebase = str(request, "filebase", "");
        o.resources = stringMap(request, "files");
        o.absolutePaths = stringMap(request, "absolutePaths");
        o.environment = stringMap(request, "environment");
        o.allowFilesystem = str(request, "allowFilesystem", "false").equals("true");
        o.allowNetwork = str(request, "allowNetwork", "false").equals("true");
        o.datasignFiles = stringList(request, "datasignFiles");
        o.datasignMap = stringMap(request, "datasignMap");
        return o;
    }

    private static StringifyOptions stringifyOptionsOf(DeonMap request) {
        StringifyOptions o = StringifyOptions.defaults();
        Object raw = request.get("stringifyOptions");
        if (!(raw instanceof DeonMap m)) {
            return o;
        }
        o.canonical = truthy(m, "canonical", false);
        o.readable = truthy(m, "readable", true);
        o.leaflinks = truthy(m, "leaflinks", false);
        o.leaflinkShortening = truthy(m, "leaflinkShortening", true);
        o.generatedHeader = truthy(m, "generatedHeader", false);
        o.generatedComments = truthy(m, "generatedComments", false);
        o.indentation = number(m, "indentation", 4);
        o.leaflinkLevel = number(m, "leaflinkLevel", 1);
        return o;
    }

    private static boolean truthy(DeonMap m, String key, boolean fallback) {
        Object v = m.get(key);
        return v instanceof String s ? s.equals("true") : fallback;
    }

    private static int number(DeonMap m, String key, int fallback) {
        Object v = m.get(key);
        if (v instanceof String s) {
            try {
                return Integer.parseInt(s);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static String str(DeonMap m, String key, String fallback) {
        Object v = m.get(key);
        return v instanceof String s ? s : fallback;
    }

    private static Map<String, String> stringMap(DeonMap m, String key) {
        Object v = m.get(key);
        if (!(v instanceof DeonMap nested)) {
            return Map.of();
        }
        Map<String, String> out = new LinkedHashMap<>();
        for (String k : nested.keys()) {
            Object item = nested.get(k);
            out.put(k, item instanceof String s ? s : "");
        }
        return out;
    }

    private static List<String> stringList(DeonMap m, String key) {
        Object v = m.get(key);
        if (!(v instanceof List<?> list)) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (Object item : list) {
            out.add(item instanceof String s ? s : "");
        }
        return out;
    }
    // #endregion

    // #region JSON output
    private static String marshal(Object v) {
        StringBuilder b = new StringBuilder();
        marshal(b, v);
        return b.toString();
    }

    private static void marshal(StringBuilder b, Object v) {
        if (v instanceof String s) {
            jsonString(b, s);
        } else if (v instanceof Boolean bool) {
            b.append(bool ? "true" : "false");
        } else if (v instanceof Double d) {
            // A whole number within signed 64-bit range writes as a bare integer, matching the sibling
            // adapters. Anything larger must not narrow through a long: (long) 1e19 saturates to
            // Long.MAX_VALUE and would hand back a different number than the one typed (spec 14). Such a
            // value, and every fractional one, writes through its shortest round-tripping decimal.
            if (d == Math.rint(d) && Math.abs(d) < 0x1p63) {
                b.append(Long.toString(d.longValue()));
            } else {
                b.append(d.toString());
            }
        } else if (v instanceof List<?> list) {
            b.append('[');
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) {
                    b.append(',');
                }
                marshal(b, list.get(i));
            }
            b.append(']');
        } else if (v instanceof DeonMap map) {
            b.append('{');
            List<String> keys = map.keys();
            for (int i = 0; i < keys.size(); i++) {
                if (i > 0) {
                    b.append(',');
                }
                jsonString(b, keys.get(i));
                b.append(':');
                marshal(b, map.get(keys.get(i)));
            }
            b.append('}');
        } else {
            b.append("null");
        }
    }

    private static String quoted(String s) {
        StringBuilder b = new StringBuilder();
        jsonString(b, s);
        return b.toString();
    }

    private static void jsonString(StringBuilder b, String s) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                case '\b' -> b.append("\\b");
                case '\f' -> b.append("\\f");
                default -> {
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
                }
            }
        }
        b.append('"');
    }
    // #endregion
}
