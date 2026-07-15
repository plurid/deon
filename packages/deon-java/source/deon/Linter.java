package deon;

import java.util.ArrayList;
import java.util.List;

/**
 * Linting reports what is legal but questionable, and never throws (spec/diagnostics.md). The one
 * warning is a directly repeated explicit map key (specification 5): the language allows it and
 * last-write-wins, but it is almost always a mistake. A key replaced by a spread does not warn — that is
 * how a document composed from others is meant to work.
 */
final class Linter {
    static List<Diagnostic> lint(DocumentAst doc) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        if (doc.hasRoot) {
            lintNode(doc.root, diagnostics);
        }
        for (Declaration d : doc.declarations) {
            if (d.kind == Declaration.Kind.LEAFLINK) {
                lintNode(d.value, diagnostics);
            }
        }
        return diagnostics;
    }

    private static void lintNode(Node n, List<Diagnostic> diagnostics) {
        if (n == null) {
            return;
        }
        if (n instanceof MapNode map) {
            for (int i = 0; i < map.entries.size(); i++) {
                MapEntry entry = map.entries.get(i);
                if (entry.spread != null) {
                    continue;
                }
                boolean seen = false;
                for (int j = 0; j < i; j++) {
                    MapEntry prior = map.entries.get(j);
                    if (prior.spread == null && prior.key.equals(entry.key)) {
                        seen = true;
                        break;
                    }
                }
                if (seen) {
                    // This message reaches `deon lint`'s standard output, which the cross-implementation
                    // CLI harness compares character for character.
                    diagnostics.add(new Diagnostic(Code.LINT_DUPLICATE_KEY,
                            "Map key '" + entry.key + "' is written more than once.", entry.keySpan));
                }
                if (entry.hasValue) {
                    lintNode(entry.value, diagnostics);
                }
            }
        } else if (n instanceof ListNode list) {
            for (ListItem item : list.items) {
                if (item.value != null) {
                    lintNode(item.value, diagnostics);
                }
            }
        } else if (n instanceof StructureNode structure) {
            for (List<Node> row : structure.rows) {
                for (Node cell : row) {
                    lintNode(cell, diagnostics);
                }
            }
        }
    }
}
