package deon;

import java.util.List;

/**
 * One thing a document has to say about itself. A code and a position are normative; the message is
 * prose and deliberately is not (spec/diagnostics.md fixes the code and the position and says nothing
 * about the sentence). The one warning is a repeated map key; everything else is an error.
 *
 * <p>{@code related} carries secondary source positions the reader is sent to — the other end of the
 * story the primary span underlines (spec/diagnostics.md line 3). It is empty unless a diagnostic has
 * a second place to point at.
 */
public final class Diagnostic implements java.io.Serializable {
    private static final long serialVersionUID = 1L;

    public final Code code;
    public final String message;
    public final Span span;
    public final String severity;
    public final List<Span> related;

    public Diagnostic(Code code, String message, Span span) {
        this(code, message, span, List.of());
    }

    public Diagnostic(Code code, String message, Span span, List<Span> related) {
        this.code = code;
        this.message = message;
        this.span = span;
        this.severity = code.severity();
        this.related = related;
    }
}
