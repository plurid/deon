package deon;

/**
 * The fifteen diagnostic codes, and there are no others (spec/diagnostics.md). The catalogue is
 * closed. Each carries its wire name — the string that appears in a fixture, a tool's output, and a
 * host's log — so the six implementations spell a fault the same way.
 */
public enum Code {
    LEX_UNTERMINATED("DEON_LEX_UNTERMINATED"),
    LEX_INVALID("DEON_LEX_INVALID"),
    PARSE_EXPECTED("DEON_PARSE_EXPECTED"),
    PARSE_ROOT("DEON_PARSE_ROOT"),
    DUPLICATE_DECLARATION("DEON_DUPLICATE_DECLARATION"),
    UNRESOLVED_LINK("DEON_UNRESOLVED_LINK"),
    CYCLE("DEON_CYCLE"),
    STRUCTURE_ARITY("DEON_STRUCTURE_ARITY"),
    ENTITY_ARGUMENT("DEON_ENTITY_ARGUMENT"),
    TYPE_MISMATCH("DEON_TYPE_MISMATCH"),
    CAPABILITY_DENIED("DEON_CAPABILITY_DENIED"),
    RESOURCE_IO("DEON_RESOURCE_IO"),
    RESOURCE_FORMAT("DEON_RESOURCE_FORMAT"),
    LIMIT_EXCEEDED("DEON_LIMIT_EXCEEDED"),
    LINT_DUPLICATE_KEY("DEON_LINT_DUPLICATE_KEY");

    private final String wire;

    Code(String wire) {
        this.wire = wire;
    }

    /** The wire name, as it appears in a fixture and a tool's output. */
    public String wire() {
        return wire;
    }

    /** Every code is an error except the one that is advice (spec/diagnostics.md). */
    public String severity() {
        return this == LINT_DUPLICATE_KEY ? "warning" : "error";
    }
}
