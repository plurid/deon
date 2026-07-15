package deon;

import java.util.ArrayList;
import java.util.List;

/**
 * JSON to a Deon value (specification 9.1). The one rule that is easy to get wrong: a number keeps its
 * source token spelling, so {@code 1.50} becomes the string {@code "1.50"} and not {@code "1.5"} —
 * reading it with a host's float would give the same file two different meanings depending on how it
 * arrived. A boolean becomes the string {@code "true"} or {@code "false"}, and null becomes the empty
 * string, because Deon has neither. This is hand-written, so the package needs no JSON decoder.
 */
final class JsonReader {
    private final String s;
    private final int len;
    private final Span at;
    private int pos;
    private int depth;

    private JsonReader(String s, Span at) {
        this.s = s;
        this.len = s.length();
        this.at = at;
    }

    static Object read(String data, Span at) {
        JsonReader r = new JsonReader(data, at);
        Object value = r.value();
        r.ws();
        if (r.pos != r.len) {
            r.fail();
        }
        return value;
    }

    private void fail() {
        throw new DeonException(Code.RESOURCE_FORMAT, "The resource is not valid JSON.", at);
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
        if (pos >= len || s.charAt(pos) != '"') {
            fail();
        }
        pos++;
        StringBuilder b = new StringBuilder();
        while (pos < len) {
            char c = s.charAt(pos++);
            if (c == '"') {
                return b.toString();
            }
            if (c == '\\') {
                if (pos >= len) {
                    fail();
                }
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
                        if (len - pos < 4) {
                            fail();
                        }
                        int h = 0;
                        for (int i = 0; i < 4; i++) {
                            int v = hex(s.charAt(pos + i));
                            if (v < 0) {
                                fail();
                            }
                            h = (h << 4) | v;
                        }
                        pos += 4;
                        // a surrogate pair for an astral code point
                        if (h >= 0xD800 && h <= 0xDBFF && len - pos >= 6 && s.charAt(pos) == '\\' && s.charAt(pos + 1) == 'u') {
                            int lo = 0;
                            boolean ok = true;
                            for (int i = 0; i < 4; i++) {
                                int v = hex(s.charAt(pos + 2 + i));
                                if (v < 0) {
                                    ok = false;
                                    break;
                                }
                                lo = (lo << 4) | v;
                            }
                            if (ok && lo >= 0xDC00 && lo <= 0xDFFF) {
                                b.appendCodePoint(0x10000 + ((h - 0xD800) << 10) + (lo - 0xDC00));
                                pos += 6;
                                break;
                            }
                        }
                        b.append((char) h);
                    }
                    default -> fail();
                }
            } else {
                b.append(c);
            }
        }
        fail();
        return null;
    }

    private Object value() {
        if (++depth > 512) {
            fail();
        }
        ws();
        if (pos >= len) {
            fail();
        }
        char c = s.charAt(pos);
        Object result;
        if (c == '{') {
            pos++;
            DeonMap map = new DeonMap();
            ws();
            if (pos < len && s.charAt(pos) == '}') {
                pos++;
                depth--;
                return map;
            }
            for (;;) {
                ws();
                String key = string();
                ws();
                if (pos >= len || s.charAt(pos) != ':') {
                    fail();
                }
                pos++;
                map.set(key, value()); // last write wins, key moves (section 5)
                ws();
                if (pos < len && s.charAt(pos) == ',') {
                    pos++;
                    continue;
                }
                if (pos < len && s.charAt(pos) == '}') {
                    pos++;
                    break;
                }
                fail();
            }
            result = map;
        } else if (c == '[') {
            pos++;
            List<Object> list = new ArrayList<>();
            ws();
            if (pos < len && s.charAt(pos) == ']') {
                pos++;
                depth--;
                return list;
            }
            for (;;) {
                list.add(value());
                ws();
                if (pos < len && s.charAt(pos) == ',') {
                    pos++;
                    continue;
                }
                if (pos < len && s.charAt(pos) == ']') {
                    pos++;
                    break;
                }
                fail();
            }
            result = list;
        } else if (c == '"') {
            result = string();
        } else if (c == 't') {
            if (len - pos < 4 || !s.startsWith("true", pos)) {
                fail();
            }
            pos += 4;
            result = "true";
        } else if (c == 'f') {
            if (len - pos < 5 || !s.startsWith("false", pos)) {
                fail();
            }
            pos += 5;
            result = "false";
        } else if (c == 'n') {
            if (len - pos < 4 || !s.startsWith("null", pos)) {
                fail();
            }
            pos += 4;
            result = "";
        } else if (c == '-' || (c >= '0' && c <= '9')) {
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
            if (pos == start || (pos == start + 1 && s.charAt(start) == '-')) {
                fail();
            }
            result = s.substring(start, pos); // the source token spelling, verbatim
        } else {
            fail();
            result = null;
        }
        depth--;
        return result;
    }
}
