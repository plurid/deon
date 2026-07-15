package tests;

import java.util.ArrayList;
import java.util.List;

import deon.Code;
import deon.Deon;
import deon.DeonException;
import deon.DeonMap;
import deon.StringifyOptions;

/**
 * The nesting limit on a host-built value the parser never met (specification 11.1). A value nested
 * deeper than the parser would accept must fail the same way whether it arrives as text or is built by
 * hand: a {@link DeonException} carrying {@code DEON_PARSE_EXPECTED}, never a silent empty string and
 * never a {@link StackOverflowError}. Depth counts enclosing values, matching the parser's count.
 */
public final class DepthTest {
    private static int failures = 0;

    private static void check(boolean ok, String what) {
        if (ok) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    /** A map value nested {@code depth} enclosing values deep: {a {a {a ... x}}}. */
    private static Object nestMaps(int depth) {
        Object v = "x";
        for (int i = 0; i < depth; i++) {
            DeonMap m = new DeonMap();
            m.set("a", v);
            v = m;
        }
        return v;
    }

    /** A list value nested {@code depth} enclosing values deep: [[[ ... x]]]. */
    private static Object nestLists(int depth) {
        Object v = "x";
        for (int i = 0; i < depth; i++) {
            List<Object> l = new ArrayList<>();
            l.add(v);
            v = l;
        }
        return v;
    }

    private static boolean throwsExpected(Runnable r) {
        try {
            r.run();
            return false;
        } catch (DeonException e) {
            return e.code == Code.PARSE_EXPECTED;
        } catch (StackOverflowError e) {
            return false;
        }
    }

    public static void main(String[] args) {
        // ~130 enclosing values, past MAX_DEPTH = 128.
        Object deepMap = nestMaps(130);
        Object deepList = nestLists(130);

        StringifyOptions plain = StringifyOptions.defaults();

        check(throwsExpected(() -> Deon.stringify(deepMap, plain)), "stringify rejects a too-deep map");
        check(throwsExpected(() -> Deon.stringify(deepList, plain)), "stringify rejects a too-deep list");
        check(throwsExpected(() -> Deon.canonical(deepMap)), "canonical rejects a too-deep map");
        check(throwsExpected(() -> Deon.canonical(deepList)), "canonical rejects a too-deep list");
        check(throwsExpected(() -> Deon.typed(deepMap)), "typer rejects a too-deep map");
        check(throwsExpected(() -> Deon.typed(deepList)), "typer rejects a too-deep list");

        // A shallow value still writes and types without complaint.
        DeonMap shallow = new DeonMap();
        shallow.set("greeting", "hello");
        shallow.set("count", "007");

        boolean shallowOk;
        try {
            String out = Deon.stringify(shallow, plain);
            String canon = Deon.canonical(shallow);
            Object typed = Deon.typed(shallow);
            shallowOk = out.contains("greeting")
                    && canon.contains("greeting")
                    && typed instanceof DeonMap m
                    && "007".equals(m.get("count")); // 007 stays a string
        } catch (Throwable t) {
            shallowOk = false;
        }
        check(shallowOk, "a shallow value still writes, canonicalizes, and types");

        if (failures == 0) {
            System.out.println("\nall depth cases passed");
            return;
        }
        System.err.println("\n" + failures + " depth failure(s)");
        System.exit(1);
    }
}
