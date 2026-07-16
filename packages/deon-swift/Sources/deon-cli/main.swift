import CDeon
import Deon

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

// The defaults are the tool's, not the library's: --output deon, --typed false, --filesystem TRUE,
// --network false. A file named on a command line was named by a person, so it may read the disk;
// nothing said it may reach the network. The library grants neither, because a document handed to a
// library came from somewhere unknown — a document handed to this came from whoever typed the command.

let usage = """
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

"""

// #region output
private func writeBytes(_ bytes: [UInt8], _ stream: UnsafeMutablePointer<FILE>) {
    bytes.withUnsafeBytes { _ = fwrite($0.baseAddress, 1, $0.count, stream) }
}

private func out(_ s: String) {
    writeBytes(Array(s.utf8), stdout)
}

private func err(_ s: String) {
    writeBytes(Array(s.utf8), stderr)
}
// #endregion

// #region argument parsing
private func hasFlag(_ args: [String], _ a: String, _ b: String?) -> Bool {
    args.contains { $0 == a || (b != nil && $0 == b!) }
}

private func optValue(_ args: [String], _ a: String, _ b: String?, _ fallback: String) -> String {
    for i in 0 ..< args.count where args[i] == a || (b != nil && args[i] == b!) {
        if i + 1 < args.count {
            return args[i + 1]
        }
    }
    return fallback
}

private func takesValue(_ a: String) -> Bool {
    a == "-o" || a == "--output" || a == "-f" || a == "--filesystem"
        || a == "-n" || a == "--network" || a == "-d" || a == "--destination"
}

/// The arguments that are neither options nor the values of options.
private func positional(_ args: [String]) -> [String] {
    var out: [String] = []
    var skip = false
    for arg in args {
        if skip {
            skip = false
            continue
        }
        if takesValue(arg) {
            skip = true
            continue
        }
        if arg.hasPrefix("-") {
            continue
        }
        out.append(arg)
    }
    return out
}
// #endregion

// #region files and paths
private func resolve(_ path: String) -> String {
    if path.hasPrefix("/") {
        return path
    }
    var buffer = [CChar](repeating: 0, count: 4096)
    guard getcwd(&buffer, buffer.count) != nil else {
        return path
    }
    return String(cString: buffer) + "/" + path
}

private func readRaw(_ path: String) -> [UInt8]? {
    guard let f = fopen(path, "rb") else {
        return nil
    }
    defer { fclose(f) }
    if fseek(f, 0, SEEK_END) != 0 {
        return nil
    }
    let size = ftell(f)
    if size < 0 {
        return nil
    }
    rewind(f)
    if size == 0 {
        return []
    }
    var bytes = [UInt8](repeating: 0, count: size)
    let got = bytes.withUnsafeMutableBytes { fread($0.baseAddress, 1, size, f) }
    if got < size {
        bytes.removeLast(size - got)
    }
    return bytes
}

/// The bytes were read; a document whose encoding is not UTF-8 is a resource-format fault at 1:1,
/// distinct from a file that could not be read at all — the same check the C resource loader makes.
/// Returns true (and prints the diagnostic) when the bytes are not valid UTF-8.
private func rejectNonUTF8(_ resolved: String, _ bytes: [UInt8]) -> Bool {
    if String(validating: bytes, as: UTF8.self) != nil {
        return false
    }
    err("\(resolved):1:1 error \(String(cString: deon_code_name(DEON_RESOURCE_FORMAT))) The document is not valid UTF-8.\n")
    return true
}

@discardableResult
private func writeFile(_ path: String, _ bytes: [UInt8]) -> Bool {
    guard let f = fopen(path, "wb") else {
        return false
    }
    defer { fclose(f) }
    let wrote = bytes.withUnsafeBytes { fwrite($0.baseAddress, 1, $0.count, f) }
    return wrote == bytes.count
}

private func makeDirectories(_ path: String) {
    let leading = path.hasPrefix("/")
    var accumulated = ""
    for part in path.split(separator: "/", omittingEmptySubsequences: true) {
        accumulated += (accumulated.isEmpty ? (leading ? "/" : "") : "/") + String(part)
        accumulated.withCString { _ = mkdir($0, 0o755) }
    }
}

/// The directory a path lives in, spelled as the C tool spells it: the path up to the last slash, `.`
/// when there is no slash, and `/` when the slash is the first character.
private func directoryOf(_ path: String) -> String {
    guard let slash = path.lastIndex(of: "/") else {
        return "."
    }
    if slash == path.startIndex {
        return "/"
    }
    return String(path[path.startIndex ..< slash])
}
// #endregion

// #region diagnostics
private func printDiagnostics(_ document: Document) {
    for diagnostic in document.diagnostics {
        err("\(diagnostic.source):\(diagnostic.line):\(diagnostic.column) "
            + "\(diagnostic.severity) \(diagnostic.code) \(diagnostic.message)\n")
    }
}

// A writer (stringify/typed) refused a value that nests deeper than the limit — an error with a code but
// no document span, so the position is a placeholder.
private func printWriteError(_ error: DeonError) {
    err("\(error.source):\(error.line):\(error.column) \(error.severity) \(error.code) \(error.message)\n")
}
// #endregion

// #region JSON output
private func emitJSONString(_ s: String, _ buffer: inout [UInt8]) {
    buffer.append(0x22) // '"'
    for byte in s.utf8 {
        switch byte {
        case 0x22: buffer.append(contentsOf: Array("\\\"".utf8))
        case 0x5C: buffer.append(contentsOf: Array("\\\\".utf8))
        case 0x0A: buffer.append(contentsOf: Array("\\n".utf8))
        case 0x0D: buffer.append(contentsOf: Array("\\r".utf8))
        case 0x09: buffer.append(contentsOf: Array("\\t".utf8))
        case 0x08: buffer.append(contentsOf: Array("\\b".utf8))
        case 0x0C: buffer.append(contentsOf: Array("\\f".utf8))
        default:
            if byte < 0x20 {
                let hex = String(byte, radix: 16)
                let padded = "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                buffer.append(contentsOf: Array(padded.utf8))
            } else {
                buffer.append(byte)
            }
        }
    }
    buffer.append(0x22)
}

private func indent(_ level: Int, _ buffer: inout [UInt8]) {
    for _ in 0 ..< (level * 4) {
        buffer.append(0x20)
    }
}

/// The command line tool's own indented-JSON writer (`deon <file> -o json`), spelled exactly as every
/// sibling spells it so the tools agree character for character.
private func emitJSON(_ value: DeonValue, _ level: Int, _ buffer: inout [UInt8]) {
    switch value {
    case .string(let s):
        emitJSONString(s, &buffer)
    case .bool(let b):
        buffer.append(contentsOf: Array((b ? "true" : "false").utf8))
    case .number(let n):
        buffer.append(contentsOf: Array(numberText(n).utf8))
    case .list(let items):
        if items.isEmpty {
            buffer.append(contentsOf: Array("[]".utf8))
            return
        }
        buffer.append(contentsOf: Array("[\n".utf8))
        for (i, item) in items.enumerated() {
            if i > 0 {
                buffer.append(contentsOf: Array(",\n".utf8))
            }
            indent(level + 1, &buffer)
            emitJSON(item, level + 1, &buffer)
        }
        buffer.append(0x0A)
        indent(level, &buffer)
        buffer.append(0x5D) // ']'
    case .map(let entries):
        if entries.isEmpty {
            buffer.append(contentsOf: Array("{}".utf8))
            return
        }
        buffer.append(contentsOf: Array("{\n".utf8))
        for (i, entry) in entries.enumerated() {
            if i > 0 {
                buffer.append(contentsOf: Array(",\n".utf8))
            }
            indent(level + 1, &buffer)
            emitJSONString(entry.key, &buffer)
            buffer.append(contentsOf: Array(": ".utf8))
            emitJSON(entry.value, level + 1, &buffer)
        }
        buffer.append(0x0A)
        indent(level, &buffer)
        buffer.append(0x7D) // '}'
    }
}

private func numberText(_ n: Double) -> String {
    if n.isFinite, let whole = Int64(exactly: n) {
        return String(whole)
    }
    return String(n)
}
// #endregion

// #region process environment
private func processEnvironment() -> [(String, String)] {
    var out: [(String, String)] = []
    var index = 0
    guard let table = deon_environ() else {
        return out
    }
    while let entry = table[index] {
        let text = String(cString: entry)
        if let eq = text.firstIndex(of: "=") {
            out.append((String(text[text.startIndex ..< eq]), String(text[text.index(after: eq)...])))
        }
        index += 1
    }
    return out
}

private func evaluationOptions(_ args: [String], _ path: String, _ environment: [(String, String)]) -> Options {
    var o = Options()
    o.sourceName = resolve(path)
    o.filebase = directoryOf(o.sourceName)
    o.allowFilesystem = optValue(args, "-f", "--filesystem", "true") == "true"
    o.allowNetwork = optValue(args, "-n", "--network", "false") == "true"
    var environmentMap: [String: String] = [:]
    for (name, value) in environment {
        environmentMap[name] = value
    }
    o.environment = environmentMap
    return o
}
// #endregion

// #region commands
private func commandEvaluate(_ args: [String]) -> Int32 {
    let resolved = resolve(args[0])
    guard let source = readRaw(resolved) else {
        err("\(resolved):1:1 error \(String(cString: deon_code_name(DEON_RESOURCE_IO))) Unable to read '\(resolved)'.\n")
        return 1
    }
    if rejectNonUTF8(resolved, source) { return 1 }

    let document = Deon.parseWithBytes(source, evaluationOptions(args, args[0], processEnvironment()))
    if !document.ok {
        printDiagnostics(document)
        return 1
    }
    do {
        if optValue(args, "-o", "--output", "deon") == "json" {
            guard let value = try (hasFlag(args, "-t", "--typed") ? document.typed() : document.value()) else {
                return 1
            }
            var buffer: [UInt8] = []
            emitJSON(value, 0, &buffer)
            buffer.append(0x0A)
            writeBytes(buffer, stdout)
        } else {
            writeBytes(try document.stringifyBytes(StringifyOptions()), stdout)
        }
    } catch let error as DeonError {
        printWriteError(error)
        return 1
    } catch {
        return 1
    }
    return 0
}

private func commandConvert(_ args: [String]) -> Int32 {
    if args.count < 2 {
        err("deon: convert requires a source file.\n")
        return 1
    }
    let source = args[1]
    guard let data = readRaw(source) else {
        err("deon: Unable to read '\(source)'.\n")
        return 1
    }
    let document = Deon.readJSONBytes(data, source)
    if !document.ok {
        printDiagnostics(document)
        return 1
    }
    let written: [UInt8]
    do {
        written = try document.stringifyBytes(StringifyOptions())
    } catch let error as DeonError {
        printWriteError(error)
        return 1
    } catch {
        return 1
    }
    let destinations = positional(Array(args[2...]))
    if let destination = destinations.first {
        if !writeFile(destination, written) {
            err("deon: Unable to write '\(destination)'.\n")
            return 1
        }
    } else {
        writeBytes(written, stdout)
    }
    return 0
}

private func environmentValue(_ value: DeonValue) -> [UInt8]? {
    switch value {
    case .string(let s):
        return Array(s.utf8)
    case .list(let items):
        var out: [UInt8] = []
        var first = true
        for item in items {
            guard case .string(let s) = item else {
                continue
            }
            if !first {
                out.append(0x3A) // ':'
            }
            first = false
            out.append(contentsOf: Array(s.utf8))
        }
        return out
    default:
        return nil
    }
}

private func commandEnvironment(_ args: [String]) -> Int32 {
    if args.count < 3 {
        err("deon: environment requires a source file and a command.\n")
        return 1
    }
    let source = args[1]
    let document = Deon.parseFile(source, Options())
    if !document.ok {
        printDiagnostics(document)
        return 1
    }
    guard let root = document.value(), case .map(let entries) = root else {
        err("deon: An environment source must contain a root map.\n")
        return 1
    }

    var environment = processEnvironment()
    func put(_ name: String, _ value: String, _ overwrite: Bool) {
        for i in 0 ..< environment.count where environment[i].0 == name {
            if overwrite {
                environment[i].1 = value
            }
            return
        }
        environment.append((name, value))
    }
    let writeover = hasFlag(args, "-w", "--writeover")
    for entry in entries {
        guard let value = environmentValue(entry.value) else {
            continue
        }
        put(entry.key, String(decoding: value, as: UTF8.self), writeover)
    }

    // Everything after the source is the command, verbatim, with only this command's own flag removed.
    var command: [String] = []
    for arg in args[2...] where arg != "-w" && arg != "--writeover" {
        command.append(arg)
    }
    if command.isEmpty {
        err("deon: environment requires a command to run.\n")
        return 1
    }
    return spawn(command, environment)
}

/// Runs a command with a replaced environment and returns its exit status, as `execvp` would — the
/// program name is searched on `PATH`, and its own arguments reach it untouched.
private func spawn(_ command: [String], _ environment: [(String, String)]) -> Int32 {
    let argv: [UnsafeMutablePointer<CChar>?] = command.map { strdup($0) } + [nil]
    let envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup("\($0.0)=\($0.1)") } + [nil]
    defer {
        for p in argv where p != nil { free(p) }
        for p in envp where p != nil { free(p) }
    }
    var pid: pid_t = 0
    let status = posix_spawnp(&pid, command[0], nil, nil, argv, envp)
    if status != 0 {
        err("deon: Unable to run '\(command[0])': \(String(cString: strerror(status)))\n")
        return 127
    }
    var wstatus: Int32 = 0
    waitpid(pid, &wstatus, 0)
    if wstatus & 0x7F == 0 { // WIFEXITED
        return (wstatus >> 8) & 0xFF
    }
    return 1
}

/// Appends `bytes` into `buffer` as the body of a single-quoted Deon string, without the quotes.
private func quoteInto(_ bytes: [UInt8], _ buffer: inout [UInt8]) {
    for byte in bytes {
        switch byte {
        case 0x5C: buffer.append(contentsOf: Array("\\\\".utf8))
        case 0x27: buffer.append(contentsOf: Array("\\'".utf8))
        case 0x0A: buffer.append(contentsOf: Array("\\n".utf8))
        case 0x0D: buffer.append(contentsOf: Array("\\r".utf8))
        case 0x09: buffer.append(contentsOf: Array("\\t".utf8))
        default: buffer.append(byte)
        }
    }
}

private func commandConfile(_ args: [String]) -> Int32 {
    let destination = optValue(args, "-d", "--destination", "confile.deon")
    let files = positional(Array(args[1...])).filter { $0 != destination }
    if files.isEmpty {
        err("deon: confile requires at least one input file.\n")
        return 1
    }

    // Assemble the confile as Deon source keyed by the path as typed, then parse and stringify with the
    // same writer the other tools use, so exfile puts each file back where it came from.
    var text = Array("{\n".utf8)
    for file in files {
        guard let data = readRaw(file) else {
            err("deon: Unable to read '\(file)'.\n")
            return 1
        }
        text.append(contentsOf: Array("    '".utf8))
        quoteInto(Array(file.utf8), &text)
        text.append(contentsOf: Array("' {\n        data '".utf8))
        quoteInto(data, &text)
        text.append(contentsOf: Array("'\n    }\n".utf8))
    }
    text.append(contentsOf: Array("}\n".utf8))

    let document = Deon.parseBytes(text)
    if !document.ok {
        printDiagnostics(document)
        return 1
    }
    let written: [UInt8]
    do {
        written = try document.stringifyBytes(StringifyOptions())
    } catch let error as DeonError {
        printWriteError(error)
        return 1
    } catch {
        return 1
    }
    if !writeFile(destination, written) {
        err("deon: Unable to write '\(destination)'.\n")
        return 1
    }
    return 0
}

private func exfileData(_ entry: DeonValue) -> [UInt8]? {
    switch entry {
    case .string(let s):
        return Array(s.utf8)
    case .map:
        if case .string(let s)? = mapGet(entry, "data") {
            return Array(s.utf8)
        }
        return nil
    default:
        return nil
    }
}

private func mapGet(_ value: DeonValue, _ key: String) -> DeonValue? {
    if case .map(let entries) = value {
        for entry in entries where entry.key == key {
            return entry.value
        }
    }
    return nil
}

/// True when a cleaned relative path rises above its starting directory.
private func pathEscapes(_ path: String) -> Bool {
    var depth = 0
    for segment in path.split(separator: "/", omittingEmptySubsequences: false) {
        if segment == ".." {
            depth -= 1
            if depth < 0 {
                return true
            }
        } else if !(segment.isEmpty || segment == ".") {
            depth += 1
        }
    }
    return false
}

private func commandExfile(_ args: [String]) -> Int32 {
    if args.count < 2 {
        err("deon: exfile requires a source file.\n")
        return 1
    }
    let source = args[1]
    let unsafe = hasFlag(args, "--unsafe-paths", nil)
    let document = Deon.parseFile(source, Options())
    if !document.ok {
        printDiagnostics(document)
        return 1
    }
    guard let root = document.value(), case .map(let entries) = root else {
        err("deon: An exfile source must contain a root map.\n")
        return 1
    }

    // Every entry is checked before any is written, so a document with one bad path writes nothing.
    for entry in entries {
        guard exfileData(entry.value) != nil else {
            err("deon: Exfile entry '\(entry.key)' must be a string or a map with a string data field.\n")
            return 1
        }
        if !unsafe && (entry.key.hasPrefix("/") || pathEscapes(entry.key)) {
            err("deon: Unsafe exfile path '\(entry.key)'. Use --unsafe-paths to permit it.\n")
            return 1
        }
    }

    for entry in entries {
        let data = exfileData(entry.value)!
        let directory = directoryOf(entry.key)
        if directory != "." && !directory.isEmpty {
            makeDirectories(directory)
        }
        if !writeFile(entry.key, data) {
            err("deon: Unable to write '\(entry.key)'.\n")
            return 1
        }
    }
    return 0
}

private func commandLint(_ args: [String]) -> Int32 {
    let files = positional(Array(args[1...]))
    if files.isEmpty {
        err("deon: lint requires at least one file.\n")
        return 1
    }
    let warningsAreErrors = hasFlag(args, "--warnings-as-errors", nil)
    var warned = false

    for file in files {
        let resolved = resolve(file)
        guard let source = readRaw(resolved) else {
            err("\(resolved):1:1 error \(String(cString: deon_code_name(DEON_RESOURCE_IO))) Unable to read '\(resolved)'.\n")
            return 1
        }
        if rejectNonUTF8(resolved, source) { return 1 }

        for diagnostic in Deon.lintBytes(source, resolved) {
            warned = true
            out("\(resolved):\(diagnostic.line):\(diagnostic.column) "
                + "\(diagnostic.severity) \(diagnostic.code) \(diagnostic.message)\n")
        }

        // Linting reports what is legal and questionable; evaluation surfaces what is wrong.
        let document = Deon.parseWithBytes(source, evaluationOptions(args, file, processEnvironment()))
        if !document.ok {
            printDiagnostics(document)
            return 1
        }
    }

    if warned && warningsAreErrors {
        return 1
    }
    return 0
}
// #endregion

private func run() -> Int32 {
    let args = Array(CommandLine.arguments[1...])
    if args.isEmpty || hasFlag(args, "-h", "--help") {
        out(usage)
        return 0
    }
    if hasFlag(args, "-v", "--version") {
        out(deonVersion + "\n")
        return 0
    }
    switch args[0] {
    case "convert": return commandConvert(args)
    case "environment": return commandEnvironment(args)
    case "confile": return commandConfile(args)
    case "exfile": return commandExfile(args)
    case "lint": return commandLint(args)
    default: return commandEvaluate(args)
    }
}

exit(run())
