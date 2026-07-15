import Deon

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

// The network path over a loopback server. Nothing else exercises the socket: the differential harness
// uses in-memory resources, and every fixture that names the network is a denial. So this test binds a
// server to 127.0.0.1, never anything routable, and drives an import, a link, a non-success status, and
// a denial through it — the same C network code deon-c exercises, reached here through the binding.

var failures = 0

#if canImport(Darwin)
let streamType = SOCK_STREAM
#else
let streamType = Int32(SOCK_STREAM.rawValue)
#endif

func check(_ ok: Bool, _ what: String) {
    if ok {
        print("ok   \(what)")
    } else {
        print("FAIL \(what)")
        failures += 1
    }
}

func report(_ text: String) {
    let bytes = Array(text.utf8)
    bytes.withUnsafeBytes { _ = fwrite($0.baseAddress, 1, $0.count, stderr) }
}

/// Binds a stream socket to 127.0.0.1 on an ephemeral port and returns the listener and its port.
func loopbackListener() -> (Int32, Int32)? {
    let listener = socket(AF_INET, streamType, 0)
    if listener < 0 {
        return nil
    }
    var one: Int32 = 1
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr = in_addr(s_addr: in_addr_t(0x7F00_0001).bigEndian) // 127.0.0.1 — never routable
    addr.sin_port = 0

    let bound = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(listener, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    if bound != 0 || listen(listener, 8) != 0 {
        close(listener)
        return nil
    }

    var out = sockaddr_in()
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    withUnsafeMutablePointer(to: &out) {
        _ = $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            getsockname(listener, $0, &length)
        }
    }
    return (listener, Int32(UInt16(bigEndian: out.sin_port)))
}

func readRequest(_ fd: Int32) -> String {
    var buffer = [UInt8](repeating: 0, count: 2048)
    let n = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress, 2047) }
    if n <= 0 {
        return ""
    }
    return String(decoding: buffer[0 ..< n], as: UTF8.self)
}

func respond(_ fd: Int32, _ status: String, _ contentType: String, _ body: String) {
    let head = "HTTP/1.0 \(status)\r\nContent-Type: \(contentType)\r\n"
        + "Content-Length: \(Array(body.utf8).count)\r\nConnection: close\r\n\r\n"
    let bytes = Array((head + body).utf8)
    var offset = 0
    bytes.withUnsafeBytes { raw in
        while offset < raw.count {
            let wrote = write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
            if wrote <= 0 {
                break
            }
            offset += wrote
        }
    }
}

// The server runs on its own thread rather than a forked process — Swift's platform overlay makes
// `fork()` unavailable. The listener reaches the thread through this global; the thread reads no other
// state, so no lock crosses between them.
var serverListener: Int32 = -1

func serverThread(_ argument: UnsafeMutableRawPointer) -> UnsafeMutableRawPointer? {
    serve(serverListener)
    return nil
}

/// Serves the loopback documents forever: a Deon child, a JSON resource, and a 404 for `/missing`.
func serve(_ listener: Int32) {
    signal(SIGPIPE, SIG_IGN)
    while true {
        let fd = accept(listener, nil, nil)
        if fd < 0 {
            continue
        }
        let request = readRequest(fd)
        if request.contains("/data.json ") {
            respond(fd, "200 OK", "application/json", "{\"n\": 1.50}")
        } else if request.contains("/missing") {
            respond(fd, "404 Not Found", "application/deon", "no")
        } else {
            respond(fd, "200 OK", "application/deon", "{\n    inner value\n}\n")
        }
        close(fd)
    }
}

func run() -> Int32 {
    guard let (listener, port) = loopbackListener() else {
        report("cannot bind a loopback socket\n")
        return 2
    }

    serverListener = listener
    #if canImport(Darwin)
    var thread: pthread_t?
    #else
    var thread = pthread_t()
    #endif
    pthread_create(&thread, nil, serverThread, nil)

    let base = "http://127.0.0.1:\(port)"
    var network = Options()
    network.allowNetwork = true

    // an import over the network is evaluated and spread
    do {
        let document = Deon.parseWith("import c from \(base)/child.deon\n{\n    ...#c\n}\n", network)
        if case .string(let inner)? = lookup(document, "inner") {
            check(inner == "value", "import over http")
        } else {
            check(false, "import over http")
        }
    }

    // an injected JSON resource keeps its number's source spelling
    do {
        let document = Deon.parseWith("import j from \(base)/data.json\n{\n    ...#j\n}\n", network)
        if case .string(let n)? = lookup(document, "n") {
            check(n == "1.50", "json import preserves spelling")
        } else {
            check(false, "json import preserves spelling")
        }
    }

    // a non-success status is DEON_RESOURCE_IO: it was allowed and it failed
    do {
        let document = Deon.parseWith("import m from \(base)/missing\n{\n    #m\n}\n", network)
        check(!document.ok && document.error.code == "DEON_RESOURCE_IO", "non-success status is RESOURCE_IO")
    }

    // parse_link fetches and evaluates a document by URL
    do {
        let document = Deon.parseLink("\(base)/child.deon", network)
        check(document.ok, "parse_link over http")
    }

    // the network is refused before any socket opens when it was not granted
    do {
        let document = Deon.parse("import c from \(base)/child.deon\n{\n    #c\n}\n")
        check(!document.ok && document.error.code == "DEON_CAPABILITY_DENIED", "network denied by default")
    }

    if failures == 0 {
        print("\nall network cases passed")
        return 0
    }
    report("\n\(failures) network failure(s)\n")
    return 1
}

func lookup(_ document: Document, _ key: String) -> DeonValue? {
    guard document.ok, case .map(let entries) = document.value() else {
        return nil
    }
    for entry in entries where entry.key == key {
        return entry.value
    }
    return nil
}

exit(run())
