import Deon

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

// The response cache, keyed by a digest of the credential (specification 9). The proof that the cache is
// a cache is that a second fetch succeeds after the server is gone; the proof that the digest separates
// credentials is that a fetch under a different token, against the same URL, misses and so fails. It is
// the same C cache and network code deon-c exercises, reached here through the binding.

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

// The server serves exactly one request, then closes the listener and ends — so a later fetch that
// misses the cache finds nothing there to connect to.
var serverListener: Int32 = -1

func serverThread(_ argument: UnsafeMutableRawPointer) -> UnsafeMutableRawPointer? {
    let fd = accept(serverListener, nil, nil)
    if fd >= 0 {
        var scratch = [UInt8](repeating: 0, count: 2048)
        _ = scratch.withUnsafeMutableBytes { read(fd, $0.baseAddress, 2047) }
        let body = "{\n    inner value\n}\n"
        let response = "HTTP/1.0 200 OK\r\nContent-Type: application/deon\r\n"
            + "Content-Length: \(Array(body.utf8).count)\r\nConnection: close\r\n\r\n" + body
        let bytes = Array(response.utf8)
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
        close(fd)
    }
    close(serverListener)
    return nil
}

/// True when the directory holds a digest-named entry — a 64-character hex name (specification 9).
func hasDigestEntry(_ directory: String) -> Bool {
    guard let handle = opendir(directory) else {
        return false
    }
    defer { closedir(handle) }
    while let entry = readdir(handle) {
        let name = withUnsafeBytes(of: entry.pointee.d_name) { raw -> String in
            let bytes = raw.bindMemory(to: UInt8.self)
            var chars: [UInt8] = []
            for byte in bytes {
                if byte == 0 {
                    break
                }
                chars.append(byte)
            }
            return String(decoding: chars, as: UTF8.self)
        }
        if !name.hasPrefix(".") && name.count == 64 {
            return true
        }
    }
    return false
}

func removeDirectory(_ directory: String) {
    if let handle = opendir(directory) {
        while let entry = readdir(handle) {
            let name = withUnsafeBytes(of: entry.pointee.d_name) { raw -> String in
                let bytes = raw.bindMemory(to: UInt8.self)
                var chars: [UInt8] = []
                for byte in bytes {
                    if byte == 0 {
                        break
                    }
                    chars.append(byte)
                }
                return String(decoding: chars, as: UTF8.self)
            }
            if name.hasPrefix(".") {
                continue
            }
            "\(directory)/\(name)".withCString { _ = remove($0) }
        }
        closedir(handle)
    }
    directory.withCString { _ = rmdir($0) }
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

    var template = Array("/tmp/deon-swift-cache-XXXXXX\u{0}".utf8).map { Int8(bitPattern: $0) }
    guard let directoryPointer = mkdtemp(&template) else {
        report("cannot make a temporary directory\n")
        return 2
    }
    let directory = String(cString: directoryPointer)

    let source = "import c from http://127.0.0.1:\(port)/child.deon\n{\n    ...#c\n}\n"

    var options = Options()
    options.allowNetwork = true
    options.cache = true
    options.cacheDirectory = directory
    options.authorization = ["127.0.0.1": "secret"]

    // the first fetch reaches the one-shot server and writes the cache
    let first = Deon.parseWith(source, options)
    check(first.ok && mapHas(first, "inner"), "first fetch reaches the server")

    check(hasDigestEntry(directory), "a digest-named cache entry is written")

    // the second fetch, same credential, is served from the cache — the server is gone
    let second = Deon.parseWith(source, options)
    check(second.ok && mapHas(second, "inner"), "second fetch is served from cache")

    // a different credential is a different key, so it misses — and with the server gone, fails
    options.authorization = ["127.0.0.1": "other"]
    let third = Deon.parseWith(source, options)
    check(!third.ok && third.error.code == "DEON_RESOURCE_IO", "a different token misses the cache")

    removeDirectory(directory)

    if failures == 0 {
        print("\nall cache cases passed")
        return 0
    }
    report("\n\(failures) cache failure(s)\n")
    return 1
}

func mapHas(_ document: Document, _ key: String) -> Bool {
    guard document.ok, case .map(let entries) = document.value() else {
        return false
    }
    return entries.contains { $0.key == key }
}

exit(run())
