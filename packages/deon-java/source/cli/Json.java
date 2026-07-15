package cli;

import java.util.List;

import deon.DeonMap;

/**
 * Writes a value as JSON in the shape {@code json.dumps(indent=4)} and {@code JSON.stringify(v, null, 4)}
 * both produce, so the tools' {@code -o json} output is one string across implementations. Maps keep
 * their write order — a sorted encoder would disagree — scalars in an untyped value stay strings, and a
 * typed value's booleans and numbers are written as JSON booleans and numbers.
 */
final class Json {
    private Json() {
    }

    static String encode(Object value, int level) {
        StringBuilder b = new StringBuilder();
        write(b, value, level);
        return b.toString();
    }

    private static void write(StringBuilder b, Object value, int level) {
        if (value instanceof String s) {
            string(b, s);
        } else if (value instanceof Boolean bool) {
            b.append(bool ? "true" : "false");
        } else if (value instanceof Double d) {
            if (d == Math.rint(d) && !d.isInfinite()) {
                b.append(Long.toString(d.longValue()));
            } else {
                b.append(d.toString());
            }
        } else if (value instanceof List<?> list) {
            if (list.isEmpty()) {
                b.append("[]");
                return;
            }
            b.append("[\n");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) {
                    b.append(",\n");
                }
                indent(b, level + 1);
                write(b, list.get(i), level + 1);
            }
            b.append('\n');
            indent(b, level);
            b.append(']');
        } else if (value instanceof DeonMap map) {
            List<String> keys = map.keys();
            if (keys.isEmpty()) {
                b.append("{}");
                return;
            }
            b.append("{\n");
            for (int i = 0; i < keys.size(); i++) {
                if (i > 0) {
                    b.append(",\n");
                }
                indent(b, level + 1);
                string(b, keys.get(i));
                b.append(": ");
                write(b, map.get(keys.get(i)), level + 1);
            }
            b.append('\n');
            indent(b, level);
            b.append('}');
        } else {
            b.append("null");
        }
    }

    private static void indent(StringBuilder b, int level) {
        b.append(" ".repeat(level * 4));
    }

    private static void string(StringBuilder b, String s) {
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
}
