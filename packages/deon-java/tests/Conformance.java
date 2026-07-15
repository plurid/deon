package tests;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import deon.Deon;
import deon.DeonException;
import deon.DeonMap;
import deon.Diagnostic;
import deon.ParseOptions;
import deon.StringifyOptions;

/**
 * The normative conformance suite (specification 15). An implementation conforms to Deon 1.0 only when
 * it passes every required fixture in spec/conformance/cases.json. The fixtures are language-neutral and
 * shared by every implementation, read from the repository rather than copied. This runner carries its
 * own typed JSON reader — unlike the library's, which flattens every scalar to a string — because the
 * `typed` and `datasign` fixtures assert that a boolean is a boolean and a number is a number.
 */
public final class Conformance {
    private static final String MANIFEST = "../../spec/conformance/cases.json";

    private static int failures = 0;

    private static void fail(String id, String message) {
        System.err.println("FAIL " + id + ": " + message);
        failures++;
    }

    // #region a typed JSON reader
    private static final class Json {
        private final String s;
        private final int len;
        private int pos;

        Json(String s) {
            this.s = s;
            this.len = s.length();
        }

        static Object parse(String s) {
            Json j = new Json(s);
            Object v = j.value();
            j.ws();
            return v;
        }

        private void ws() {
            while (pos < len) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                    pos++;
                } else {
                    break;
                }
            }
        }

        private static int hex(char c) {
            if (c >= '0' && c <= '9') {
                return c - '0';
            }
            if (c >= 'a' && c <= 'f') {
                return c - 'a' + 10;
            }
            if (c >= 'A' && c <= 'F') {
                return c - 'A' + 10;
            }
            return -1;
        }

        private String string() {
            pos++; // opening quote
            StringBuilder b = new StringBuilder();
            while (pos < len) {
                char c = s.charAt(pos++);
                if (c == '"') {
                    return b.toString();
                }
                if (c == '\\') {
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"' -> b.append('"');
                        case '\\' -> b.append('\\');
                        case '/' -> b.append('/');
                        case 'b' -> b.append('\b');
                        case 'f' -> b.append('\f');
                        case 'n' -> b.append('\n');
                        case 'r' -> b.append('\r');
                        case 't' -> b.append('\t');
                        case 'u' -> {
                            int h = 0;
                            for (int i = 0; i < 4; i++) {
                                h = (h << 4) | hex(s.charAt(pos + i));
                            }
                            pos += 4;
                            if (h >= 0xD800 && h <= 0xDBFF && pos + 1 < len && s.charAt(pos) == '\\' && s.charAt(pos + 1) == 'u') {
                                int lo = 0;
                                for (int i = 0; i < 4; i++) {
                                    lo = (lo << 4) | hex(s.charAt(pos + 2 + i));
                                }
                                b.appendCodePoint(0x10000 + ((h - 0xD800) << 10) + (lo - 0xDC00));
                                pos += 6;
                            } else {
                                b.append((char) h);
                            }
                        }
                        default -> throw new IllegalStateException("bad escape");
                    }
                } else {
                    b.append(c);
                }
            }
            throw new IllegalStateException("unterminated string");
        }

        private Object value() {
            ws();
            char c = s.charAt(pos);
            if (c == '{') {
                pos++;
                Map<String, Object> map = new LinkedHashMap<>();
                ws();
                if (s.charAt(pos) == '}') {
                    pos++;
                    return map;
                }
                for (;;) {
                    ws();
                    String key = string();
                    ws();
                    pos++; // colon
                    map.put(key, value());
                    ws();
                    if (s.charAt(pos) == ',') {
                        pos++;
                        continue;
                    }
                    pos++; // }
                    return map;
                }
            }
            if (c == '[') {
                pos++;
                List<Object> list = new ArrayList<>();
                ws();
                if (s.charAt(pos) == ']') {
                    pos++;
                    return list;
                }
                for (;;) {
                    list.add(value());
                    ws();
                    if (s.charAt(pos) == ',') {
                        pos++;
                        continue;
                    }
                    pos++; // ]
                    return list;
                }
            }
            if (c == '"') {
                return string();
            }
            if (c == 't') {
                pos += 4;
                return Boolean.TRUE;
            }
            if (c == 'f') {
                pos += 5;
                return Boolean.FALSE;
            }
            if (c == 'n') {
                pos += 4;
                return null;
            }
            int start = pos;
            if (s.charAt(pos) == '-') {
                pos++;
            }
            while (pos < len) {
                char d = s.charAt(pos);
                if ((d >= '0' && d <= '9') || d == '.' || d == 'e' || d == 'E' || d == '+' || d == '-') {
                    pos++;
                } else {
                    break;
                }
            }
            return Double.parseDouble(s.substring(start, pos));
        }
    }

    @SuppressWarnings("unchecked")
    private static Object jget(Object obj, String key) {
        return obj instanceof Map<?, ?> map ? ((Map<String, Object>) map).get(key) : null;
    }

    private static boolean jhas(Object obj, String key) {
        return obj instanceof Map<?, ?> map && map.containsKey(key);
    }

    private static String jstr(Object v) {
        return v instanceof String s ? s : null;
    }
    // #endregion

    // #region matching
    private static boolean deonMatches(Object value, Object want) {
        if (want instanceof String s) {
            return value instanceof String v && v.equals(s);
        }
        if (want instanceof List<?> list) {
            if (!(value instanceof List<?> v) || v.size() != list.size()) {
                return false;
            }
            for (int i = 0; i < list.size(); i++) {
                if (!deonMatches(v.get(i), list.get(i))) {
                    return false;
                }
            }
            return true;
        }
        if (want instanceof Map<?, ?> map) {
            if (!(value instanceof DeonMap v) || v.size() != map.size()) {
                return false;
            }
            for (Map.Entry<?, ?> e : map.entrySet()) {
                if (!v.has((String) e.getKey()) || !deonMatches(v.get((String) e.getKey()), e.getValue())) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    private static boolean typedMatches(Object value, Object want) {
        if (want instanceof Boolean b) {
            return value instanceof Boolean v && v.equals(b);
        }
        if (want instanceof Double d) {
            if (value instanceof Boolean) {
                return false;
            }
            return value instanceof Double v && (v.equals(d) || Math.abs(v - d) < 1e-9);
        }
        if (want instanceof String s) {
            return value instanceof String v && v.equals(s);
        }
        if (want instanceof List<?> list) {
            if (!(value instanceof List<?> v) || v.size() != list.size()) {
                return false;
            }
            for (int i = 0; i < list.size(); i++) {
                if (!typedMatches(v.get(i), list.get(i))) {
                    return false;
                }
            }
            return true;
        }
        if (want instanceof Map<?, ?> map) {
            if (!(value instanceof DeonMap v) || v.size() != map.size()) {
                return false;
            }
            for (Map.Entry<?, ?> e : map.entrySet()) {
                if (!v.has((String) e.getKey()) || !typedMatches(v.get((String) e.getKey()), e.getValue())) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    // #endregion

    // #region options
    @SuppressWarnings("unchecked")
    private static Map<String, String> toStringMap(Object v) {
        Map<String, String> out = new LinkedHashMap<>();
        if (v instanceof Map<?, ?> map) {
            for (Map.Entry<String, Object> e : ((Map<String, Object>) map).entrySet()) {
                if (e.getValue() instanceof String s) {
                    out.put(e.getKey(), s);
                }
            }
        }
        return out;
    }

    private static List<String> toStringList(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof String s) {
                    out.add(s);
                }
            }
        }
        return out;
    }

    private static String sourceOf(Object c) {
        String file = jstr(jget(c, "file"));
        if (file != null) {
            Object files = jget(c, "files");
            return jstr(jget(files, file));
        }
        String source = jstr(jget(c, "source"));
        return source == null ? "" : source;
    }

    private static ParseOptions optionsOf(Object c) {
        ParseOptions o = new ParseOptions();
        Object files = jget(c, "files");
        if (files != null) {
            o.resources = toStringMap(files);
        }
        String file = jstr(jget(c, "file"));
        if (file != null) {
            o.sourceName = file;
            int slash = file.lastIndexOf('/');
            o.filebase = slash < 0 ? "" : file.substring(0, slash);
        }
        Object environment = jget(c, "environment");
        if (environment != null) {
            o.environment = toStringMap(environment);
        }
        Object datasign = jget(c, "datasign");
        if (datasign != null) {
            o.datasignFiles = toStringList(jget(datasign, "files"));
            o.datasignMap = toStringMap(jget(datasign, "map"));
        }
        Object opts = jget(c, "options");
        if (opts instanceof Map<?, ?>) {
            Object ap = jget(opts, "absolutePaths");
            if (ap != null) {
                o.absolutePaths = toStringMap(ap);
            }
            if (Boolean.TRUE.equals(jget(opts, "allowFilesystem"))) {
                o.allowFilesystem = true;
            }
            if (Boolean.TRUE.equals(jget(opts, "allowNetwork"))) {
                o.allowNetwork = true;
            }
            String sn = jstr(jget(opts, "sourceName"));
            if (sn != null) {
                o.sourceName = sn;
            }
            String fb = jstr(jget(opts, "filebase"));
            if (fb != null) {
                o.filebase = fb;
            }
        }
        return o;
    }
    // #endregion

    private static final class Checked {
        int expected, errored, position, canonical, stringify, typed, lint, datasign;
    }

    private static boolean matchError(Object c, DeonException e, String id, Checked did) {
        String want = jstr(jget(c, "error"));
        if (!e.code.wire().equals(want)) {
            fail(id, "expected " + want + ", got " + e.code.wire());
            return false;
        }
        did.errored++;
        Object pos = jget(c, "position");
        if (pos instanceof Map<?, ?>) {
            int wantLine = ((Double) jget(pos, "line")).intValue();
            int wantColumn = ((Double) jget(pos, "column")).intValue();
            Diagnostic d = e.primary();
            if (d.span.line != wantLine || d.span.column != wantColumn) {
                fail(id, want + " expected at " + wantLine + ":" + wantColumn + ", reported at " + d.span.line + ":" + d.span.column);
                return false;
            }
            did.position++;
        }
        return true;
    }

    private static StringifyOptions stringifyOptionsOf(Object opts) {
        StringifyOptions o = StringifyOptions.defaults();
        if (!(opts instanceof Map<?, ?>)) {
            return o;
        }
        if (jhas(opts, "canonical")) {
            o.canonical = Boolean.TRUE.equals(jget(opts, "canonical"));
        }
        if (jhas(opts, "readable")) {
            o.readable = Boolean.TRUE.equals(jget(opts, "readable"));
        }
        if (jhas(opts, "leaflinks")) {
            o.leaflinks = Boolean.TRUE.equals(jget(opts, "leaflinks"));
        }
        if (jhas(opts, "leaflinkShortening")) {
            o.leaflinkShortening = Boolean.TRUE.equals(jget(opts, "leaflinkShortening"));
        }
        if (jhas(opts, "generatedHeader")) {
            o.generatedHeader = Boolean.TRUE.equals(jget(opts, "generatedHeader"));
        }
        if (jhas(opts, "generatedComments")) {
            o.generatedComments = Boolean.TRUE.equals(jget(opts, "generatedComments"));
        }
        if (jget(opts, "indentation") instanceof Double d) {
            o.indentation = d.intValue();
        }
        if (jget(opts, "leaflinkLevel") instanceof Double d) {
            o.leaflinkLevel = d.intValue();
        }
        return o;
    }

    private static void runCase(Object c, Checked did) {
        String id = jstr(jget(c, "id"));
        String source = sourceOf(c);
        ParseOptions options = optionsOf(c);
        Object datasign = jget(c, "datasign");
        String error = jstr(jget(c, "error"));

        if (datasign != null) {
            try {
                Object value = Deon.parseWith(source, options);
                if (error != null) {
                    fail(id, "expected " + error + ", but it typed successfully");
                    return;
                }
                Object want = jget(datasign, "typed");
                if (!typedMatches(value, want)) {
                    fail(id, "datasign: value does not match");
                } else {
                    did.datasign++;
                }
            } catch (DeonException e) {
                if (error == null) {
                    fail(id, "datasign: " + e.code.wire());
                } else if (matchError(c, e, id, did)) {
                    did.datasign++;
                }
            }
            return;
        }

        if (error != null) {
            try {
                Deon.parseWith(source, options);
                fail(id, "expected " + error + ", but it evaluated");
            } catch (DeonException e) {
                matchError(c, e, id, did);
            }
            return;
        }

        boolean asserted = false;

        if (jhas(c, "expected")) {
            try {
                Object value = Deon.parseWith(source, options);
                if (!deonMatches(value, jget(c, "expected"))) {
                    fail(id, "value does not match expected");
                } else {
                    did.expected++;
                    asserted = true;
                }
            } catch (DeonException e) {
                fail(id, "expected a value, got " + e.code.wire());
            }
        }

        if (jget(c, "canonical") instanceof String canonical) {
            try {
                Object value = Deon.parseWith(source, options);
                if (!Deon.canonical(value).equals(canonical)) {
                    fail(id, "canonical mismatch");
                } else {
                    did.canonical++;
                    asserted = true;
                }
            } catch (DeonException e) {
                fail(id, "canonical: " + e.code.wire());
            }
        }

        Object stringify = jget(c, "stringify");
        if (stringify instanceof Map<?, ?>) {
            try {
                Object value = Deon.parseWith(source, options);
                String got = Deon.stringify(value, stringifyOptionsOf(jget(stringify, "options")));
                if (!got.equals(jstr(jget(stringify, "expected")))) {
                    fail(id, "stringify mismatch");
                } else {
                    did.stringify++;
                    asserted = true;
                }
            } catch (DeonException e) {
                fail(id, "stringify: " + e.code.wire());
            }
        }

        if (jhas(c, "typed")) {
            try {
                Object value = Deon.parseWith(source, options);
                if (!typedMatches(Deon.typed(value), jget(c, "typed"))) {
                    fail(id, "typed does not match");
                } else {
                    did.typed++;
                    asserted = true;
                }
            } catch (DeonException e) {
                fail(id, "typed: " + e.code.wire());
            }
        }

        Object lint = jget(c, "lint");
        if (lint instanceof List<?> wanted) {
            List<Diagnostic> produced = Deon.lint(source, options.sourceName == null || options.sourceName.isEmpty() ? "<memory>" : options.sourceName);
            boolean all = true;
            for (Object w : wanted) {
                boolean found = false;
                for (Diagnostic d : produced) {
                    if (d.code.wire().equals(w)) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    fail(id, "expected lint " + w);
                    all = false;
                    break;
                }
            }
            if (all) {
                did.lint++;
                asserted = true;
            }
        }

        if (!asserted) {
            fail(id, "the fixture asserts nothing");
        }
    }

    private static void roundTrip(Object c) {
        String id = jstr(jget(c, "id"));
        if (jhas(c, "error") || jhas(c, "feature")) {
            return;
        }
        try {
            Object value = Deon.parseWith(sourceOf(c), optionsOf(c));
            Object again = Deon.parse(Deon.canonical(value));
            if (!deon.Deon.canonical(again).equals(deon.Deon.canonical(value))) {
                fail(id, "parse(canonical(v)) != v");
            }
        } catch (DeonException e) {
            // a case that does not evaluate cleanly is not a round-trip subject
        }
    }

    private static void invariants() {
        // a rewritten key stringifies at its final write position (section 5)
        Object v = Deon.parse("{ a one\nb two\na three }");
        String got = Deon.stringify(v, StringifyOptions.defaults());
        if (!got.equals("{\n    b two\n    a three\n}\n")) {
            fail("rewritten-key", "got " + got);
        }
        // a column counts code points, not bytes
        try {
            Deon.parse("{\n    ключ value\n}\n");
            fail("column-code-points", "expected an error");
        } catch (DeonException e) {
            if (e.primary().span.line != 2 || e.primary().span.column != 5) {
                fail("column-code-points", "expected 2:5, got " + e.primary().span.line + ":" + e.primary().span.column);
            }
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        String raw = Files.readString(Path.of(MANIFEST));
        Object manifest = Json.parse(raw);
        List<Object> cases = (List<Object>) jget(manifest, "cases");

        Checked did = new Checked();
        Checked want = new Checked();
        int ran = 0;
        for (Object c : cases) {
            String feature = jstr(jget(c, "feature"));
            if (feature != null && !feature.equals("datasign")) {
                continue;
            }
            ran++;
            if (jhas(c, "expected")) {
                want.expected++;
            }
            if (jhas(c, "error")) {
                want.errored++;
            }
            if (jhas(c, "position")) {
                want.position++;
            }
            if (jhas(c, "canonical")) {
                want.canonical++;
            }
            if (jhas(c, "stringify")) {
                want.stringify++;
            }
            if (jhas(c, "typed")) {
                want.typed++;
            }
            if (jhas(c, "lint")) {
                want.lint++;
            }
            if (jhas(c, "datasign")) {
                want.datasign++;
            }
            runCase(c, did);
            roundTrip(c);
        }

        invariants();

        // the coverage counters must equal what the manifest declares
        if (did.expected != want.expected || did.errored != want.errored || did.position != want.position
                || did.canonical != want.canonical || did.stringify != want.stringify || did.typed != want.typed
                || did.lint != want.lint || did.datasign != want.datasign) {
            System.err.printf("coverage mismatch:%n  checked:  expected=%d errored=%d position=%d canonical=%d stringify=%d typed=%d lint=%d datasign=%d%n  declared: expected=%d errored=%d position=%d canonical=%d stringify=%d typed=%d lint=%d datasign=%d%n",
                    did.expected, did.errored, did.position, did.canonical, did.stringify, did.typed, did.lint, did.datasign,
                    want.expected, want.errored, want.position, want.canonical, want.stringify, want.typed, want.lint, want.datasign);
            failures++;
        }

        if (failures == 0) {
            System.out.println("all " + ran + " conformance cases passed (code and position)");
            return;
        }
        System.err.println("\n" + failures + " failure(s) across " + ran + " cases");
        System.exit(1);
    }
}
