package deon;

import java.util.ArrayList;
import java.util.List;

/**
 * A scannerless recursive-descent parser over the code-point stream. There is no separate token list:
 * Deon is context-sensitive — a {@code #} begins a link at a value position and is ordinary text inside
 * a word, a {@code .} navigates a reference and is ordinary inside an unquoted string — and a parser
 * that knows its context decides those without a lexer having to guess.
 */
final class Parser {
    static final int MAX_DEPTH = 128;

    private final int[] runes;
    private final int[] byteOff;
    private final int[] line;
    private final int[] col;
    private final int count;
    private final String sourceName;
    private int pos;
    private int depth;

    private Span nameSpan; // set by name(), read immediately after — the C out-parameter, in Java

    Parser(String text, String sourceName) {
        // CRLF folds to LF before anything else (section 4.1), so every offset indexes the normalized
        // source.
        StringBuilder norm = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
                continue;
            }
            norm.append(c);
        }
        int[] cps = norm.toString().codePoints().toArray();
        this.runes = cps;
        this.count = cps.length;
        this.byteOff = new int[count + 1];
        this.line = new int[count + 1];
        this.col = new int[count + 1];
        this.sourceName = sourceName;

        int off = 0;
        int ln = 1;
        int co = 1;
        for (int i = 0; i < count; i++) {
            byteOff[i] = off;
            line[i] = ln;
            col[i] = co;
            int r = cps[i];
            off += utf8Width(r);
            if (r == '\n') {
                ln++;
                co = 1;
            } else {
                co++;
            }
        }
        byteOff[count] = off;
        line[count] = ln;
        col[count] = co;
    }

    static int utf8Width(int cp) {
        if (cp < 0x80) {
            return 1;
        }
        if (cp < 0x800) {
            return 2;
        }
        if (cp < 0x10000) {
            return 3;
        }
        return 4;
    }

    // #region cursor
    private boolean atEnd() {
        return pos >= count;
    }

    private int peek() {
        return pos >= count ? 0 : runes[pos];
    }

    private int peekAt(int offset) {
        long i = (long) pos + offset;
        if (i < 0 || i >= count) {
            return 0;
        }
        return runes[(int) i];
    }

    private int advance() {
        int r = peek();
        pos++;
        return r;
    }

    private boolean startsWith(String prefix) {
        for (int i = 0; i < prefix.length(); i++) {
            if (peekAt(i) != prefix.charAt(i)) {
                return false;
            }
        }
        return true;
    }

    private Span spanAt(int position) {
        int at = Math.min(position, count);
        return new Span(sourceName, byteOff[at], byteOff[at], line[at], col[at], line[at], col[at]);
    }

    private Span point() {
        return spanAt(pos);
    }

    private Span spanBetween(int start, int end) {
        return new Span(sourceName, byteOff[start], byteOff[end], line[start], col[start], line[end], col[end]);
    }

    /** The raw normalized source spanned by runes [start, end). */
    private String slice(int start, int end) {
        return new String(runes, start, end - start);
    }
    // #endregion

    // #region character classes
    private static boolean isSpace(int r) {
        return r == ' ' || r == '\t';
    }

    private static boolean isNewline(int r) {
        return r == '\n';
    }

    private static boolean isDelimiter(int r) {
        return switch (r) {
            case '{', '}', '[', ']', '(', ')', '<', '>', '\'', '`' -> true;
            default -> false;
        };
    }

    private static boolean isHardDelimiter(int r) {
        return switch (r) {
            case '{', '}', '[', ']', '(', ')', '<', '>' -> true;
            default -> false;
        };
    }

    private static boolean wordStop(int r) {
        return r == 0 || isSpace(r) || isNewline(r) || r == ',' || isDelimiter(r);
    }

    private static boolean isNameChar(int r) {
        return (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')
                || (r >= '0' && r <= '9') || r == '_' || r == '-';
    }

    private static boolean isDigit(int r) {
        return r >= '0' && r <= '9';
    }
    // #endregion

    // #region trivia
    private void consumeLineComment() {
        advance();
        advance();
        while (!atEnd() && !isNewline(peek())) {
            advance();
        }
    }

    private void consumeBlockComment() {
        int start = pos;
        advance();
        advance();
        while (!atEnd()) {
            if (peek() == '*' && peekAt(1) == '/') {
                advance();
                advance();
                return;
            }
            advance();
        }
        throw fail(Code.LEX_UNTERMINATED, "A block comment was opened and never closed.", spanAt(start));
    }

    private void skipInline() {
        for (;;) {
            if (isSpace(peek())) {
                advance();
            } else if (startsWith("//")) {
                consumeLineComment();
            } else if (startsWith("/*")) {
                consumeBlockComment();
            } else {
                return;
            }
        }
    }

    private void skipTrivia() {
        for (;;) {
            if (isSpace(peek()) || isNewline(peek())) {
                advance();
            } else if (startsWith("//")) {
                consumeLineComment();
            } else if (startsWith("/*")) {
                consumeBlockComment();
            } else {
                return;
            }
        }
    }
    // #endregion

    private static DeonException fail(Code code, String message, Span span) {
        return new DeonException(code, message, span);
    }

    // #region names
    private String name() {
        int start = pos;
        if (peek() == '\'') {
            List<StringPart> parts = parseSingleString();
            nameSpan = spanBetween(start, pos);
            return literalOf(parts);
        }
        while (!wordStop(peek())) {
            advance();
        }
        if (pos == start) {
            throw fail(Code.PARSE_EXPECTED, "A name was expected here.", point());
        }
        // A bare word that is a valid string but not a valid name — a.b — is DEON_LEX_INVALID at the
        // start of the word, because what is wrong is the sequence, not the absence of something wanted.
        for (int i = start; i < pos; i++) {
            if (!isNameChar(runes[i])) {
                throw fail(Code.LEX_INVALID,
                        "This is not a valid name: a name is letters, digits, '_', and '-'.", spanAt(start));
            }
        }
        nameSpan = spanBetween(start, pos);
        return slice(start, pos);
    }

    private void requiredSpace() {
        if (!isSpace(peek())) {
            throw fail(Code.PARSE_EXPECTED, "A space was expected here.", point());
        }
        skipInline();
    }
    // #endregion

    // #region document
    private boolean consumedKeyword(String word) {
        for (int i = 0; i < word.length(); i++) {
            if (peekAt(i) != word.charAt(i)) {
                return false;
            }
        }
        if (!isSpace(peekAt(word.length()))) {
            return false;
        }
        pos += word.length();
        skipInline();
        return true;
    }

    private String targetWord() {
        skipInline();
        if (peek() == '\'') {
            return literalOf(parseSingleString());
        }
        int start = pos;
        while (!wordStop(peek())) {
            advance();
        }
        if (pos == start) {
            throw fail(Code.PARSE_EXPECTED, "An import or injection needs a target.", point());
        }
        return slice(start, pos);
    }

    private Declaration parseResource(Declaration.Kind kind, int start) {
        Declaration d = new Declaration();
        d.kind = kind;
        d.name = name();
        d.nameSpan = nameSpan;
        requiredSpace();
        if (!consumedKeyword("from")) {
            throw fail(Code.PARSE_EXPECTED, "An import or injection needs 'from' before its target.", point());
        }
        d.target = targetWord();

        int save = pos;
        skipInline();
        if (consumedKeyword("with")) {
            d.authenticator = parseValue();
        } else {
            pos = save;
        }
        d.span = spanBetween(start, pos);
        return d;
    }

    private Declaration parseLeaflink() {
        int start = pos;
        Declaration d = new Declaration();
        d.kind = Declaration.Kind.LEAFLINK;
        d.name = name();
        d.nameSpan = nameSpan;
        requiredSpace();
        d.value = parseValue();
        d.span = spanBetween(start, pos);
        return d;
    }

    DocumentAst parseDocument() {
        DocumentAst doc = new DocumentAst();
        doc.declarations = new ArrayList<>();

        skipTrivia();
        while (!atEnd()) {
            int start = pos;
            if (consumedKeyword("import")) {
                doc.declarations.add(parseResource(Declaration.Kind.IMPORT, start));
            } else if (consumedKeyword("inject")) {
                doc.declarations.add(parseResource(Declaration.Kind.INJECT, start));
            } else if (peek() == '{' || peek() == '[') {
                if (doc.hasRoot) {
                    throw fail(Code.PARSE_ROOT, "A document has exactly one root, and this is a second.", point());
                }
                doc.rootSpan = point();
                doc.root = parseValue();
                doc.hasRoot = true;
            } else {
                doc.declarations.add(parseLeaflink());
            }
            skipTrivia();
        }

        if (!doc.hasRoot) {
            throw fail(Code.PARSE_ROOT, "A document must have a root map or list, and this has neither.", point());
        }
        return doc;
    }
    // #endregion

    // #region values
    private ScalarNode emptyScalar() {
        ScalarNode n = new ScalarNode();
        List<StringPart> parts = new ArrayList<>();
        parts.add(new StringPart(""));
        n.parts = parts;
        n.span = point();
        return n;
    }

    private Node parseValue() {
        if (depth > MAX_DEPTH) {
            throw fail(Code.PARSE_EXPECTED, "The document nests more deeply than the parser will follow.", point());
        }
        depth++;
        try {
            int c = peek();
            if (c == '{') {
                return parseMap();
            }
            if (c == '[') {
                return parseList();
            }
            if (c == '<') {
                return parseStructure();
            }
            if (c == '#' && peekAt(1) != '{') {
                return parseLinkOrCall();
            }
            // A value that begins with "#{" is an unquoted string opening with an interpolation, not a
            // link; every other leading '#' is a link or call (section 4.3).
            if (c == '\'') {
                int start = pos;
                ScalarNode n = new ScalarNode();
                n.parts = parseSingleString();
                n.span = spanBetween(start, pos);
                return n;
            }
            if (c == '`') {
                int start = pos;
                ScalarNode n = new ScalarNode();
                n.parts = parseBacktickString();
                n.span = spanBetween(start, pos);
                return n;
            }
            return parseUnquoted();
        } finally {
            depth--;
        }
    }

    private Node parseMap() {
        int start = pos;
        advance(); // {
        List<MapEntry> entries = new ArrayList<>();

        skipTrivia();
        while (!atEnd() && peek() != '}') {
            MapEntry e = new MapEntry();
            if (startsWith("...#")) {
                e.spread = parseSpreadReference();
            } else if (peek() == '#') {
                Node value = parseLinkOrCall();
                e.key = receivingKey(value);
                e.value = value;
                e.hasValue = true;
            } else {
                e.key = name();
                e.keySpan = nameSpan;
                int save = pos;
                skipInline();
                if (atEnd() || peek() == ',' || isNewline(peek()) || peek() == '}') {
                    pos = save;
                    e.value = emptyScalar();
                    e.hasValue = false;
                } else {
                    e.value = parseValue();
                    e.hasValue = true;
                }
            }
            entries.add(e);
            if (!entrySeparator('}')) {
                break;
            }
        }
        expect('}', "A map opened with '{' must be closed with '}'.");

        MapNode n = new MapNode();
        n.entries = entries;
        n.span = spanBetween(start, pos);
        return n;
    }

    private Node parseList() {
        int start = pos;
        advance(); // [
        List<ListItem> items = new ArrayList<>();

        skipTrivia();
        while (!atEnd() && peek() != ']') {
            ListItem it = new ListItem();
            if (startsWith("...#")) {
                it.spread = parseSpreadReference();
            } else {
                it.value = parseValue();
            }
            items.add(it);
            if (!entrySeparator(']')) {
                break;
            }
        }
        expect(']', "A list opened with '[' must be closed with ']'.");

        ListNode n = new ListNode();
        n.items = items;
        n.span = spanBetween(start, pos);
        return n;
    }

    private Node parseStructure() {
        int start = pos;
        advance(); // <
        List<String> fields = new ArrayList<>();

        skipTrivia();
        while (!atEnd() && peek() != '>') {
            fields.add(name());
            skipInline();
            if (peek() == ',') {
                advance();
            }
            skipTrivia();
        }
        expect('>', "A structure signature opened with '<' must be closed with '>'.");

        // A field name may not repeat: two columns writing the same key would lose one.
        for (int i = 0; i < fields.size(); i++) {
            for (int j = i + 1; j < fields.size(); j++) {
                if (fields.get(i).equals(fields.get(j))) {
                    throw fail(Code.STRUCTURE_ARITY, "A structure field is named more than once.", spanAt(start));
                }
            }
        }

        skipTrivia();
        expect('[', "A structure signature must be followed by '[' and its rows.");

        List<List<Node>> rows = new ArrayList<>();
        List<Span> rowSpans = new ArrayList<>();

        skipTrivia();
        while (!atEnd() && peek() != ']') {
            int rowStart = pos;
            List<Node> cells = new ArrayList<>();
            cells.add(parseValue());
            skipInline();
            while (peek() == ',') {
                advance();
                // Inline trivia only, so a newline still ends the row and a comma before it reads as
                // trailing rather than joining the next row's cells (sections 4.1 and 8).
                skipInline();
                // A single trailing comma before the row's end contributes no cell, as in a map or a
                // list: the row ends at the newline with balanced nesting, at the structure's closing
                // ']', or at end of input. The arity below is counted after it is discarded.
                if (isNewline(peek()) || peek() == ']' || atEnd()) {
                    break;
                }
                cells.add(parseValue());
                skipInline();
            }
            if (cells.size() != fields.size()) {
                throw fail(Code.STRUCTURE_ARITY, "A structure row does not match the signature arity.", spanAt(start));
            }
            rows.add(cells);
            rowSpans.add(spanBetween(rowStart, pos));
            skipTrivia();
        }
        expect(']', "A structure's rows must be closed with ']'.");

        StructureNode n = new StructureNode();
        n.fields = fields;
        n.rows = rows;
        n.rowSpans = rowSpans;
        n.span = spanBetween(start, pos);
        return n;
    }

    private boolean entrySeparator(int closing) {
        skipInline();
        if (peek() == closing || atEnd()) {
            return false;
        }
        if (peek() != ',' && !isNewline(peek())) {
            // A string opener where a separator was due: let the string reader run so an unterminated one
            // is reported as the lexical error it is, at its opening quote.
            Span at = point();
            if (peek() == '\'') {
                parseSingleString();
                throw fail(Code.PARSE_EXPECTED, "Entries are separated by a comma or a newline.", at);
            }
            if (peek() == '`') {
                parseBacktickString();
                throw fail(Code.PARSE_EXPECTED, "Entries are separated by a comma or a newline.", at);
            }
            throw fail(Code.PARSE_EXPECTED, "Entries are separated by a comma or a newline.", point());
        }
        for (;;) {
            if (peek() == ',') {
                advance();
            } else if (isSpace(peek()) || isNewline(peek())) {
                advance();
            } else if (startsWith("//")) {
                consumeLineComment();
            } else if (startsWith("/*")) {
                consumeBlockComment();
            } else {
                return true;
            }
        }
    }

    private void expect(int r, String message) {
        if (peek() != r) {
            throw fail(Code.PARSE_EXPECTED, message, point());
        }
        advance();
    }
    // #endregion

    // #region references
    private Node parseLinkOrCall() {
        int start = pos;
        advance(); // #
        Reference ref = parseReference();
        if (peek() == '(') {
            Span argsSpan = point();
            List<CallArg> args = parseCallArguments();
            CallNode n = new CallNode();
            n.ref = ref;
            n.args = args;
            n.argsSpan = argsSpan;
            n.span = spanBetween(start, pos);
            return n;
        }
        LinkNode n = new LinkNode();
        n.ref = ref;
        n.span = spanBetween(start, pos);
        return n;
    }

    private Reference parseSpreadReference() {
        int start = pos;
        advance();
        advance();
        advance();
        advance(); // ...#
        Reference ref = parseReference();
        ref.span = spanBetween(start, pos); // anchored at the ...
        return ref;
    }

    private Reference parseReference() {
        int start = pos;
        Reference ref = new Reference();

        if (peek() == '$') {
            advance();
            ref.env = true;
            ref.head = parseBareName();
            ref.span = spanBetween(start, pos);
            return ref;
        }

        if (peek() == '\'') {
            ref.head = literalOf(parseSingleString());
        } else {
            ref.head = parseBareName();
        }

        List<AccessSeg> access = new ArrayList<>();
        for (;;) {
            if (peek() == '.') {
                advance();
                access.add(new AccessSeg(parseBareName(), 0, false));
            } else if (peek() == '[') {
                advance();
                access.add(parseBracketAccess());
                expect(']', "A bracket access must be closed with ']'.");
            } else {
                break;
            }
        }
        ref.access = access;
        ref.span = spanBetween(start, pos);
        return ref;
    }

    private AccessSeg parseBracketAccess() {
        if (peek() == '\'') {
            return new AccessSeg(literalOf(parseSingleString()), 0, false);
        }
        int start = pos;
        boolean digits = true;
        while (peek() != ']' && !wordStop(peek())) {
            if (!isDigit(peek())) {
                digits = false;
            }
            advance();
        }
        if (pos == start) {
            throw fail(Code.PARSE_EXPECTED, "A bracket access needs a name or an index.", spanAt(start));
        }
        String text = slice(start, pos);
        if (digits) {
            // A numeric index that overflows `int` cannot name any position a real list holds, so it
            // is clamped to a value guaranteed out of range rather than throwing: `#l[99999999999999]`
            // resolves as DEON_UNRESOLVED_LINK, exactly as an ordinary out-of-range index does, and
            // matches the other implementations instead of crashing on `Integer.parseInt`.
            int index;
            try {
                long value = Long.parseLong(text);
                index = value > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) value;
            } catch (NumberFormatException overflow) {
                index = Integer.MAX_VALUE;
            }
            return new AccessSeg(text, index, true);
        }
        return new AccessSeg(text, 0, false);
    }

    private String parseBareName() {
        int start = pos;
        while (isNameChar(peek())) {
            advance();
        }
        if (pos == start) {
            throw fail(Code.PARSE_EXPECTED, "A reference name was expected here.", point());
        }
        return slice(start, pos);
    }

    private List<CallArg> parseCallArguments() {
        advance(); // (
        List<CallArg> args = new ArrayList<>();
        skipTrivia();
        while (!atEnd() && peek() != ')') {
            CallArg a = new CallArg();
            a.name = name();
            a.nameSpan = nameSpan;
            requiredSpace();
            a.value = parseValue();
            args.add(a);
            if (!entrySeparator(')')) {
                break;
            }
        }
        expect(')', "A call opened with '(' must be closed with ')'.");
        return args;
    }

    private static String receivingKey(Node value) {
        Reference ref;
        if (value instanceof LinkNode link) {
            ref = link.ref;
        } else if (value instanceof CallNode call) {
            ref = call.ref;
        } else {
            return "";
        }
        if (!ref.access.isEmpty()) {
            return ref.access.get(ref.access.size() - 1).name;
        }
        return ref.head;
    }
    // #endregion

    private static String literalOf(List<StringPart> parts) {
        StringBuilder b = new StringBuilder();
        for (StringPart part : parts) {
            if (!part.isInterp) {
                b.append(part.literal);
            }
        }
        return b.toString();
    }

    // #region strings (section 4.3)
    // Each form collects the raw source it spans, then decodes that source once: escapes are read,
    // `#{reference}` is turned into a part, and the active quote delimiter is preserved verbatim.
    private List<StringPart> decode(String utf8, int active) {
        Parser p = new Parser(utf8, "");
        List<StringPart> parts = new ArrayList<>();
        StringBuilder lit = new StringBuilder();

        while (!p.atEnd()) {
            int r = p.peek();
            if (r == '\\') {
                p.advance();
                if (p.atEnd()) {
                    lit.append('\\');
                    break;
                }
                int n = p.peek();
                if (n == '\\') {
                    p.advance();
                    lit.append('\\');
                } else if (active != 0 && n == active) {
                    p.advance();
                    lit.appendCodePoint(active);
                } else if (n == '#' && p.peekAt(1) == '{') {
                    p.advance();
                    p.advance();
                    lit.append("#{");
                } else if (n == 'n') {
                    p.advance();
                    lit.append('\n');
                } else if (n == 'r') {
                    p.advance();
                    lit.append('\r');
                } else if (n == 't') {
                    p.advance();
                    lit.append('\t');
                } else {
                    p.advance();
                    lit.append('\\');
                    lit.appendCodePoint(n);
                }
            } else if (p.startsWith("#{")) {
                flushLiteral(parts, lit);
                parts.add(p.parseInterpolationPart());
            } else {
                lit.appendCodePoint(p.advance());
            }
        }
        flushLiteral(parts, lit);
        if (parts.isEmpty()) {
            parts.add(new StringPart(""));
        }
        return parts;
    }

    private static void flushLiteral(List<StringPart> parts, StringBuilder lit) {
        if (lit.length() == 0) {
            return;
        }
        parts.add(new StringPart(lit.toString()));
        lit.setLength(0);
    }

    private StringPart parseInterpolationPart() {
        advance(); // #
        advance(); // {
        Reference ref = parseReference();
        expect('}', "An interpolation opened with '#{' must be closed with '}'.");
        return new StringPart(ref);
    }

    private void consumeInterpolationRaw(StringBuilder raw) {
        Span open = point();
        raw.appendCodePoint(advance()); // #
        raw.appendCodePoint(advance()); // {
        for (;;) {
            if (atEnd() || isNewline(peek())) {
                throw fail(Code.LEX_UNTERMINATED, "An interpolation was opened and never closed.", open);
            }
            if (peek() == '}') {
                raw.appendCodePoint(advance());
                return;
            }
            raw.appendCodePoint(advance());
        }
    }

    private List<StringPart> parseSingleString() {
        Span open = point();
        advance(); // '
        StringBuilder raw = new StringBuilder();
        for (;;) {
            if (atEnd()) {
                throw fail(Code.LEX_UNTERMINATED, "A single-quoted string was opened and never closed.", open);
            }
            int r = peek();
            if (r == '\'') {
                advance();
                break;
            }
            if (isNewline(r)) {
                throw fail(Code.LEX_UNTERMINATED, "A single-quoted string may not cross a line.", open);
            }
            if (r == '\\') {
                raw.appendCodePoint(advance());
                if (!atEnd()) {
                    raw.appendCodePoint(advance());
                }
                continue;
            }
            if (startsWith("#{")) {
                consumeInterpolationRaw(raw);
                continue;
            }
            raw.appendCodePoint(advance());
        }
        return decode(raw.toString(), '\'');
    }

    private static boolean isTrimmable(int r) {
        return r == ' ' || r == '\t' || r == '\n';
    }

    private List<StringPart> parseBacktickString() {
        Span open = point();
        advance(); // `
        List<Integer> runeList = new ArrayList<>();
        for (;;) {
            if (atEnd()) {
                throw fail(Code.LEX_UNTERMINATED, "A backtick string was opened and never closed.", open);
            }
            int r = peek();
            if (r == '`') {
                advance();
                break;
            }
            if (r == '\\') {
                runeList.add(advance());
                if (atEnd()) {
                    throw fail(Code.LEX_UNTERMINATED, "A backtick string ended in an unfinished escape.", open);
                }
                runeList.add(advance());
                continue;
            }
            runeList.add(advance());
        }

        // Trim boundary whitespace of the source, before escapes are decoded: an escaped line break at
        // an edge is content and survives, where a real one is layout and does not.
        int startIdx = 0;
        int endIdx = runeList.size();
        while (startIdx < endIdx && isTrimmable(runeList.get(startIdx))) {
            startIdx++;
        }
        while (endIdx > startIdx && isTrimmable(runeList.get(endIdx - 1))) {
            endIdx--;
        }
        StringBuilder raw = new StringBuilder();
        for (int i = startIdx; i < endIdx; i++) {
            raw.appendCodePoint(runeList.get(i));
        }
        return decode(raw.toString(), '`');
    }

    // #region unquoted
    private boolean unquotedContinues() {
        if (atEnd()) {
            return false;
        }
        int r = peek();
        if (r == ',' || isNewline(r) || isHardDelimiter(r)) {
            return false;
        }
        return r != '#' || peekAt(1) == '{';
    }

    private void interWord(StringBuilder out) {
        for (;;) {
            if (isSpace(peek())) {
                out.appendCodePoint(advance());
            } else if (startsWith("//")) {
                advance();
                advance();
                while (!atEnd() && !isNewline(peek())) {
                    advance();
                }
            } else if (startsWith("/*")) {
                Span at = point();
                advance();
                advance();
                boolean closed = false;
                while (!atEnd()) {
                    if (peek() == '*' && peekAt(1) == '/') {
                        advance();
                        advance();
                        closed = true;
                        break;
                    }
                    advance();
                }
                if (!closed) {
                    throw fail(Code.LEX_UNTERMINATED, "A block comment was opened and never closed.", at);
                }
            } else {
                return;
            }
        }
    }

    private Node parseUnquoted() {
        int start = pos;
        StringBuilder raw = new StringBuilder();

        while (!atEnd()) {
            int r = peek();
            if (r == ',' || isNewline(r) || isHardDelimiter(r)) {
                break;
            }
            if (isSpace(r)) {
                // Separating whitespace is a token boundary: a following link (#name) is its own value
                // and ends this one, while more literal text continues the run with the spaces kept.
                int save = pos;
                StringBuilder spaces = new StringBuilder();
                interWord(spaces);
                if (unquotedContinues()) {
                    raw.append(spaces);
                    continue;
                }
                pos = save;
                break;
            }
            // "#{" opens an interpolation wherever it appears. A bare '#' not at a token boundary, and an
            // interior quote or backtick, are ordinary literal content that open nothing (section 4.3):
            // they fall through to be kept verbatim, so x#y, word#, it's, and p`q`r are their own text.
            if (startsWith("#{")) {
                consumeInterpolationRaw(raw);
                continue;
            }
            if (r == '\\') {
                // Keep the backslash and the character it escapes verbatim; decode() reads them once. "\#{"
                // is three source characters taken as a unit, so its '{' is not mistaken for a bracketing
                // delimiter that would end the value.
                raw.appendCodePoint(advance());
                if (!atEnd()) {
                    if (peek() == '#' && peekAt(1) == '{') {
                        raw.appendCodePoint(advance());
                        raw.appendCodePoint(advance());
                    } else {
                        raw.appendCodePoint(advance());
                    }
                }
                continue;
            }
            raw.appendCodePoint(advance());
        }

        if (raw.length() == 0) {
            throw fail(Code.PARSE_EXPECTED, "A value was expected here.", spanAt(start));
        }
        ScalarNode n = new ScalarNode();
        n.parts = decode(raw.toString(), 0);
        n.span = spanBetween(start, pos);
        return n;
    }
    // #endregion
    // #endregion
}
