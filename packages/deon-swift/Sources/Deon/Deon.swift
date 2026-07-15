import CDeon

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// The release of the specification this implementation tracks; every implementation prints the same.
public let deonVersion = String(cString: DEON_VERSION)

/// A Deon diagnostic surfaced as a Swift error. A code and a position are normative; the message is
/// prose and is not (spec/diagnostics.md).
public struct DeonError: Error {
    public let code: String
    public let message: String
    public let line: Int
    public let column: Int
    public let source: String
    public let severity: String
}

/// One thing a document declares, and what it would demand of a caller (specification 10).
public struct Entity {
    public let name: String
    public let parameters: [String]
    public let kind: String
}

/// One thing a document has to say about itself — carried by a parse error's trace and by a lint. A
/// code and a position are normative; the message is prose and is not (spec/diagnostics.md).
public struct Diagnostic {
    public let code: String
    public let message: String
    public let line: Int
    public let column: Int
    public let source: String
    public let severity: String
}

/// How a value is written back out (specification 12).
public struct StringifyOptions {
    public var canonical = false
    public var readable = true
    public var indentation = 4
    public var leaflinks = false
    public var leaflinkLevel = 1
    public var leaflinkShortening = true
    public var generatedHeader = false
    public var generatedComments = false
    public init() {}
}

/// The capabilities and surroundings a caller decides. Nothing is granted that was not asked for.
public struct Options {
    public var sourceName = ""
    public var filebase = ""
    public var resources: [String: String] = [:]
    public var absolutePaths: [String: String] = [:]
    public var environment: [String: String] = [:]
    public var authorization: [String: String] = [:]
    public var token = ""
    public var allowFilesystem = false
    public var allowNetwork = false
    public var cache = false
    public var cacheDuration = 0
    public var cacheDirectory = ""
    public var datasignFiles: [String] = []
    public var datasignMap: [String: String] = [:]
    public init() {}
}

/// Owns the C strings and arrays a `deon_options` points at, and frees all of them at once when it is
/// released. A document retains the retainer that built its options, because a parse error's span still
/// points at the source-name string after the call returns.
final class Retainer {
    private var allocations: [UnsafeMutableRawPointer] = []

    func dup(_ s: String) -> UnsafePointer<CChar>? {
        guard let p = strdup(s) else {
            return nil
        }
        allocations.append(UnsafeMutableRawPointer(p))
        return UnsafePointer(p)
    }

    func array<T>(_ count: Int, _ type: T.Type) -> UnsafeMutablePointer<T> {
        let raw = malloc(count * MemoryLayout<T>.stride)!
        allocations.append(raw)
        return raw.bindMemory(to: T.self, capacity: count)
    }

    deinit {
        for pointer in allocations {
            free(pointer)
        }
    }
}

private func buildOptions(_ options: Options, _ retainer: Retainer) -> deon_options {
    var native = deon_options()
    native.source_name = retainer.dup(options.sourceName)
    native.filebase = retainer.dup(options.filebase)
    native.token = retainer.dup(options.token)
    native.allow_filesystem = options.allowFilesystem
    native.allow_network = options.allowNetwork
    native.cache = options.cache
    native.cache_duration = Int32(options.cacheDuration)
    native.cache_directory = options.cacheDirectory.isEmpty ? nil : retainer.dup(options.cacheDirectory)

    func pairs(_ dict: [String: String]) -> (UnsafePointer<deon_pair>?, Int) {
        if dict.isEmpty {
            return (nil, 0)
        }
        let buffer = retainer.array(dict.count, deon_pair.self)
        var i = 0
        for (key, value) in dict {
            buffer[i].key = retainer.dup(key)
            buffer[i].value = retainer.dup(value)
            i += 1
        }
        return (UnsafePointer(buffer), dict.count)
    }

    (native.resources, native.resources_len) = pairs(options.resources)
    (native.absolute_paths, native.absolute_paths_len) = pairs(options.absolutePaths)
    (native.environment, native.environment_len) = pairs(options.environment)
    (native.authorization, native.authorization_len) = pairs(options.authorization)
    (native.datasign_map, native.datasign_map_len) = pairs(options.datasignMap)

    if !options.datasignFiles.isEmpty {
        let files = retainer.array(options.datasignFiles.count, UnsafePointer<CChar>?.self)
        for (i, file) in options.datasignFiles.enumerated() {
            files[i] = retainer.dup(file)
        }
        native.datasign_files = UnsafePointer(files)
        native.datasign_files_len = options.datasignFiles.count
    }
    return native
}

/// Calls a C function that wants a `(const char *, size_t)` with a byte buffer. A document's source is
/// bytes, not text — it may carry a string with an embedded NUL, and it may not even be valid UTF-8 —
/// so the bytes reach the library untouched rather than through a lossy round trip.
func withCBytes<R>(_ bytes: [UInt8], _ body: (UnsafePointer<CChar>, Int) -> R) -> R {
    if bytes.isEmpty {
        return body("", 0)
    }
    return bytes.withUnsafeBytes { raw in
        body(raw.baseAddress!.assumingMemoryBound(to: CChar.self), bytes.count)
    }
}

/// The same, with the UTF-8 bytes of a Swift string.
func withCSource<R>(_ s: String, _ body: (UnsafePointer<CChar>, Int) -> R) -> R {
    withCBytes(Array(s.utf8), body)
}

/// Takes ownership of a malloc'd C buffer of a known length, returning its bytes and freeing it.
func takeBytes(_ pointer: UnsafeMutablePointer<CChar>?, _ length: Int) -> [UInt8] {
    guard let pointer = pointer else {
        return []
    }
    let result = length > 0 ? Array(UnsafeRawBufferPointer(start: pointer, count: length)) : []
    free(pointer)
    return result
}

/// The same, decoding the bytes as UTF-8 text.
func takeString(_ pointer: UnsafeMutablePointer<CChar>?, _ length: Int) -> String {
    guard let pointer = pointer else {
        return ""
    }
    let result = length > 0
        ? String(decoding: UnsafeRawBufferPointer(start: pointer, count: length), as: UTF8.self)
        : ""
    free(pointer)
    return result
}

/// A parsed document. It owns the C document — one arena holding the whole parse — and frees it when
/// released, along with the C strings its options pointed at.
public final class Document {
    let handle: OpaquePointer
    private let keepalive: AnyObject?

    init(_ handle: OpaquePointer, _ keepalive: AnyObject?) {
        self.handle = handle
        self.keepalive = keepalive
    }

    deinit {
        deon_document_free(handle)
    }

    public var ok: Bool {
        deon_document_ok(handle)
    }

    /// The failure code and the position of the first diagnostic — what the harness compares.
    public var error: DeonError {
        guard let raw = deon_document_error(handle) else {
            return DeonError(code: "DEON_OK", message: "", line: 0, column: 0, source: "<memory>", severity: "error")
        }
        let e = raw.pointee
        let diagnostic = e.diagnostics.pointee
        return DeonError(
            code: String(cString: deon_code_name(e.code)),
            message: swiftString(e.message),
            line: Int(diagnostic.span.line),
            column: Int(diagnostic.span.column),
            source: diagnostic.span.source != nil ? String(cString: diagnostic.span.source!) : "<memory>",
            severity: diagnostic.severity == 1 ? "warning" : "error")
    }

    /// Every diagnostic the failure carries, in order — a resource fault brings an import trace, and the
    /// command line tool prints the whole of it (specification 9).
    public var diagnostics: [Diagnostic] {
        guard let raw = deon_document_error(handle) else {
            return []
        }
        return readDiagnostics(raw.pointee.diagnostics, raw.pointee.diagnostics_len)
    }

    /// The evaluated root as a Swift value.
    public func value() -> DeonValue {
        bridge(deon_document_root(handle)!)
    }

    /// The conservative typer's view of the root (specification 14).
    public func typed() -> DeonValue {
        bridge(deon_typed(handle, deon_document_root(handle))!)
    }

    /// The one output every implementation agrees on, character for character (specification 13).
    public func canonical() -> String {
        var length = 0
        return takeString(deon_canonical(deon_document_root(handle), &length), length)
    }

    /// The root written back out with the given options, as text.
    public func stringify(_ options: StringifyOptions) -> String {
        String(decoding: stringifyBytes(options), as: UTF8.self)
    }

    /// The root written back out with the given options, as bytes — the command line tool writes this
    /// straight to a file or to standard output, and a Deon string may carry bytes that are not text.
    public func stringifyBytes(_ options: StringifyOptions) -> [UInt8] {
        var native = deon_default_stringify_options()
        native.canonical = options.canonical
        native.readable = options.readable
        native.indentation = Int32(options.indentation)
        native.leaflinks = options.leaflinks
        native.leaflink_level = Int32(options.leaflinkLevel)
        native.leaflink_shortening = options.leaflinkShortening
        native.generated_header = options.generatedHeader
        native.generated_comments = options.generatedComments
        var length = 0
        return takeBytes(deon_stringify(deon_document_root(handle), &native, &length), length)
    }
}

/// Reads a document, granted nothing. A document that imports is denied — a diagnostic, not a surprise.
public func parse(_ source: String) -> Document {
    parseBytes(Array(source.utf8))
}

/// Reads a document with the capabilities and surroundings the caller decides.
public func parseWith(_ source: String, _ options: Options) -> Document {
    parseWithBytes(Array(source.utf8), options)
}

/// The byte-clean core of ``parse``.
public func parseBytes(_ bytes: [UInt8]) -> Document {
    parseWithBytes(bytes, Options())
}

/// The byte-clean core of ``parseWith``.
public func parseWithBytes(_ bytes: [UInt8], _ options: Options) -> Document {
    let retainer = Retainer()
    var native = buildOptions(options, retainer)
    let handle = withCBytes(bytes) { deon_parse_with($0, $1, &native) }!
    return Document(handle, retainer)
}

/// Reads a file, which grants the filesystem to it and to what it imports.
public func parseFile(_ path: String, _ options: Options) -> Document {
    let retainer = Retainer()
    var native = buildOptions(options, retainer)
    let handle = path.withCString { deon_parse_file($0, &native) }!
    return Document(handle, retainer)
}

/// Converts JSON to a Deon value, preserving each number's source spelling (specification 9.1).
public func readJSON(_ data: String, _ sourceName: String) -> Document {
    readJSONBytes(Array(data.utf8), sourceName)
}

/// The byte-clean core of ``readJSON``.
public func readJSONBytes(_ bytes: [UInt8], _ sourceName: String) -> Document {
    let retainer = Retainer()
    let name = retainer.dup(sourceName)
    let handle = withCBytes(bytes) { deon_read_json($0, $1, name) }!
    return Document(handle, retainer)
}

/// Fetches a Deon document from a URL and evaluates it. The network must be granted.
public func parseLink(_ link: String, _ options: Options) -> Document {
    let retainer = Retainer()
    var native = buildOptions(options, retainer)
    let handle = link.withCString { deon_parse_link($0, &native) }!
    return Document(handle, retainer)
}

/// What a document declares, without evaluating it. Returns the document (for its `ok`/`error`) and the
/// entities it declares, read while the document is alive.
public func entities(_ source: String, _ sourceName: String) -> (Document, [Entity]) {
    let retainer = Retainer()
    let name = retainer.dup(sourceName)
    var out: UnsafePointer<deon_entity>? = nil
    var count = 0
    let handle = withCSource(source) { deon_entities($0, $1, name, &out, &count) }!
    var result: [Entity] = []
    if deon_document_ok(handle), let out = out {
        for i in 0 ..< count {
            let entity = out[i]
            var parameters: [String] = []
            for p in 0 ..< entity.parameters_len {
                parameters.append(swiftString(entity.parameters![p]))
            }
            result.append(Entity(name: swiftString(entity.name), parameters: parameters,
                                  kind: String(cString: entity.kind)))
        }
    }
    return (Document(handle, retainer), result)
}

/// The diagnostics a document carries without throwing: what is legal and questionable.
public func lint(_ source: String, _ sourceName: String) -> [Diagnostic] {
    lintBytes(Array(source.utf8), sourceName)
}

/// The byte-clean core of ``lint``.
public func lintBytes(_ bytes: [UInt8], _ sourceName: String) -> [Diagnostic] {
    let retainer = Retainer()
    let name = retainer.dup(sourceName)
    var out: UnsafePointer<deon_diagnostic>? = nil
    var count = 0
    let handle = withCBytes(bytes) { deon_lint_document($0, $1, name, &out, &count) }!
    defer { deon_document_free(handle) }
    return readDiagnostics(out, count)
}

/// Reads a C array of diagnostics into Swift values, copying each string, so the array may be freed
/// afterwards. A null pointer or a zero count yields an empty list.
func readDiagnostics(_ pointer: UnsafePointer<deon_diagnostic>?, _ count: Int) -> [Diagnostic] {
    guard let pointer = pointer, count > 0 else {
        return []
    }
    var result: [Diagnostic] = []
    result.reserveCapacity(count)
    for i in 0 ..< count {
        let diagnostic = pointer[i]
        result.append(Diagnostic(
            code: String(cString: deon_code_name(diagnostic.code)),
            message: swiftString(diagnostic.message),
            line: Int(diagnostic.span.line),
            column: Int(diagnostic.span.column),
            source: diagnostic.span.source != nil ? String(cString: diagnostic.span.source!) : "<memory>",
            severity: diagnostic.severity == 1 ? "warning" : "error"))
    }
    return result
}
