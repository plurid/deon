package deon;

import java.util.List;

/** Helpers over the untyped {@code Object} that a Deon value is. */
final class Values {
    private Values() {
    }

    /**
     * Deep equality over Deon values: maps by lookup (order is presentation), lists positionally,
     * strings and typer scalars by value.
     */
    static boolean equal(Object a, Object b) {
        if (a instanceof String && b instanceof String) {
            return a.equals(b);
        }
        if (a instanceof Boolean && b instanceof Boolean) {
            return a.equals(b);
        }
        if (a instanceof Double && b instanceof Double) {
            return a.equals(b);
        }
        if (a instanceof List<?> la && b instanceof List<?> lb) {
            if (la.size() != lb.size()) {
                return false;
            }
            for (int i = 0; i < la.size(); i++) {
                if (!equal(la.get(i), lb.get(i))) {
                    return false;
                }
            }
            return true;
        }
        if (a instanceof DeonMap ma && b instanceof DeonMap mb) {
            return ma.equals(mb);
        }
        return false;
    }
}
