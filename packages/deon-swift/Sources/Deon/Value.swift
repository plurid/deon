import CDeon

/// A Deon value is exactly one of three things — a string, an ordered list, or an ordered map. There is
/// no null, no Boolean, and no number in the data model; ``bool`` and ``number`` appear only as the
/// output of the conservative typer (specification 14), which is a view of a value rather than a value.
public indirect enum DeonValue {
    case string(String)
    case list([DeonValue])
    case map([(key: String, value: DeonValue)])
    case bool(Bool)
    case number(Double)
}

/// Reads a Swift string out of a `deon_str` — the length is authoritative, and the terminator is a
/// convenience, so a string carrying an embedded NUL survives.
func swiftString(_ s: deon_str) -> String {
    guard let data = s.data, s.len > 0 else {
        return ""
    }
    return String(decoding: UnsafeRawBufferPointer(start: data, count: s.len), as: UTF8.self)
}

/// Bridges a C `deon_value` tree into a Swift ``DeonValue``. The value lives in its document's arena, so
/// the document must outlive this call — which it does, because every caller reads before it frees.
func bridge(_ pointer: UnsafeMutablePointer<deon_value>) -> DeonValue {
    let value = pointer.pointee
    switch value.kind {
    case DEON_STRING:
        return .string(swiftString(value.as.string))
    case DEON_BOOL:
        return .bool(value.as.boolean)
    case DEON_NUMBER:
        return .number(value.as.number)
    case DEON_LIST:
        let list = value.as.list
        var items: [DeonValue] = []
        items.reserveCapacity(list.len)
        for i in 0 ..< list.len {
            items.append(bridge(list.items![i]!))
        }
        return .list(items)
    case DEON_MAP:
        let map = value.as.map
        var entries: [(key: String, value: DeonValue)] = []
        entries.reserveCapacity(map.len)
        for i in 0 ..< map.len {
            entries.append((swiftString(map.keys![i]), bridge(map.values![i]!)))
        }
        return .map(entries)
    default:
        return .string("")
    }
}

extension DeonValue {
    /// Serialises the value as compact JSON. A typer's Boolean and number are written as a JSON Boolean
    /// and number; every other scalar stays a string, and a map keeps its write order.
    public func json() -> String {
        var out = ""
        writeJSON(into: &out)
        return out
    }

    private func writeJSON(into out: inout String) {
        switch self {
        case .string(let s):
            out += JSON.quote(s)
        case .bool(let b):
            out += b ? "true" : "false"
        case .number(let n):
            out += JSON.number(n)
        case .list(let items):
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 {
                    out += ","
                }
                item.writeJSON(into: &out)
            }
            out += "]"
        case .map(let entries):
            out += "{"
            for (i, entry) in entries.enumerated() {
                if i > 0 {
                    out += ","
                }
                out += JSON.quote(entry.key)
                out += ":"
                entry.value.writeJSON(into: &out)
            }
            out += "}"
        }
    }
}

/// Quotes a string as a JSON string literal. The command line tool and the harness adapter build their
/// response envelopes by hand, and this is how they spell a string inside one.
public func jsonQuote(_ s: String) -> String {
    JSON.quote(s)
}

/// Shared JSON scalar formatting, so the harness adapter and the command line tool spell a string and a
/// number the same way every sibling does.
enum JSON {
    static func quote(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 {
                    let hex = String(scalar.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }

    /// The typer yields whole numbers as whole doubles; write those without a decimal point, as every
    /// sibling does, so 42 is 42 and not 42.0. `Int64(exactly:)` guards the conversion — a whole number
    /// beyond the Int64 range falls through rather than trapping.
    static func number(_ n: Double) -> String {
        if n.isFinite, let whole = Int64(exactly: n) {
            return String(whole)
        }
        return String(n)
    }
}
