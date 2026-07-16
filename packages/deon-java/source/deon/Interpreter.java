package deon;

import java.io.IOException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Evaluating a parsed document into a Deon value (specification 11). Declarations resolve lazily and are
 * memoized, which is equivalent to the topological resolution the specification describes and detects a
 * cycle at the reference that closes it. A diagnostic is thrown; an import re-anchors any diagnostic it
 * raises to its own statement, so a fault inside a resource is reported at the line that imported it.
 */
final class Interpreter {
    private final ParseOptions options;
    private final Map<String, Declaration> declarations = new LinkedHashMap<>();
    private final Map<String, Object> cache = new HashMap<>();
    private final Set<String> resolving = new HashSet<>();
    private final Set<String> calling = new HashSet<>();
    private final Deque<Map<String, String>> locals = new ArrayDeque<>();
    private final Set<String> opened;
    private String sourceName;
    private String filebase;

    Interpreter(ParseOptions options, Set<String> opened, String sourceName, String filebase) {
        this.options = options;
        this.opened = opened;
        this.sourceName = sourceName;
        this.filebase = filebase;
    }

    void register(List<Declaration> declarationList) {
        for (Declaration d : declarationList) {
            if (declarations.containsKey(d.name)) {
                throw new DeonException(Code.DUPLICATE_DECLARATION, "The name is declared more than once.", d.nameSpan);
            }
            declarations.put(d.name, d);
        }
    }

    Object run(Node root) {
        return eval(root);
    }

    // #region evaluation
    private Object eval(Node n) {
        if (n instanceof ScalarNode scalar) {
            return evalScalar(scalar);
        }
        if (n instanceof MapNode map) {
            return evalMap(map);
        }
        if (n instanceof ListNode list) {
            return evalList(list);
        }
        if (n instanceof StructureNode structure) {
            return evalStructure(structure);
        }
        if (n instanceof LinkNode link) {
            Reference ref = link.ref;
            ref.span = n.span(); // a link's diagnostic is at its #, not the name after it
            return resolveReference(ref);
        }
        return evalCall((CallNode) n);
    }

    private Object evalScalar(ScalarNode n) {
        StringBuilder b = new StringBuilder();
        for (StringPart part : n.parts) {
            if (!part.isInterp) {
                b.append(part.literal);
                continue;
            }
            // An interpolation is reported at the string that carries it, not inside it: the reference
            // was recovered by decoding and has no source position of its own.
            Reference ref = part.interp;
            ref.span = n.span;
            Object value = resolveReference(ref);
            if (!(value instanceof String s)) {
                throw new DeonException(Code.TYPE_MISMATCH, "An interpolation must resolve to a string.", n.span);
            }
            b.append(s);
        }
        return b.toString();
    }

    private void spreadIntoMap(DeonMap dest, Reference ref) {
        Object value = resolveReference(ref);
        if (value instanceof DeonMap map) {
            for (String key : map.keys()) {
                dest.set(key, map.get(key));
            }
        } else if (value instanceof String s) {
            // A string spreads into a map using decimal character indices (section 7).
            int index = 0;
            for (int i = 0; i < s.length(); ) {
                int cp = s.codePointAt(i);
                dest.set(Integer.toString(index), new String(Character.toChars(cp)));
                i += Character.charCount(cp);
                index++;
            }
        } else {
            throw new DeonException(Code.TYPE_MISMATCH, "A list cannot spread into a map.", ref.span);
        }
    }

    private void spreadIntoList(List<Object> dest, Reference ref) {
        Object value = resolveReference(ref);
        if (value instanceof List<?> list) {
            dest.addAll(list);
        } else if (value instanceof String s) {
            for (int i = 0; i < s.length(); ) {
                int cp = s.codePointAt(i);
                dest.add(new String(Character.toChars(cp)));
                i += Character.charCount(cp);
            }
        } else {
            throw new DeonException(Code.TYPE_MISMATCH, "A map cannot spread into a list.", ref.span);
        }
    }

    private Object evalMap(MapNode n) {
        DeonMap result = new DeonMap();
        for (MapEntry e : n.entries) {
            if (e.spread != null) {
                spreadIntoMap(result, e.spread);
                continue;
            }
            result.set(e.key, eval(e.value));
        }
        return result;
    }

    private Object evalList(ListNode n) {
        List<Object> result = new ArrayList<>();
        for (ListItem it : n.items) {
            if (it.spread != null) {
                spreadIntoList(result, it.spread);
                continue;
            }
            result.add(eval(it.value));
        }
        return result;
    }

    private Object evalStructure(StructureNode n) {
        List<Object> result = new ArrayList<>();
        for (List<Node> row : n.rows) {
            DeonMap entry = new DeonMap();
            for (int c = 0; c < n.fields.size(); c++) {
                entry.set(n.fields.get(c), eval(row.get(c)));
            }
            result.add(entry);
        }
        return result;
    }

    private Object evalCall(CallNode n) {
        String name = n.ref.head;
        if (!n.ref.access.isEmpty()) {
            throw new DeonException(Code.UNRESOLVED_LINK, "A call names a leaflink directly.", n.span);
        }
        Declaration decl = declarations.get(name);
        if (decl == null || decl.kind != Declaration.Kind.LEAFLINK) {
            throw new DeonException(Code.UNRESOLVED_LINK, "There is no entity to call.", n.span);
        }

        Set<String> params = interpolationNames(decl.value);
        Map<String, String> bindings = new LinkedHashMap<>();
        for (CallArg a : n.args) {
            if (bindings.containsKey(a.name)) {
                throw new DeonException(Code.ENTITY_ARGUMENT, "An argument is given more than once.", a.nameSpan);
            }
            if (!params.contains(a.name)) {
                throw new DeonException(Code.ENTITY_ARGUMENT, "There is no such parameter.", n.argsSpan);
            }
            Object v = eval(a.value);
            if (!(v instanceof String s)) {
                throw new DeonException(Code.ENTITY_ARGUMENT, "An argument must be a string.", a.nameSpan);
            }
            bindings.put(a.name, s);
        }
        for (String param : params) {
            if (!bindings.containsKey(param)) {
                throw new DeonException(Code.ENTITY_ARGUMENT, "A required argument is missing.", n.argsSpan);
            }
        }

        if (calling.contains(name)) {
            throw new DeonException(Code.CYCLE, "The entity calls itself.", n.span);
        }
        calling.add(name);
        locals.push(bindings);
        try {
            return eval(decl.value);
        } finally {
            locals.pop();
            calling.remove(name);
        }
    }
    // #endregion

    // #region references
    private Object applyAccess(Object value, List<AccessSeg> access, Span span) {
        for (AccessSeg seg : access) {
            if (value instanceof DeonMap map) {
                if (!map.has(seg.name)) {
                    throw new DeonException(Code.UNRESOLVED_LINK, "There is no such member.", span);
                }
                value = map.get(seg.name);
            } else if (value instanceof List<?> list) {
                if (!seg.byIndex) {
                    throw new DeonException(Code.UNRESOLVED_LINK, "A list is indexed by a number.", span);
                }
                if (seg.index < 0 || seg.index >= list.size()) {
                    throw new DeonException(Code.UNRESOLVED_LINK, "The list index is out of range.", span);
                }
                value = list.get(seg.index);
            } else {
                throw new DeonException(Code.UNRESOLVED_LINK, "A string has no members to access.", span);
            }
        }
        return value;
    }

    private Object evalDeclaration(Declaration decl) {
        return switch (decl.kind) {
            case LEAFLINK -> eval(decl.value);
            case IMPORT -> evalImport(decl);
            case INJECT -> evalInject(decl);
        };
    }

    private Object resolveHead(String name, Span span) {
        for (Map<String, String> frame : locals) { // top of stack first
            if (frame.containsKey(name)) {
                return frame.get(name);
            }
        }
        Declaration decl = declarations.get(name);
        if (decl == null) {
            throw new DeonException(Code.UNRESOLVED_LINK, "There is no such declaration.", span);
        }
        if (cache.containsKey(name)) {
            return cache.get(name);
        }
        if (resolving.contains(name)) {
            throw new DeonException(Code.CYCLE, "The declaration depends on itself.", span);
        }
        resolving.add(name);
        Object value;
        try {
            value = evalDeclaration(decl);
        } finally {
            resolving.remove(name);
        }
        cache.put(name, value);
        return value;
    }

    private Object resolveReference(Reference ref) {
        if (ref.env) {
            return options.environment.getOrDefault(ref.head, "");
        }
        Object value = resolveHead(ref.head, ref.span);
        return applyAccess(value, ref.access, ref.span);
    }
    // #endregion

    // #region entity parameters
    /** The interpolation names of an entity body: its exact parameter set (specification 10). */
    static Set<String> interpolationNames(Node n) {
        Set<String> set = new LinkedHashSet<>();
        collectInterpNames(n, set);
        return set;
    }

    private static void collectInterpNames(Node n, Set<String> set) {
        if (n instanceof ScalarNode scalar) {
            for (StringPart part : scalar.parts) {
                if (part.isInterp && !part.interp.env) {
                    set.add(part.interp.head);
                }
            }
        } else if (n instanceof MapNode map) {
            for (MapEntry e : map.entries) {
                if (e.value != null) {
                    collectInterpNames(e.value, set);
                }
            }
        } else if (n instanceof ListNode list) {
            for (ListItem it : list.items) {
                if (it.value != null) {
                    collectInterpNames(it.value, set);
                }
            }
        } else if (n instanceof StructureNode structure) {
            for (List<Node> row : structure.rows) {
                for (Node cell : row) {
                    collectInterpNames(cell, set);
                }
            }
        }
    }
    // #endregion

    // #region path and URL helpers
    static boolean isUrl(String t) {
        return t.startsWith("http://") || t.startsWith("https://");
    }

    /** The trailing ".ext" of the last path segment, or "" if none. */
    static String extensionOf(String t) {
        String path = t;
        if (isUrl(t)) {
            int scheme = t.indexOf("://");
            int slash = t.indexOf('/', scheme + 3);
            path = slash < 0 ? "" : t.substring(slash);
            // The query and fragment are not part of the path: the format is read from the path
            // alone (section 9), so `data.json?v=2` is JSON, not the extension `.json?v=2`.
            int query = path.indexOf('?');
            int fragment = path.indexOf('#');
            int cut = path.length();
            if (query >= 0) {
                cut = query;
            }
            if (fragment >= 0 && fragment < cut) {
                cut = fragment;
            }
            path = path.substring(0, cut);
        }
        int lastSlash = path.lastIndexOf('/');
        String seg = lastSlash < 0 ? path : path.substring(lastSlash + 1);
        int dot = seg.lastIndexOf('.');
        if (dot <= 0) {
            return "";
        }
        return seg.substring(dot);
    }

    /** Collapse "." and ".." segments in an absolute or relative path. */
    static String normalizePath(String path) {
        boolean absolute = !path.isEmpty() && path.charAt(0) == '/';
        Deque<String> segs = new ArrayDeque<>();
        for (String seg : path.split("/")) {
            if (seg.isEmpty() || seg.equals(".")) {
                continue;
            }
            if (seg.equals("..")) {
                // Above the base there is nothing to pop, so a relative path keeps the `..` it
                // cannot resolve (section 9): `a/../../b` normalizes to `../b`, not `b`. A rooted
                // path instead drops what it cannot climb above its root.
                if (!segs.isEmpty() && !segs.peekLast().equals("..")) {
                    segs.removeLast();
                } else if (!absolute) {
                    segs.addLast("..");
                }
                continue;
            }
            segs.addLast(seg);
        }
        String joined = String.join("/", segs);
        if (absolute) {
            return "/" + joined;
        }
        return joined.isEmpty() ? "." : joined;
    }

    static String directoryOf(String t) {
        if (isUrl(t)) {
            int scheme = t.indexOf("://");
            int slash = t.indexOf('/', scheme + 3);
            if (slash < 0) {
                return t;
            }
            int last = t.lastIndexOf('/');
            return t.substring(0, last + 1); // include trailing slash
        }
        int last = t.lastIndexOf('/');
        if (last < 0) {
            return ".";
        }
        if (last == 0) {
            return "/";
        }
        return t.substring(0, last);
    }

    static String pathJoin(String base, String rel) {
        if (base.isEmpty()) {
            return normalizePath(rel);
        }
        return normalizePath(base + "/" + rel);
    }

    static String urlJoin(String base, String rel) {
        if (isUrl(rel)) {
            return rel;
        }
        int scheme = base.indexOf("://");
        int pathStart = base.indexOf('/', scheme + 3);
        int prefixLen = pathStart < 0 ? base.length() : pathStart;
        String basePath = pathStart < 0 ? "/" : base.substring(pathStart);

        String combined;
        if (rel.startsWith("/")) {
            combined = normalizePath(rel);
        } else {
            int lastSlash = basePath.lastIndexOf('/');
            String dir = lastSlash < 0 ? "" : basePath.substring(0, lastSlash + 1);
            combined = normalizePath(dir + rel);
        }
        return base.substring(0, prefixLen) + combined;
    }

    private String mapAbsolute(String target) {
        Map<String, String> abs = options.absolutePaths;
        if (abs.isEmpty()) {
            return target;
        }
        if (abs.containsKey(target)) {
            return abs.get(target);
        }
        String bestKey = null;
        int bestLen = 0;
        for (String key : abs.keySet()) {
            if (key.length() < 2 || !key.endsWith("/*")) {
                continue;
            }
            String prefix = key.substring(0, key.length() - 1); // keep trailing slash
            if (target.startsWith(prefix) && prefix.length() > bestLen) {
                bestKey = key;
                bestLen = prefix.length();
            }
        }
        if (bestKey == null) {
            return target;
        }
        String mapped = abs.get(bestKey);
        String remainder = target.substring(bestLen);
        while (mapped.endsWith("/")) {
            mapped = mapped.substring(0, mapped.length() - 1);
        }
        return mapped + "/" + remainder;
    }

    private String resolveTarget(String target) {
        String resolved = target;
        if (isUrl(target)) {
            // already absolute
        } else if (target.startsWith("/")) {
            // logical absolute, left for the absolutePaths mapping
        } else if (filebase != null && !filebase.isEmpty() && isUrl(filebase)) {
            String base = filebase.endsWith("/") ? filebase : filebase + "/";
            resolved = urlJoin(base, target);
        } else {
            resolved = pathJoin(filebase == null ? "" : filebase, target);
        }
        return mapAbsolute(resolved);
    }

    private static String importTarget(String target) {
        if (extensionOf(target).isEmpty()) {
            return target + ".deon";
        }
        return target;
    }
    // #endregion

    // #region loading
    private record Fetched(String data, String filetype, String filebase, String resourceId) {
    }

    private String tokenFor(String target) {
        if (!isUrl(target)) {
            return "";
        }
        int scheme = target.indexOf("://");
        int start = scheme + 3;
        int end = start;
        while (end < target.length() && target.charAt(end) != '/' && target.charAt(end) != ':') {
            end++;
        }
        String host = target.substring(start, end).toLowerCase();
        return options.authorization.getOrDefault(host, "");
    }

    private Fetched loadResource(String target, String kind, String token, Span span) {
        String filetype = kind.equals("import") ? extensionOf(target) : "";
        String base = directoryOf(target);

        String mem = options.resources.get(target);
        if (mem != null) {
            return new Fetched(mem, filetype, base, target);
        }

        if (isUrl(target)) {
            if (!options.allowNetwork) {
                throw new DeonException(Code.CAPABILITY_DENIED, "The resource was not permitted: network access is not allowed.", span);
            }
            String credential = token != null && !token.isEmpty() ? token : tokenFor(target);
            String cached = Cache.read(options, target, credential);
            if (cached != null) {
                return new Fetched(cached, filetype, base, target);
            }
            String body = Network.httpGet(target, kind, credential, span);
            Cache.write(options, target, credential, body);
            return new Fetched(body, filetype, base, target);
        }

        if (!options.allowFilesystem) {
            throw new DeonException(Code.CAPABILITY_DENIED, "The resource was not permitted: filesystem access is not allowed.", span);
        }
        byte[] bytes;
        try {
            bytes = Files.readAllBytes(Path.of(target));
        } catch (IOException e) {
            throw new DeonException(Code.RESOURCE_IO, "Unable to read the resource.", span);
        }
        if (!isValidUtf8(bytes)) {
            throw new DeonException(Code.RESOURCE_FORMAT, "The resource is not valid UTF-8.", span);
        }
        return new Fetched(new String(bytes, StandardCharsets.UTF_8), filetype, base, target);
    }

    static boolean isValidUtf8(byte[] bytes) {
        var decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            decoder.decode(java.nio.ByteBuffer.wrap(bytes));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String resolveAuthenticator(Declaration d) {
        if (d.authenticator == null) {
            return "";
        }
        Object v = eval(d.authenticator);
        if (!(v instanceof String s)) {
            throw new DeonException(Code.TYPE_MISMATCH, "An authenticator must resolve to a string.", d.span);
        }
        return s;
    }

    // Run a sub-evaluation with a boundary that re-anchors any diagnostic to `at` — unless it is a
    // cycle, which keeps its own span.
    private Object reanchored(Supplier<Object> body, Span at) {
        try {
            return body.get();
        } catch (DeonException e) {
            if (e.code == Code.CYCLE) {
                throw e;
            }
            Diagnostic primary = e.primary();
            throw new DeonException(e.code, List.of(new Diagnostic(e.code, primary.message, at)));
        }
    }

    private Object evalImport(Declaration d) {
        String token = resolveAuthenticator(d);
        String target = importTarget(resolveTarget(d.target));
        Fetched f = loadResource(target, "import", token, d.span);

        if (opened.contains(f.resourceId())) {
            throw new DeonException(Code.CYCLE, "The resource imports itself.", d.span);
        }
        opened.add(f.resourceId());
        try {
            String ext = f.filetype();
            if (ext.equals(".json")) {
                return reanchored(() -> JsonReader.read(f.data(), Span.head(f.resourceId())), d.span);
            }
            if (!ext.isEmpty() && !ext.equals(".deon")) {
                throw new DeonException(Code.RESOURCE_FORMAT, "The import has an unsupported extension.", d.span);
            }
            return reanchored(() -> importDeonBody(f), d.span);
        } finally {
            opened.remove(f.resourceId());
        }
    }

    private Object importDeonBody(Fetched f) {
        DocumentAst doc = new Parser(f.data(), f.resourceId()).parseDocument();
        Interpreter sub = new Interpreter(options, opened, f.resourceId(), f.filebase());
        sub.register(doc.declarations);
        return sub.eval(doc.root);
    }

    private Object evalInject(Declaration d) {
        String token = resolveAuthenticator(d);
        String target = resolveTarget(d.target);
        Fetched f = loadResource(target, "inject", token, d.span);
        return f.data();
    }
    // #endregion

    // #region entry
    static Object evaluate(DocumentAst doc, ParseOptions options) {
        String sourceName = options.sourceName() == null || options.sourceName().isEmpty() ? "<memory>" : options.sourceName();
        String filebase = options.filebase == null ? "" : options.filebase;
        Set<String> opened = new HashSet<>();
        if (!sourceName.isEmpty()) {
            opened.add(sourceName);
        }
        Interpreter in = new Interpreter(options, opened, sourceName, filebase);
        in.register(doc.declarations);
        return in.eval(doc.root);
    }
    // #endregion
}
