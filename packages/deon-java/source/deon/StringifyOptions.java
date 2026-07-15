package deon;

/**
 * How a value is written back out (specification 12). The zero value cannot tell "the caller wants
 * readable off" from "the caller passed nothing", so callers build from {@link #defaults()}.
 */
public final class StringifyOptions {
    public boolean canonical = false;
    public boolean readable = false;
    public int indentation = 4;
    public boolean leaflinks = false;
    public int leaflinkLevel = 1;
    public boolean leaflinkShortening = true;
    public boolean generatedHeader = false;
    public boolean generatedComments = false;

    public static StringifyOptions defaults() {
        StringifyOptions options = new StringifyOptions();
        options.readable = true;
        options.indentation = 4;
        options.leaflinkLevel = 1;
        options.leaflinkShortening = true;
        return options;
    }
}
