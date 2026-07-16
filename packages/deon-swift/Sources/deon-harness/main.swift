import Deon

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

// The cross-implementation harness adapter (spec/harness/README.md). A filter: newline-delimited JSON
// in, newline-delimited JSON out. Every value in a request and a response is a string, so the request
// itself parses with the implementation's own JSON reader and no third-party decoder is needed.

// #region request field access
private func field(_ v: DeonValue, _ key: String) -> DeonValue? {
    if case .map(let entries) = v {
        for entry in entries where entry.key == key {
            return entry.value
        }
    }
    return nil
}

private func fieldString(_ v: DeonValue, _ key: String, _ fallback: String) -> String {
    if case .string(let s)? = field(v, key) {
        return s
    }
    return fallback
}

private func stringMap(_ v: DeonValue, _ key: String) -> [String: String] {
    var out: [String: String] = [:]
    if case .map(let entries)? = field(v, key) {
        for entry in entries {
            if case .string(let s) = entry.value {
                out[entry.key] = s
            } else {
                out[entry.key] = ""
            }
        }
    }
    return out
}

private func stringList(_ v: DeonValue, _ key: String) -> [String] {
    var out: [String] = []
    if case .list(let items)? = field(v, key) {
        for item in items {
            if case .string(let s) = item {
                out.append(s)
            } else {
                out.append("")
            }
        }
    }
    return out
}
// #endregion

private func optionsOf(_ request: DeonValue) -> Options {
    var o = Options()
    o.sourceName = fieldString(request, "sourceName", "<memory>")
    o.filebase = fieldString(request, "filebase", "")
    o.resources = stringMap(request, "files")
    o.absolutePaths = stringMap(request, "absolutePaths")
    o.environment = stringMap(request, "environment")
    o.allowFilesystem = fieldString(request, "allowFilesystem", "false") == "true"
    o.allowNetwork = fieldString(request, "allowNetwork", "false") == "true"
    o.datasignFiles = stringList(request, "datasignFiles")
    o.datasignMap = stringMap(request, "datasignMap")
    return o
}

private func stringifyOptionsOf(_ request: DeonValue) -> StringifyOptions {
    var o = StringifyOptions()
    guard let raw = field(request, "stringifyOptions"), case .map = raw else {
        return o
    }
    func flag(_ key: String, _ fallback: Bool) -> Bool {
        if case .string(let s)? = field(raw, key) {
            return s == "true"
        }
        return fallback
    }
    func number(_ key: String, _ fallback: Int) -> Int {
        if case .string(let s)? = field(raw, key), let n = Int(s) {
            return n
        }
        return fallback
    }
    o.canonical = flag("canonical", false)
    o.readable = flag("readable", true)
    o.leaflinks = flag("leaflinks", false)
    o.leaflinkShortening = flag("leaflinkShortening", true)
    o.generatedHeader = flag("generatedHeader", false)
    o.generatedComments = flag("generatedComments", false)
    o.indentation = number("indentation", 4)
    o.leaflinkLevel = number("leaflinkLevel", 1)
    return o
}

// #region responses
private func okResponse(_ id: String, _ result: String) -> String {
    "{\"id\":\(jsonQuote(id)),\"ok\":\"true\",\"result\":\(jsonQuote(result))}"
}

private func errorResponse(_ id: String, _ error: DeonError) -> String {
    "{\"id\":\(jsonQuote(id)),\"ok\":\"false\",\"code\":\(jsonQuote(error.code))"
        + ",\"severity\":\(jsonQuote(error.severity)),\"start\":\"\(error.start)\""
        + ",\"line\":\"\(error.line)\",\"column\":\"\(error.column)\"}"
}

private func panicResponse(_ id: String) -> String {
    "{\"id\":\(jsonQuote(id)),\"ok\":\"false\",\"code\":\"HOST_PANIC\",\"line\":\"0\",\"column\":\"0\"}"
}
// #endregion

private func perform(_ request: DeonValue, _ id: String) -> String {
    let op = fieldString(request, "op", "")
    let source = fieldString(request, "source", "")
    let sourceName = fieldString(request, "sourceName", "<memory>")

    // entities and lint reach nothing and need no capability.
    if op == "entities" {
        let (document, entities) = Deon.entities(source, sourceName)
        if let error = document.error {
            return errorResponse(id, error)
        }
        var j = "["
        for (i, entity) in entities.enumerated() {
            if i > 0 {
                j += ","
            }
            j += "{\"name\":\(jsonQuote(entity.name)),\"parameters\":["
            for (p, parameter) in entity.parameters.enumerated() {
                if p > 0 {
                    j += ","
                }
                j += jsonQuote(parameter)
            }
            j += "],\"kind\":\(jsonQuote(entity.kind))}"
        }
        j += "]"
        return okResponse(id, j)
    }

    if op == "lint" {
        var j = "["
        for (i, diagnostic) in Deon.lint(source, sourceName).enumerated() {
            if i > 0 {
                j += ","
            }
            j += "{\"code\":\(jsonQuote(diagnostic.code)),\"line\":\"\(diagnostic.line)\""
            j += ",\"column\":\"\(diagnostic.column)\"}"
        }
        j += "]"
        return okResponse(id, j)
    }

    let document = Deon.parseWith(source, optionsOf(request))
    if let error = document.error {
        return errorResponse(id, error)
    }
    do {
        switch op {
        case "canonical":
            return okResponse(id, try document.canonical())
        case "stringify":
            return okResponse(id, try document.stringify(stringifyOptionsOf(request)))
        case "typed":
            return okResponse(id, try document.typed().json())
        default:
            break
        }
    } catch let error as DeonError {
        return errorResponse(id, error)
    } catch {
        return panicResponse(id)
    }
    switch op {
    case "datasign":
        guard let root = document.value() else { return panicResponse(id) }
        return okResponse(id, root.json()) // parseWith already applied the contracts
    default:
        return panicResponse(id)
    }
}

private func answer(_ request: DeonValue) -> String {
    let id = fieldString(request, "id", "")
    return perform(request, id)
}

private func emit(_ line: String) {
    var bytes = Array(line.utf8)
    bytes.append(0x0A)
    bytes.withUnsafeBytes { _ = fwrite($0.baseAddress, 1, $0.count, stdout) }
    fflush(stdout)
}

while let line = readLine(strippingNewline: true) {
    if line.isEmpty {
        continue
    }
    let request = Deon.readJSON(line, "<request>")
    guard request.ok, let root = request.value(), case .map = root else {
        continue
    }
    emit(answer(root))
}
