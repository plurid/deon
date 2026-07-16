import Deon

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

// The normative conformance suite (specification 15). An implementation conforms to Deon 1.0 only when
// it passes every required fixture in spec/conformance/cases.json. The fixtures are language-neutral and
// shared by every implementation, read from the repository rather than copied. This runner carries its
// own typed JSON reader — unlike the library's, which flattens every scalar to a string — because the
// `typed` and `datasign` fixtures assert that a boolean is a boolean and a number is a number.

let manifestPath = "../../spec/conformance/cases.json"

// #region a typed JSON value and its reader
indirect enum JSON {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([(String, JSON)])
}

struct JSONReader {
    let bytes: [UInt8]
    var i = 0
    var ok = true

    init(_ bytes: [UInt8]) {
        self.bytes = bytes
    }

    mutating func skipSpace() {
        while i < bytes.count {
            let c = bytes[i]
            if c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D {
                i += 1
            } else {
                break
            }
        }
    }

    mutating func value() -> JSON {
        skipSpace()
        guard i < bytes.count else {
            ok = false
            return .null
        }
        switch bytes[i] {
        case 0x7B: return object()
        case 0x5B: return array()
        case 0x22: return .string(string())
        case 0x74: return literal("true", .bool(true))
        case 0x66: return literal("false", .bool(false))
        case 0x6E: return literal("null", .null)
        default: return number()
        }
    }

    mutating func literal(_ text: String, _ result: JSON) -> JSON {
        let want = Array(text.utf8)
        guard i + want.count <= bytes.count, Array(bytes[i ..< i + want.count]) == want else {
            ok = false
            return .null
        }
        i += want.count
        return result
    }

    mutating func number() -> JSON {
        let start = i
        if i < bytes.count && bytes[i] == 0x2D {
            i += 1
        }
        while i < bytes.count {
            let c = bytes[i]
            if (c >= 0x30 && c <= 0x39) || c == 0x2E || c == 0x65 || c == 0x45 || c == 0x2B || c == 0x2D {
                i += 1
            } else {
                break
            }
        }
        if i == start {
            ok = false
            return .null
        }
        let text = String(decoding: bytes[start ..< i], as: UTF8.self)
        return .number(Double(text) ?? 0)
    }

    mutating func hex(_ at: Int) -> Int {
        let c = bytes[at]
        if c >= 0x30 && c <= 0x39 { return Int(c - 0x30) }
        if c >= 0x61 && c <= 0x66 { return Int(c - 0x61 + 10) }
        if c >= 0x41 && c <= 0x46 { return Int(c - 0x41 + 10) }
        return -1
    }

    mutating func string() -> String {
        i += 1 // opening quote
        var scalars = String.UnicodeScalarView()
        while i < bytes.count {
            let c = bytes[i]
            i += 1
            if c == 0x22 {
                return String(scalars)
            }
            if c == 0x5C {
                guard i < bytes.count else {
                    break
                }
                let e = bytes[i]
                i += 1
                switch e {
                case 0x22: scalars.append("\"")
                case 0x5C: scalars.append("\\")
                case 0x2F: scalars.append("/")
                case 0x62: scalars.append("\u{08}")
                case 0x66: scalars.append("\u{0C}")
                case 0x6E: scalars.append("\n")
                case 0x72: scalars.append("\r")
                case 0x74: scalars.append("\t")
                case 0x75:
                    var value = readHex4()
                    if value >= 0xD800 && value <= 0xDBFF && i + 1 < bytes.count
                        && bytes[i] == 0x5C && bytes[i + 1] == 0x75 {
                        i += 2
                        let low = readHex4()
                        if low >= 0xDC00 && low <= 0xDFFF {
                            value = 0x10000 + ((value - 0xD800) << 10) + (low - 0xDC00)
                        }
                    }
                    scalars.append(Unicode.Scalar(value) ?? Unicode.Scalar(0xFFFD)!)
                default:
                    ok = false
                }
            } else if c < 0x80 {
                scalars.append(Unicode.Scalar(c))
            } else {
                // a raw UTF-8 byte sequence: gather the continuation bytes and decode.
                var unit = [c]
                let count = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : 1
                for _ in 0 ..< count where i < bytes.count {
                    unit.append(bytes[i])
                    i += 1
                }
                for scalar in String(decoding: unit, as: UTF8.self).unicodeScalars {
                    scalars.append(scalar)
                }
            }
        }
        ok = false
        return String(scalars)
    }

    mutating func readHex4() -> Int {
        guard i + 4 <= bytes.count else {
            ok = false
            return 0xFFFD
        }
        var value = 0
        for k in 0 ..< 4 {
            let digit = hex(i + k)
            if digit < 0 {
                ok = false
                return 0xFFFD
            }
            value = (value << 4) | digit
        }
        i += 4
        return value
    }

    mutating func array() -> JSON {
        i += 1 // '['
        var items: [JSON] = []
        skipSpace()
        if i < bytes.count && bytes[i] == 0x5D {
            i += 1
            return .array(items)
        }
        while true {
            items.append(value())
            if !ok {
                return .array(items)
            }
            skipSpace()
            if i < bytes.count && bytes[i] == 0x2C {
                i += 1
                continue
            }
            if i < bytes.count && bytes[i] == 0x5D {
                i += 1
                break
            }
            ok = false
            break
        }
        return .array(items)
    }

    mutating func object() -> JSON {
        i += 1 // '{'
        var entries: [(String, JSON)] = []
        skipSpace()
        if i < bytes.count && bytes[i] == 0x7D {
            i += 1
            return .object(entries)
        }
        while true {
            skipSpace()
            guard i < bytes.count && bytes[i] == 0x22 else {
                ok = false
                break
            }
            let key = string()
            skipSpace()
            guard i < bytes.count && bytes[i] == 0x3A else {
                ok = false
                break
            }
            i += 1
            let v = value()
            entries.append((key, v))
            if !ok {
                break
            }
            skipSpace()
            if i < bytes.count && bytes[i] == 0x2C {
                i += 1
                continue
            }
            if i < bytes.count && bytes[i] == 0x7D {
                i += 1
                break
            }
            ok = false
            break
        }
        return .object(entries)
    }
}

extension JSON {
    func get(_ key: String) -> JSON? {
        if case .object(let entries) = self {
            for entry in entries where entry.0 == key {
                return entry.1
            }
        }
        return nil
    }

    var asString: String? {
        if case .string(let s) = self {
            return s
        }
        return nil
    }

    var asDouble: Double? {
        if case .number(let n) = self {
            return n
        }
        return nil
    }

    var asArray: [JSON]? {
        if case .array(let items) = self {
            return items
        }
        return nil
    }

    var asObject: [(String, JSON)]? {
        if case .object(let entries) = self {
            return entries
        }
        return nil
    }
}
// #endregion

// #region matching a Deon value against typed JSON
private func lookup(_ v: DeonValue, _ key: String) -> DeonValue? {
    if case .map(let entries) = v {
        for entry in entries where entry.key == key {
            return entry.value
        }
    }
    return nil
}

private func matches(_ v: DeonValue, _ j: JSON) -> Bool {
    switch j {
    case .string(let s):
        if case .string(let t) = v { return s == t }
        return false
    case .array(let items):
        guard case .list(let values) = v, values.count == items.count else {
            return false
        }
        for i in 0 ..< items.count where !matches(values[i], items[i]) {
            return false
        }
        return true
    case .object(let entries):
        guard case .map(let pairs) = v, pairs.count == entries.count else {
            return false
        }
        for (key, want) in entries {
            guard let got = lookup(v, key), matches(got, want) else {
                return false
            }
        }
        return true
    default:
        return false
    }
}

private func typedMatches(_ v: DeonValue, _ j: JSON) -> Bool {
    switch j {
    case .bool(let b):
        if case .bool(let t) = v { return b == t }
        return false
    case .number(let n):
        if case .number(let t) = v { return t == n || abs(t - n) < 1e-9 }
        return false
    case .string(let s):
        if case .string(let t) = v { return s == t }
        return false
    case .array(let items):
        guard case .list(let values) = v, values.count == items.count else {
            return false
        }
        for i in 0 ..< items.count where !typedMatches(values[i], items[i]) {
            return false
        }
        return true
    case .object(let entries):
        guard case .map(let pairs) = v, pairs.count == entries.count else {
            return false
        }
        for (key, want) in entries {
            guard let got = lookup(v, key), typedMatches(got, want) else {
                return false
            }
        }
        return true
    case .null:
        if case .string = v { return true }
        return false
    }
}
// #endregion

// #region options
private func stringMap(_ j: JSON?) -> [String: String] {
    var out: [String: String] = [:]
    if let entries = j?.asObject {
        for (key, value) in entries {
            out[key] = value.asString ?? ""
        }
    }
    return out
}

private func optionsOf(_ c: JSON) -> Options {
    var o = Options()
    o.resources = stringMap(c.get("files"))
    if let file = c.get("file")?.asString {
        o.sourceName = file
        if let slash = file.lastIndex(of: "/") {
            o.filebase = String(file[file.startIndex ..< slash])
        } else {
            o.filebase = "."
        }
    }
    o.environment = stringMap(c.get("environment"))
    if let datasign = c.get("datasign") {
        o.datasignMap = stringMap(datasign.get("map"))
        if let files = datasign.get("files")?.asArray {
            o.datasignFiles = files.map { $0.asString ?? "" }
        }
    }
    if let opts = c.get("options"), case .object = opts {
        o.absolutePaths = stringMap(opts.get("absolutePaths"))
        if case .bool(let allow)? = opts.get("allowFilesystem") {
            o.allowFilesystem = allow
        }
        if case .bool(let allow)? = opts.get("allowNetwork") {
            o.allowNetwork = allow
        }
        if let name = opts.get("sourceName")?.asString {
            o.sourceName = name
        }
        if let base = opts.get("filebase")?.asString {
            o.filebase = base
        }
    }
    return o
}

private func sourceOf(_ c: JSON) -> String {
    if let file = c.get("file")?.asString {
        return c.get("files")?.get(file)?.asString ?? ""
    }
    return c.get("source")?.asString ?? ""
}

private func stringifyOptionsOf(_ j: JSON?) -> StringifyOptions {
    var o = StringifyOptions()
    guard let opts = j, case .object = opts else {
        return o
    }
    func flag(_ key: String, _ fallback: Bool) -> Bool {
        if case .bool(let b)? = opts.get(key) { return b }
        return fallback
    }
    o.canonical = flag("canonical", false)
    o.readable = flag("readable", true)
    o.leaflinks = flag("leaflinks", false)
    o.leaflinkShortening = flag("leaflinkShortening", true)
    o.generatedHeader = flag("generatedHeader", false)
    o.generatedComments = flag("generatedComments", false)
    if let n = opts.get("indentation")?.asDouble {
        o.indentation = Int(n)
    }
    if let n = opts.get("leaflinkLevel")?.asDouble {
        o.leaflinkLevel = Int(n)
    }
    return o
}
// #endregion

// #region the runner
struct Coverage: Equatable {
    var expected = 0, errored = 0, position = 0, canonical = 0
    var stringify = 0, typed = 0, lint = 0, datasign = 0
}

var failures = 0

func fail(_ id: String, _ message: String) {
    report("FAIL \(id): \(message)\n")
    failures += 1
}

func report(_ s: String) {
    let bytes = Array(s.utf8)
    bytes.withUnsafeBytes { _ = fwrite($0.baseAddress, 1, $0.count, stderr) }
}

private func matchError(_ c: JSON, _ document: Document, _ id: String, _ did: inout Coverage) -> Bool {
    let want = c.get("error")?.asString ?? ""
    guard let error = document.error else {
        fail(id, "expected \(want), but it evaluated")
        return false
    }
    if error.code != want {
        fail(id, "expected \(want), got \(error.code)")
        return false
    }
    did.errored += 1
    if let position = c.get("position"), case .object = position {
        let line = Int(position.get("line")?.asDouble ?? 0)
        let column = Int(position.get("column")?.asDouble ?? 0)
        if error.line != line || error.column != column {
            fail(id, "position: expected \(line):\(column), got \(error.line):\(error.column)")
            return false
        }
        did.position += 1
    }
    return true
}

private func runCase(_ c: JSON, _ did: inout Coverage) {
    let id = c.get("id")?.asString ?? "?"
    let source = sourceOf(c)
    let options = optionsOf(c)

    if let datasign = c.get("datasign") {
        let document = Deon.parseWith(source, options)
        if c.get("error") != nil {
            if matchError(c, document, id, &did) {
                did.datasign += 1
            }
        } else if !document.ok {
            fail(id, "datasign: \(document.error?.code ?? "?")")
        } else if let want = datasign.get("typed"), let root = document.value(), typedMatches(root, want) {
            did.datasign += 1
        } else {
            fail(id, "datasign: value does not match")
        }
        return
    }

    if c.get("error") != nil {
        let document = Deon.parseWith(source, options)
        _ = matchError(c, document, id, &did)
        return
    }

    var asserted = false

    if let expected = c.get("expected") {
        let document = Deon.parseWith(source, options)
        if !document.ok {
            fail(id, "expected a value, got \(document.error?.code ?? "?")")
        } else if let root = document.value(), matches(root, expected) {
            did.expected += 1
            asserted = true
        } else {
            fail(id, "value does not match expected")
        }
    }

    if let canonical = c.get("canonical")?.asString {
        let document = Deon.parseWith(source, options)
        if !document.ok {
            fail(id, "canonical: \(document.error?.code ?? "?")")
        } else if try! document.canonical() == canonical {
            did.canonical += 1
            asserted = true
        } else {
            fail(id, "canonical mismatch")
        }
    }

    if let stringify = c.get("stringify"), case .object = stringify {
        let document = Deon.parseWith(source, options)
        if !document.ok {
            fail(id, "stringify: \(document.error?.code ?? "?")")
        } else {
            let produced = try! document.stringify(stringifyOptionsOf(stringify.get("options")))
            if produced == (stringify.get("expected")?.asString ?? "\u{0}mismatch") {
                did.stringify += 1
                asserted = true
            } else {
                fail(id, "stringify mismatch")
            }
        }
    }

    if let typed = c.get("typed") {
        let document = Deon.parseWith(source, options)
        if !document.ok {
            fail(id, "typed: \(document.error?.code ?? "?")")
        } else if typedMatches(try! document.typed(), typed) {
            did.typed += 1
            asserted = true
        } else {
            fail(id, "typed does not match")
        }
    }

    if let lint = c.get("lint")?.asArray {
        let name = options.sourceName.isEmpty ? "<memory>" : options.sourceName
        let produced = Deon.lint(source, name)
        var all = true
        for want in lint {
            let code = want.asString ?? ""
            if !produced.contains(where: { $0.code == code }) {
                fail(id, "expected lint \(code)")
                all = false
                break
            }
        }
        if all {
            did.lint += 1
            asserted = true
        }
    }

    if !asserted {
        fail(id, "the fixture asserts nothing")
    }
}

/// The round-trip invariant of section 13: parse(canonical(v)) == v over every non-error case. Canonical
/// form is deterministic, so value equality is the same claim as canonical-form equality.
private func roundTrip(_ c: JSON) {
    let id = c.get("id")?.asString ?? "?"
    if c.get("error") != nil || c.get("feature") != nil {
        return
    }
    let document = Deon.parseWith(sourceOf(c), optionsOf(c))
    if !document.ok {
        return
    }
    let canonical = try! document.canonical()
    if try! Deon.parse(canonical).canonical() != canonical {
        fail(id, "parse(canonical(v)) != v")
    }
}

private func invariants() {
    // a rewritten key stringifies at its final write position (section 5)
    let rewritten = try! Deon.parse("{ a one\nb two\na three }").stringify(StringifyOptions())
    if rewritten != "{\n    b two\n    a three\n}\n" {
        fail("rewritten-key", "unexpected: \(rewritten)")
    }

    // a column counts code points, not bytes
    let document = Deon.parse("{\n    \u{43A}\u{43B}\u{44E}\u{447} value\n}\n")
    if document.ok {
        fail("column-code-points", "expected an error")
    } else if document.error?.line != 2 || document.error?.column != 5 {
        fail("column-code-points", "expected 2:5, got \(document.error?.line ?? 0):\(document.error?.column ?? 0)")
    }
}

// The binding must not trap on the unhappy path. A failed parse has no C root, so `value()` is nil rather
// than a crash; and a well-formed document carries no diagnostic, so `error` is nil rather than a
// fabricated DEON_OK. (A failed parse still reports its error; a good parse still yields its value.)
private func crashSafety() {
    let broken = Deon.parse("'unterminated")   // a single-quoted string that never closes: no root
    if broken.ok {
        fail("crash-safety", "the invalid document was expected to fail")
    }
    if broken.value() != nil {                  // nil, and — the point of the fix — no trap
        fail("crash-safety", "value() on a failed parse must be nil")
    }
    if broken.error == nil {
        fail("crash-safety", "a failed parse must still carry an error")
    }

    let good = Deon.parse("{ a b }")            // well formed: a value, and no error
    if good.error != nil {
        fail("crash-safety", "error must be nil on success")
    }
    if good.value() == nil {
        fail("crash-safety", "value() on a good parse must not be nil")
    }
}
// #endregion

func run() -> Int32 {
    guard let raw = readManifest(manifestPath) else {
        report("cannot open \(manifestPath)\n")
        return 2
    }
    var reader = JSONReader(raw)
    let manifest = reader.value()
    guard reader.ok, let cases = manifest.get("cases")?.asArray else {
        report("cannot parse the manifest\n")
        return 2
    }

    var did = Coverage()
    var want = Coverage()
    var ran = 0
    for c in cases {
        if let feature = c.get("feature")?.asString, feature != "datasign" {
            continue
        }
        ran += 1
        if c.get("expected") != nil { want.expected += 1 }
        if c.get("error") != nil { want.errored += 1 }
        if c.get("position") != nil { want.position += 1 }
        if c.get("canonical") != nil { want.canonical += 1 }
        if c.get("stringify") != nil { want.stringify += 1 }
        if c.get("typed") != nil { want.typed += 1 }
        if c.get("lint") != nil { want.lint += 1 }
        if c.get("datasign") != nil { want.datasign += 1 }
        runCase(c, &did)
        roundTrip(c)
    }

    invariants()
    crashSafety()

    if did != want {
        report("coverage mismatch:\n  checked:  \(did)\n  declared: \(want)\n")
        failures += 1
    }

    if failures == 0 {
        print("all \(ran) conformance cases passed (code and position)")
        return 0
    }
    report("\n\(failures) failure(s) across \(ran) cases\n")
    return 1
}

private func readManifest(_ path: String) -> [UInt8]? {
    guard let f = fopen(path, "rb") else {
        return nil
    }
    defer { fclose(f) }
    fseek(f, 0, SEEK_END)
    let size = ftell(f)
    rewind(f)
    if size <= 0 {
        return []
    }
    var bytes = [UInt8](repeating: 0, count: size)
    let got = bytes.withUnsafeMutableBytes { fread($0.baseAddress, 1, size, f) }
    if got < size {
        bytes.removeLast(size - got)
    }
    return bytes
}

exit(run())
