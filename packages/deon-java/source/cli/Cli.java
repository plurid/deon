package cli;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import deon.Deon;
import deon.DeonException;
import deon.DeonMap;
import deon.Diagnostic;
import deon.ParseOptions;
import deon.StringifyOptions;

/**
 * The `deon` command line tool. Its surface is the same as the JavaScript, Rust, Python, Go, and C
 * tools, command for command, and scripts/cli-harness.py holds the six to one behaviour. The defaults
 * are the tool's, not the library's: --output deon, --typed false, --filesystem TRUE, --network false.
 */
public final class Cli {
    private static final String USAGE = """
            Usage: deon <file> [options]
                   deon convert <source.json> [destination.deon]
                   deon environment <source.deon> <command...>
                   deon confile <files...> [--destination confile.deon]
                   deon exfile <source.deon> [--unsafe-paths]
                   deon lint <files...> [--warnings-as-errors]

            Options:
              -o, --output <deon|json>
              -t, --typed
              -f, --filesystem <true|false>
              -n, --network <true|false>
              -d, --destination <path>
              -w, --writeover
                  --unsafe-paths
                  --warnings-as-errors
              -v, --version
              -h, --help
            """;

    public static void main(String[] args) {
        System.exit(run(args));
    }

    private static int run(String[] args) {
        if (args.length == 0 || hasFlag(args, "-h", "--help")) {
            System.out.print(USAGE);
            return 0;
        }
        if (hasFlag(args, "-v", "--version")) {
            System.out.println(Deon.VERSION);
            return 0;
        }
        return switch (args[0]) {
            case "convert" -> convert(args);
            case "environment" -> environment(args);
            case "confile" -> confile(args);
            case "exfile" -> exfile(args);
            case "lint" -> lint(args);
            default -> evaluate(args);
        };
    }

    // #region argument parsing
    private static boolean hasFlag(String[] args, String a, String b) {
        for (String arg : args) {
            if (arg.equals(a) || (b != null && arg.equals(b))) {
                return true;
            }
        }
        return false;
    }

    private static String option(String[] args, String a, String b, String fallback) {
        for (int i = 0; i < args.length; i++) {
            if ((args[i].equals(a) || (b != null && args[i].equals(b))) && i + 1 < args.length) {
                return args[i + 1];
            }
        }
        return fallback;
    }

    private static boolean takesValue(String a) {
        return a.equals("-o") || a.equals("--output") || a.equals("-f") || a.equals("--filesystem")
                || a.equals("-n") || a.equals("--network") || a.equals("-d") || a.equals("--destination");
    }

    private static List<String> positional(String[] args, int from) {
        List<String> out = new ArrayList<>();
        boolean skip = false;
        for (int i = from; i < args.length; i++) {
            if (skip) {
                skip = false;
                continue;
            }
            if (takesValue(args[i])) {
                skip = true;
                continue;
            }
            if (args[i].startsWith("-")) {
                continue;
            }
            out.add(args[i]);
        }
        return out;
    }
    // #endregion

    // #region helpers
    private static String resolve(String path) {
        if (path.startsWith("/")) {
            return path;
        }
        return Path.of(System.getProperty("user.dir")).resolve(path).toString();
    }

    private static String dirOf(String path) {
        int last = path.lastIndexOf('/');
        if (last < 0) {
            return ".";
        }
        if (last == 0) {
            return "/";
        }
        return path.substring(0, last);
    }

    private static void printDiagnostics(DeonException e) {
        for (Diagnostic d : e.diagnostics) {
            System.err.printf("%s:%d:%d %s %s %s%n",
                    d.span.source == null ? "<memory>" : d.span.source, d.span.line, d.span.column,
                    d.severity, d.code.wire(), d.message);
        }
    }

    private static ParseOptions parseOptions(String[] args, String path) {
        ParseOptions o = new ParseOptions();
        o.sourceName = resolve(path);
        o.filebase = dirOf(o.sourceName);
        o.allowFilesystem = option(args, "-f", "--filesystem", "true").equals("true");
        o.allowNetwork = option(args, "-n", "--network", "false").equals("true");
        o.environment = System.getenv();
        return o;
    }
    // #endregion

    // #region commands
    private static int evaluate(String[] args) {
        String resolved = resolve(args[0]);
        String source;
        try {
            source = Files.readString(Path.of(resolved));
        } catch (IOException e) {
            System.err.printf("%s:1:1 error DEON_RESOURCE_IO Unable to read '%s'.%n", resolved, resolved);
            return 1;
        }
        try {
            Object value = Deon.parseWith(source, parseOptions(args, args[0]));
            if (option(args, "-o", "--output", "deon").equals("json")) {
                Object out = hasFlag(args, "-t", "--typed") ? Deon.typed(value) : value;
                System.out.println(Json.encode(out, 0));
            } else {
                System.out.print(Deon.stringify(value, StringifyOptions.defaults()));
            }
            return 0;
        } catch (DeonException e) {
            printDiagnostics(e);
            return 1;
        }
    }

    private static int convert(String[] args) {
        if (args.length < 2) {
            System.err.println("deon: convert requires a source file.");
            return 1;
        }
        String source = args[1];
        String data;
        try {
            data = Files.readString(Path.of(source));
        } catch (IOException e) {
            System.err.printf("deon: Unable to read '%s'.%n", source);
            return 1;
        }
        try {
            Object value = Deon.readJson(data, source);
            String written = Deon.stringify(value, StringifyOptions.defaults());
            List<String> dests = positional(args, 2);
            if (!dests.isEmpty()) {
                Files.writeString(Path.of(dests.get(0)), written);
            } else {
                System.out.print(written);
            }
            return 0;
        } catch (DeonException e) {
            printDiagnostics(e);
            return 1;
        } catch (IOException e) {
            System.err.printf("deon: Unable to write the destination.%n");
            return 1;
        }
    }

    private static int environment(String[] args) {
        if (args.length < 3) {
            System.err.println("deon: environment requires a source file and a command.");
            return 1;
        }
        Object value;
        try {
            value = Deon.parseFile(args[1], new ParseOptions());
        } catch (DeonException e) {
            printDiagnostics(e);
            return 1;
        }
        if (!(value instanceof DeonMap root)) {
            System.err.println("deon: An environment source must contain a root map.");
            return 1;
        }

        boolean writeover = hasFlag(args, "-w", "--writeover");
        List<String> command = new ArrayList<>();
        for (int i = 2; i < args.length; i++) {
            if (args[i].equals("-w") || args[i].equals("--writeover")) {
                continue;
            }
            command.add(args[i]);
        }
        if (command.isEmpty()) {
            System.err.println("deon: environment requires a command to run.");
            return 1;
        }

        ProcessBuilder builder = new ProcessBuilder(command).inheritIO();
        Map<String, String> env = builder.environment();
        for (String name : root.keys()) {
            String text = environValue(root.get(name));
            if (text == null) {
                continue;
            }
            if (writeover || !env.containsKey(name)) {
                env.put(name, text);
            }
        }
        try {
            return builder.start().waitFor();
        } catch (IOException e) {
            System.err.printf("deon: Unable to run '%s': %s%n", command.get(0), e.getMessage());
            return 1;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return 1;
        }
    }

    private static String environValue(Object item) {
        if (item instanceof String s) {
            return s;
        }
        if (item instanceof List<?> list) {
            List<String> parts = new ArrayList<>();
            for (Object part : list) {
                if (part instanceof String s) {
                    parts.add(s);
                }
            }
            return String.join(java.io.File.pathSeparator, parts);
        }
        return null;
    }

    private static int confile(String[] args) {
        String destination = option(args, "-d", "--destination", "confile.deon");
        List<String> files = new ArrayList<>();
        for (String file : positional(args, 1)) {
            if (!file.equals(destination)) {
                files.add(file);
            }
        }
        if (files.isEmpty()) {
            System.err.println("deon: confile requires at least one input file.");
            return 1;
        }
        DeonMap root = new DeonMap();
        for (String file : files) {
            String data;
            try {
                data = Files.readString(Path.of(file));
            } catch (IOException e) {
                System.err.printf("deon: Unable to read '%s'.%n", file);
                return 1;
            }
            DeonMap entry = new DeonMap();
            entry.set("data", data);
            root.set(file, entry); // keyed by the path as typed, so exfile puts it back
        }
        try {
            Files.writeString(Path.of(destination), Deon.stringify(root, StringifyOptions.defaults()));
            return 0;
        } catch (IOException e) {
            System.err.printf("deon: Unable to write '%s'.%n", destination);
            return 1;
        }
    }

    private static int exfile(String[] args) {
        if (args.length < 2) {
            System.err.println("deon: exfile requires a source file.");
            return 1;
        }
        boolean unsafe = hasFlag(args, "--unsafe-paths", null);
        Object value;
        try {
            value = Deon.parseFile(args[1], new ParseOptions());
        } catch (DeonException e) {
            printDiagnostics(e);
            return 1;
        }
        if (!(value instanceof DeonMap root)) {
            System.err.println("deon: An exfile source must contain a root map.");
            return 1;
        }

        // Every entry is checked before any is written, so a document with one bad path writes nothing.
        List<String[]> planned = new ArrayList<>();
        for (String path : root.keys()) {
            String data = exfileData(root.get(path));
            if (data == null) {
                System.err.printf("deon: Exfile entry '%s' must be a string or a map with a string data field.%n", path);
                return 1;
            }
            if (!unsafe && (path.startsWith("/") || escapes(path))) {
                System.err.printf("deon: Unsafe exfile path '%s'. Use --unsafe-paths to permit it.%n", path);
                return 1;
            }
            planned.add(new String[]{path, data});
        }
        for (String[] item : planned) {
            try {
                Path target = Path.of(item[0]);
                if (target.getParent() != null) {
                    Files.createDirectories(target.getParent());
                }
                Files.write(target, item[1].getBytes(StandardCharsets.UTF_8));
            } catch (IOException e) {
                System.err.printf("deon: Unable to write '%s'.%n", item[0]);
                return 1;
            }
        }
        return 0;
    }

    private static String exfileData(Object entry) {
        if (entry instanceof String s) {
            return s;
        }
        if (entry instanceof DeonMap map && map.get("data") instanceof String s) {
            return s;
        }
        return null;
    }

    private static boolean escapes(String path) {
        int depth = 0;
        for (String seg : path.split("/")) {
            if (seg.isEmpty() || seg.equals(".")) {
                continue;
            }
            if (seg.equals("..")) {
                depth--;
                if (depth < 0) {
                    return true;
                }
            } else {
                depth++;
            }
        }
        return false;
    }

    private static int lint(String[] args) {
        List<String> files = positional(args, 1);
        if (files.isEmpty()) {
            System.err.println("deon: lint requires at least one file.");
            return 1;
        }
        boolean warningsAreErrors = hasFlag(args, "--warnings-as-errors", null);
        boolean warned = false;

        for (String file : files) {
            String resolved = resolve(file);
            String source;
            try {
                source = Files.readString(Path.of(resolved));
            } catch (IOException e) {
                System.err.printf("%s:1:1 error DEON_RESOURCE_IO Unable to read '%s'.%n", resolved, resolved);
                return 1;
            }
            for (Diagnostic d : Deon.lint(source, resolved)) {
                warned = true;
                System.out.printf("%s:%d:%d %s %s %s%n",
                        resolved, d.span.line, d.span.column, d.severity, d.code.wire(), d.message);
            }
            try {
                Deon.parseWith(source, parseOptions(args, file));
            } catch (DeonException e) {
                printDiagnostics(e);
                return 1;
            }
        }
        return warned && warningsAreErrors ? 1 : 0;
    }
    // #endregion
}
