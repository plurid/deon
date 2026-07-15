package deon;

import java.util.List;

/**
 * A Deon diagnostic, raised. This is the Java analogue of the reference's thrown error: {@link
 * Deon#fail} builds one and throws, and a boundary catches it, turning it into the error a caller sees.
 * Nothing but a Deon diagnostic is raised this way — a genuine host failure is a different exception and
 * is not caught here, because a bug must not be able to masquerade as a bad document.
 */
public final class DeonException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public final Code code;
    public final List<Diagnostic> diagnostics;

    public DeonException(Code code, String message, Span span) {
        this(code, List.of(new Diagnostic(code, message, span)));
    }

    public DeonException(Code code, List<Diagnostic> diagnostics) {
        super(diagnostics.isEmpty() ? code.wire() : diagnostics.get(0).message);
        this.code = code;
        this.diagnostics = diagnostics;
    }

    /** The primary diagnostic — the one an editor would underline. */
    public Diagnostic primary() {
        return diagnostics.get(0);
    }
}
