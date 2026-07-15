package deon;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * The conservative typer (specification 14). Typing is outside the Deon data model, so this is a view of
 * a value rather than a value: it converts only what it could write back out unchanged, and refuses
 * whenever a guess could be wrong. {@code 007} stays a string, because a postal code that becomes 7 is a
 * bug; {@code null} stays {@code "null"}, because Deon has no null; a number too large for a double
 * stays a string, because a double would hand back a different number than the one written.
 */
final class Typer {
    private static final double SAFE_INTEGER = 9007199254740991.0; // 2^53 - 1

    static Object type(Object value) {
        if (!guardDepth(value)) {
            throw new DeonException(
                    Code.PARSE_EXPECTED,
                    "The value nests more deeply than Deon will type.",
                    Span.head("<value>"));
        }
        return typeNode(value);
    }

    private static Object typeNode(Object value) {
        if (value instanceof String s) {
            return typeScalar(s);
        }
        if (value instanceof List<?> list) {
            List<Object> out = new ArrayList<>(list.size());
            for (Object item : list) {
                out.add(typeNode(item));
            }
            return out;
        }
        if (value instanceof DeonMap map) {
            DeonMap out = new DeonMap();
            for (String key : map.keys()) {
                out.set(key, typeNode(map.get(key)));
            }
            return out;
        }
        return value;
    }

    /** Enforce the nesting limit on a host-built value the parser never met (specification 11.1). */
    private static boolean guardDepth(Object root) {
        record Frame(Object value, int depth) {
        }
        Deque<Frame> stack = new ArrayDeque<>();
        stack.push(new Frame(root, 0));
        while (!stack.isEmpty()) {
            Frame f = stack.pop();
            if (f.depth() > Parser.MAX_DEPTH) {
                return false;
            }
            if (f.value() instanceof List<?> list) {
                for (Object item : list) {
                    stack.push(new Frame(item, f.depth() + 1));
                }
            } else if (f.value() instanceof DeonMap map) {
                for (String key : map.keys()) {
                    stack.push(new Frame(map.get(key), f.depth() + 1));
                }
            }
        }
        return true;
    }

    private static Object typeScalar(String s) {
        if (s.equals("true")) {
            return Boolean.TRUE;
        }
        if (s.equals("false")) {
            return Boolean.FALSE;
        }
        if (matchInteger(s)) {
            double n = Double.parseDouble(s);
            if (n >= -SAFE_INTEGER && n <= SAFE_INTEGER) {
                return n;
            }
            return s;
        }
        if (matchNumber(s)) {
            double n = Double.parseDouble(s);
            if (Double.isFinite(n)) {
                return n;
            }
            return s;
        }
        return s;
    }

    // -?(0|[1-9][0-9]*)
    private static boolean matchInteger(String s) {
        int i = 0;
        int n = s.length();
        if (i < n && s.charAt(i) == '-') {
            i++;
        }
        if (i >= n) {
            return false;
        }
        if (s.charAt(i) == '0') {
            return i + 1 == n;
        }
        if (s.charAt(i) < '1' || s.charAt(i) > '9') {
            return false;
        }
        while (i < n && s.charAt(i) >= '0' && s.charAt(i) <= '9') {
            i++;
        }
        return i == n;
    }

    // integer, an optional fraction, and an optional exponent
    private static boolean matchNumber(String s) {
        int i = 0;
        int n = s.length();
        if (i < n && s.charAt(i) == '-') {
            i++;
        }
        if (i >= n) {
            return false;
        }
        if (s.charAt(i) == '0') {
            i++;
        } else if (s.charAt(i) >= '1' && s.charAt(i) <= '9') {
            i++;
            while (i < n && s.charAt(i) >= '0' && s.charAt(i) <= '9') {
                i++;
            }
        } else {
            return false;
        }
        if (i < n && s.charAt(i) == '.') {
            i++;
            if (i >= n || s.charAt(i) < '0' || s.charAt(i) > '9') {
                return false;
            }
            while (i < n && s.charAt(i) >= '0' && s.charAt(i) <= '9') {
                i++;
            }
        }
        if (i < n && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
            i++;
            if (i < n && (s.charAt(i) == '+' || s.charAt(i) == '-')) {
                i++;
            }
            if (i >= n || s.charAt(i) < '0' || s.charAt(i) > '9') {
                return false;
            }
            while (i < n && s.charAt(i) >= '0' && s.charAt(i) <= '9') {
                i++;
            }
        }
        return i == n;
    }
}
