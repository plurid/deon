package deon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Typing a document against a declared contract (specification 14.1). The conservative typer guesses
 * from the value and so refuses whenever a guess could be wrong; a datasign contract is the other half —
 * it supplies the intent the value cannot carry, so {@code 007} becomes 7 exactly where a contract
 * declared it a number, and nowhere else. This is an adapter to the datasign format, whose rules are its
 * own.
 */
final class Datasign {
    private static final String SOURCE = "<datasign>";

    private record Field(String name, String declared, boolean required) {
    }

    private final ParseOptions options;
    private final Map<String, List<Field>> signatures = new LinkedHashMap<>();

    private Datasign(ParseOptions options) {
        this.options = options;
    }

    static Object sign(Object root, ParseOptions options) {
        if (options.datasignMap.isEmpty()) {
            return root;
        }
        Datasign datasign = new Datasign(options);
        for (String file : options.datasignFiles) {
            datasign.parseContract(datasign.readContract(file));
        }
        return datasign.apply(root);
    }

    // #region reading a contract
    private String readContract(String file) {
        String target = file;
        if (!file.startsWith("/") && options.filebase != null && !options.filebase.isEmpty()) {
            target = options.filebase + "/" + file;
        }
        if (options.resources.containsKey(target)) {
            return options.resources.get(target);
        }
        if (options.resources.containsKey(file)) {
            return options.resources.get(file);
        }
        if (!options.allowFilesystem) {
            throw new DeonException(Code.CAPABILITY_DENIED,
                    "Reading the datasign file '" + file + "' requires filesystem access.", Span.head(SOURCE));
        }
        byte[] bytes;
        try {
            bytes = Files.readAllBytes(Path.of(target));
        } catch (IOException e) {
            throw new DeonException(Code.RESOURCE_IO, "Unable to read the datasign file '" + file + "'.", Span.head(SOURCE));
        }
        if (!Interpreter.isValidUtf8(bytes)) {
            throw new DeonException(Code.RESOURCE_FORMAT, "The datasign file '" + file + "' is not valid UTF-8.", Span.head(SOURCE));
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static final Pattern ENTITY = Pattern.compile("^\\s*data\\s+(\\w+)\\s*\\{");

    private void parseContract(String source) {
        List<Field> open = null;
        for (String line : source.split("\n", -1)) {
            String trimmed = line.stripLeading();
            if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("@")) {
                continue;
            }
            String value = line;
            int comment = value.indexOf("//");
            if (comment >= 0) {
                value = value.substring(0, comment);
            }
            if (value.strip().isEmpty()) {
                continue;
            }
            Matcher match = ENTITY.matcher(value);
            if (match.find()) {
                open = new ArrayList<>();
                signatures.put(match.group(1), open);
                continue;
            }
            if (value.stripLeading().startsWith("}")) {
                open = null;
                continue;
            }
            if (open == null) {
                continue;
            }
            int colon = value.indexOf(':');
            if (colon < 0) {
                continue;
            }
            // A `?` anywhere on the line marks the field optional and is removed from both the name and
            // the type, so `nickname?: string` and `nickname: string?` are one declaration.
            boolean optional = value.contains("?");
            String name = value.substring(0, colon).strip().replace("?", "");
            String declared = stripTrailingSemicolon(value.substring(colon + 1).strip()).replace("?", "");
            if (name.isEmpty() || declared.isEmpty()) {
                continue;
            }
            open.add(new Field(name, declared, !optional));
        }
    }

    private static String stripTrailingSemicolon(String s) {
        String t = s.strip();
        return t.endsWith(";") ? t.substring(0, t.length() - 1).strip() : t;
    }
    // #endregion

    // #region numbers — ECMAScript Number(string), which section 14.1 fixes as the grammar
    private static final Pattern DECIMAL = Pattern.compile("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$");

    private static OptionalDouble numeric(String text) {
        String trimmed = text.strip();
        if (trimmed.isEmpty()) {
            return OptionalDouble.empty();
        }
        String[][] radixes = {{"0x", "16"}, {"0X", "16"}, {"0o", "8"}, {"0O", "8"}, {"0b", "2"}, {"0B", "2"}};
        for (String[] radix : radixes) {
            if (trimmed.startsWith(radix[0])) {
                try {
                    long n = Long.parseUnsignedLong(trimmed.substring(2), Integer.parseInt(radix[1]));
                    return OptionalDouble.of((double) n);
                } catch (NumberFormatException e) {
                    return OptionalDouble.empty();
                }
            }
        }
        if (!DECIMAL.matcher(trimmed).matches()) {
            return OptionalDouble.empty();
        }
        try {
            double n = Double.parseDouble(trimmed);
            return Double.isFinite(n) ? OptionalDouble.of(n) : OptionalDouble.empty();
        } catch (NumberFormatException e) {
            return OptionalDouble.empty();
        }
    }
    // #endregion

    // #region applying a contract
    private static String describe(Object value) {
        if (value instanceof String) {
            return "a string";
        }
        if (value instanceof List<?>) {
            return "a list";
        }
        if (value instanceof DeonMap) {
            return "a map";
        }
        return "a value";
    }

    private static DeonException mismatch(String message) {
        return new DeonException(Code.TYPE_MISMATCH, message, Span.head(SOURCE));
    }

    private Object typeDatasign(Object value, String declared, String path) {
        declared = declared.strip();

        if (declared.endsWith("[]")) {
            if (!(value instanceof List<?> list)) {
                throw mismatch("Expected '" + path + "' to be a list for '" + declared + "', found " + describe(value) + ".");
            }
            String item = declared.substring(0, declared.length() - 2).strip();
            List<Object> out = new ArrayList<>();
            for (int i = 0; i < list.size(); i++) {
                out.add(typeDatasign(list.get(i), item, path + "[" + i + "]"));
            }
            return out;
        }

        if (declared.equals("string") || declared.equals("number") || declared.equals("boolean")) {
            if (!(value instanceof String text)) {
                throw mismatch("Expected '" + path + "' to be a string for '" + declared + "', found " + describe(value) + ".");
            }
            return switch (declared) {
                case "string" -> text;
                case "boolean" -> {
                    if (text.equals("true")) {
                        yield Boolean.TRUE;
                    }
                    if (text.equals("false")) {
                        yield Boolean.FALSE;
                    }
                    throw mismatch("Expected '" + path + "' to be 'true' or 'false' for 'boolean', found '" + text + "'.");
                }
                default -> {
                    OptionalDouble n = numeric(text);
                    if (n.isEmpty()) {
                        throw mismatch("Expected '" + path + "' to be a number, found '" + text + "'.");
                    }
                    yield n.getAsDouble();
                }
            };
        }

        List<Field> entity = signatures.get(declared);
        if (entity == null) {
            return value; // a type defined elsewhere; a value is not guessed at
        }

        if (!(value instanceof DeonMap container)) {
            throw mismatch("Expected '" + path + "' to be a map for '" + declared + "', found " + describe(value) + ".");
        }

        Map<String, Field> fields = new LinkedHashMap<>();
        for (Field field : entity) {
            fields.put(field.name(), field);
        }
        DeonMap out = new DeonMap();
        for (String key : container.keys()) {
            Field field = fields.get(key);
            if (field != null) {
                out.set(key, typeDatasign(container.get(key), field.declared(), path + "." + key));
            } else {
                out.set(key, container.get(key)); // verbatim
            }
        }
        for (Field field : entity) {
            if (field.required() && !container.has(field.name())) {
                throw mismatch("Required field '" + path + "." + field.name() + "' of '" + declared + "' is missing.");
            }
        }
        return out;
    }

    private Object apply(Object root) {
        if (!(root instanceof DeonMap container)) {
            throw mismatch("A datasign map requires a root map, found " + describe(root) + ".");
        }
        DeonMap out = new DeonMap();
        for (String key : container.keys()) {
            String declared = options.datasignMap.get(key);
            if (declared != null) {
                out.set(key, typeDatasign(container.get(key), declared, key));
            } else {
                out.set(key, container.get(key)); // verbatim
            }
        }
        return out;
    }
    // #endregion
}
