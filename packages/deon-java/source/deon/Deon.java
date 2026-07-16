package deon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * The public surface of the Java implementation of Deon.
 *
 * A Deon value is exactly one of three things — a {@link String}, an ordered {@code List<Object>}, or a
 * {@link DeonMap}. There is no null, no boolean, and no number in the data model; {@link Boolean} and
 * {@link Double} appear only as the output of the conservative typer (specification 14), which is a view
 * of a value rather than a value.
 *
 * Everything is synchronous: Java's file and network reads block, so a caller who wants a parse off the
 * current thread already has the way to say so, and an asynchronous API would buy nothing.
 */
public final class Deon {
    /** The release of the specification this implementation tracks; every implementation prints the same. */
    public static final String VERSION = "0.0.0-11";

    private Deon() {
    }

    /** Reads a document, granted nothing. A document that imports is denied — a diagnostic, not a surprise. */
    public static Object parse(String source) {
        return parseWith(source, new ParseOptions());
    }

    /** Reads a document with the capabilities and surroundings the caller decides. */
    public static Object parseWith(String source, ParseOptions options) {
        options = new ParseOptions(options);  // a copy: this parse never writes back into the caller's options
        DocumentAst doc = new Parser(source, options.sourceName()).parseDocument();
        options.sourceName = options.sourceName();
        Object root = Interpreter.evaluate(doc, options);
        return Datasign.sign(root, options);
    }

    /** Reads a file, which grants the filesystem to it and to what it imports. Naming a file is the grant. */
    public static Object parseFile(String pathname, ParseOptions options) {
        options = new ParseOptions(options);  // a copy: naming a file grants the filesystem here, not to the caller's options
        byte[] data;
        try {
            data = Files.readAllBytes(Path.of(pathname));
        } catch (IOException e) {
            throw new DeonException(Code.RESOURCE_IO, "Unable to read '" + pathname + "'.", Span.head(pathname));
        }
        options.sourceName = pathname;
        options.filebase = directoryOf(pathname);
        options.allowFilesystem = true;
        return parseWith(new String(data, StandardCharsets.UTF_8), options);
    }

    /** Reads a document as text, turning a failure into a diagnostic rather than a host exception. */
    public static String readFile(String pathname) {
        byte[] data;
        try {
            data = Files.readAllBytes(Path.of(pathname));
        } catch (IOException e) {
            throw new DeonException(Code.RESOURCE_IO, "Unable to read '" + pathname + "'.", Span.head(pathname));
        }
        if (!Interpreter.isValidUtf8(data)) {
            throw new DeonException(Code.RESOURCE_IO, "Unable to read '" + pathname + "': the file is not valid UTF-8.", Span.head(pathname));
        }
        return new String(data, StandardCharsets.UTF_8);
    }

    /** Converts JSON to a Deon value, preserving each number's source spelling (specification 9.1). */
    public static Object readJson(String data, String sourceName) {
        return JsonReader.read(data, Span.head(sourceName));
    }

    /** Fetches a Deon document from a URL and evaluates it. The network must be granted. */
    public static Object parseLink(String link, ParseOptions options) {
        options = new ParseOptions(options);  // a copy: the fetched document's name and base settle here, not in the caller's options
        if (!options.allowNetwork) {
            throw new DeonException(Code.CAPABILITY_DENIED, "'" + link + "' was not fetched: network access is not allowed.", Span.head(link));
        }
        String data = Network.httpGet(link, "link", options.token, Span.head(link));
        options.sourceName = link;
        options.filebase = Interpreter.directoryOf(link);
        return parseWith(data, options);
    }

    /** Parses without evaluating, so nothing is loaded and nothing is reached. */
    public static void parseSyntax(String source, String sourceName) {
        new Parser(source, sourceName).parseDocument();
    }

    /** The diagnostics a document carries without throwing: what is legal and questionable. */
    public static List<Diagnostic> lint(String source, String sourceName) {
        DocumentAst doc;
        try {
            doc = new Parser(source, sourceName).parseDocument();
        } catch (DeonException e) {
            return List.of();
        }
        return Linter.lint(doc);
    }

    /** What a document declares, without evaluating it: it parses and reaches nothing. */
    public static List<Entity> entities(String source, String sourceName) {
        DocumentAst doc = new Parser(source, sourceName).parseDocument();
        List<Entity> found = new ArrayList<>();
        for (Declaration decl : doc.declarations) {
            if (decl.kind != Declaration.Kind.LEAFLINK) {
                found.add(new Entity(decl.name, List.of(), "resource"));
            } else {
                List<String> parameters = new ArrayList<>(Interpreter.interpolationNames(decl.value));
                parameters.sort(String::compareTo);
                found.add(new Entity(decl.name, parameters, nodeKind(decl.value)));
            }
        }
        return found;
    }

    /** Writes a value back out. */
    public static String stringify(Object value, StringifyOptions options) {
        return Stringifier.stringify(value, options);
    }

    /** The one output every implementation agrees on, character for character (specification 13). */
    public static String canonical(Object value) {
        StringifyOptions options = StringifyOptions.defaults();
        options.canonical = true;
        options.readable = true;
        options.indentation = 4;
        return Stringifier.stringify(value, options);
    }

    /** The conservative typer's view of a value (specification 14). */
    public static Object typed(Object value) {
        return Typer.type(value);
    }

    private static String nodeKind(Node n) {
        if (n instanceof MapNode) {
            return "map";
        }
        if (n instanceof ListNode) {
            return "list";
        }
        if (n instanceof StructureNode) {
            return "structure";
        }
        if (n instanceof LinkNode) {
            return "link";
        }
        if (n instanceof CallNode) {
            return "call";
        }
        return "scalar";
    }

    private static String directoryOf(String path) {
        int last = path.lastIndexOf('/');
        if (last < 0) {
            return ".";
        }
        if (last == 0) {
            return "/";
        }
        return path.substring(0, last);
    }
}
