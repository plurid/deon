package tests;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import deon.Deon;
import deon.DeonMap;
import deon.ParseOptions;

/**
 * A caller's {@link ParseOptions} is theirs. Every parse settles its source name, base, and grants on a
 * copy and never writes them back into the instance the caller still holds — so an object reused for a
 * later parse the caller meant to sandbox does not silently inherit a filesystem grant (specification 9).
 * The network path (parseLink) is covered by NetworkTest, over the loopback server it already stands up.
 */
public final class OptionsTest {
    private static int failures = 0;

    private static void check(boolean ok, String what) {
        if (ok) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    public static void main(String[] args) throws Exception {
        // parseWith names the document "<memory>" internally; the caller's blank name must survive it.
        ParseOptions withOpts = new ParseOptions();
        Object v1 = Deon.parseWith("{ a one }", withOpts);
        check(v1 instanceof DeonMap m && "one".equals(m.get("a")), "parseWith evaluates the document");
        check(withOpts.sourceName.isEmpty(), "parseWith leaves the caller's sourceName untouched");
        check(!withOpts.allowFilesystem, "parseWith leaves the caller's grants untouched");

        // parseFile: naming a file grants the filesystem to the parse, never to the caller's options.
        Path file = Files.createTempFile("deon-options-test", ".deon");
        try {
            Files.write(file, "{ a one }".getBytes(StandardCharsets.UTF_8));

            ParseOptions fileOpts = new ParseOptions();  // allowFilesystem == false, the safe default
            Object v2 = Deon.parseFile(file.toString(), fileOpts);

            check(v2 instanceof DeonMap m && "one".equals(m.get("a")), "parseFile evaluates the document");
            // The headline: the grant went to a copy, not to the object the caller still holds.
            check(!fileOpts.allowFilesystem, "parseFile does not grant the filesystem to the caller's options");
            check(fileOpts.sourceName.isEmpty(), "parseFile does not rewrite the caller's sourceName");
            check(fileOpts.filebase.isEmpty(), "parseFile does not rewrite the caller's filebase");
        } finally {
            Files.deleteIfExists(file);
        }

        if (failures == 0) {
            System.out.println("\nall options-immutability cases passed");
            return;
        }
        System.err.println("\n" + failures + " options failure(s)");
        System.exit(1);
    }
}
