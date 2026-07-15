package deon;

/**
 * Where a diagnostic points. {@code start} and {@code end} are UTF-8 byte offsets; {@code line} and
 * {@code column} are one-based and counted in Unicode code points. The two are different numbers, and
 * conflating them is the classic way to underline the wrong character.
 */
public final class Span implements java.io.Serializable {
    private static final long serialVersionUID = 1L;

    public final String source;
    public final int start;
    public final int end;
    public final int line;
    public final int column;
    public final int endLine;
    public final int endColumn;

    public Span(String source, int start, int end, int line, int column, int endLine, int endColumn) {
        this.source = source;
        this.start = start;
        this.end = end;
        this.line = line;
        this.column = column;
        this.endLine = endLine;
        this.endColumn = endColumn;
    }

    /** The span at the head of a source, for a diagnostic that has no finer position. */
    public static Span head(String source) {
        return new Span(source, 0, 0, 1, 1, 1, 1);
    }
}
