package deon;

import java.util.List;

/**
 * The syntax tree. A document is a set of declarations and a root value; a value is one of six node
 * shapes. The tree is built by {@link Parser} and consumed by {@link Interpreter}, {@link Linter}, and
 * the entity query — none of which evaluate it, so all of them reach nothing and need no capability.
 */
sealed interface Node permits ScalarNode, MapNode, ListNode, StructureNode, LinkNode, CallNode {
    Span span();
}

/** One segment of a reference access path: a name (`.field`) or an index (`.0`). */
final class AccessSeg {
    final String name;
    final int index;
    final boolean byIndex;

    AccessSeg(String name, int index, boolean byIndex) {
        this.name = name;
        this.index = index;
        this.byIndex = byIndex;
    }
}

/** A reference: a head name (or `#$NAME` environment read) and an access path. */
final class Reference {
    boolean env;          // #$NAME
    String head = "";
    List<AccessSeg> access = List.of();
    Span span;
}

/** One piece of a scalar: literal text, or an interpolation to resolve. */
final class StringPart {
    final boolean isInterp;
    final String literal;
    final Reference interp;

    StringPart(String literal) {
        this.isInterp = false;
        this.literal = literal;
        this.interp = null;
    }

    StringPart(Reference interp) {
        this.isInterp = true;
        this.literal = null;
        this.interp = interp;
    }
}

final class ScalarNode implements Node {
    List<StringPart> parts;
    Span span;

    @Override
    public Span span() {
        return span;
    }
}

/** One map entry: a spread (`...#ref`), or a key and its value. */
final class MapEntry {
    Reference spread;     // non-null => ...#ref
    String key;
    Span keySpan;
    Node value;
    boolean hasValue;
}

final class MapNode implements Node {
    List<MapEntry> entries;
    Span span;

    @Override
    public Span span() {
        return span;
    }
}

final class ListItem {
    Reference spread;     // non-null => ...#ref
    Node value;
}

final class ListNode implements Node {
    List<ListItem> items;
    Span span;

    @Override
    public Span span() {
        return span;
    }
}

final class StructureNode implements Node {
    List<String> fields;
    List<List<Node>> rows;
    List<Span> rowSpans;
    Span span;

    @Override
    public Span span() {
        return span;
    }
}

final class LinkNode implements Node {
    Reference ref;
    Span span;

    @Override
    public Span span() {
        return span;
    }
}

final class CallArg {
    String name;
    Span nameSpan;
    Node value;
}

final class CallNode implements Node {
    Reference ref;
    List<CallArg> args;
    Span argsSpan;        // the opening '('
    Span span;

    @Override
    public Span span() {
        return span;
    }
}

/** A top-level declaration: a leaflink, an import, or an injection. */
final class Declaration {
    enum Kind { LEAFLINK, IMPORT, INJECT }

    Kind kind;
    String name;
    Span nameSpan;
    Span span;
    Node value;           // leaflink
    String target;        // import / inject
    Node authenticator;   // may be null
}

final class DocumentAst {
    List<Declaration> declarations;
    Node root;
    Span rootSpan;
    boolean hasRoot;
}
