package tests;

import java.lang.reflect.Method;

import deon.Deon;
import deon.DeonMap;

/**
 * Large decimal and exponent numbers keep their value (specification 14). The conservative typer converts
 * a finite decimal/exponent form to its IEEE-754 binary64 value, and the harness adapter must write that
 * value back out without narrowing it through a signed 64-bit integer: {@code (long) 1e19} saturates to
 * {@code Long.MAX_VALUE} and would hand back a different number than the one typed. An integer spelled
 * beyond the 2^53 safe range still stays a string, because a double could not write it back unchanged.
 */
public final class NumberTest {
    private static int failures = 0;

    private static void check(boolean ok, String what) {
        if (ok) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    /** The typed value written under key {@code v} of a one-entry document. */
    private static Object typedValue(String source) {
        Object typed = Deon.typed(Deon.parse(source));
        return ((DeonMap) typed).get("v");
    }

    // Reach the harness adapter's private JSON marshaler by reflection — the exact code that narrowed a
    // large double through a long — so the regression is guarded where it actually occurred, not only at
    // the typer (whose value was already correct).
    private static Method marshalMethod;

    private static String marshal(Object value) {
        try {
            if (marshalMethod == null) {
                marshalMethod = Class.forName("harness.Harness").getDeclaredMethod("marshal", Object.class);
                marshalMethod.setAccessible(true);
            }
            return (String) marshalMethod.invoke(null, value);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    /** The raw numeric token the adapter writes for {@code v} in {@code { v <source token> }}. */
    private static String marshalledNumber(String source) {
        String json = marshal(Deon.typed(Deon.parse(source))); // {"v":<token>}
        return json.substring(json.indexOf(':') + 1, json.length() - 1);
    }

    public static void main(String[] args) {
        // The typer converts a decimal/exponent form to its true double value.
        check(typedValue("{ v 1e19 }") instanceof Double d && d == 1e19, "1e19 types to the double 1e19");
        check(typedValue("{ v 1e20 }") instanceof Double d && d == 1e20, "1e20 types to the double 1e20");
        check(typedValue("{ v -1e19 }") instanceof Double d && d == -1e19, "-1e19 types to the double -1e19");
        check(typedValue("{ v 1.5e300 }") instanceof Double d && d == 1.5e300, "1.5e300 types to the double 1.5e300");
        check(typedValue("{ v 1e308 }") instanceof Double d && d == 1e308, "1e308 types to the double 1e308");
        check(typedValue("{ v 9.2e18 }") instanceof Double d && d == 9.2e18, "9.2e18 types to the double 9.2e18");

        // An integer spelled beyond the 2^53 safe range stays a string.
        check("9007199254740993".equals(typedValue("{ v 9007199254740993 }")), "9007199254740993 stays a string");

        // The adapter writes each double back at its true value, never saturating through a long.
        for (Object[] probe : new Object[][] {
                {"{ v 1e19 }", 1e19},
                {"{ v 1e20 }", 1e20},
                {"{ v -1e19 }", -1e19},
                {"{ v 1.5e300 }", 1.5e300},
                {"{ v 1e308 }", 1e308},
                {"{ v 9.2e18 }", 9.2e18}, // in signed 64-bit range: must stay correct
        }) {
            String source = (String) probe[0];
            double want = (Double) probe[1];
            String token = marshalledNumber(source);
            boolean ok = !token.equals("9223372036854775807") && Double.parseDouble(token) == want;
            check(ok, source.trim() + " marshals to " + token + " (== " + want + ")");
        }

        if (failures == 0) {
            System.out.println("\nall number cases passed");
            return;
        }
        System.err.println("\n" + failures + " number failure(s)");
        System.exit(1);
    }
}
