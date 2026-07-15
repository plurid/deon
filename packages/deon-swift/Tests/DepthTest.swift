@testable import Deon
import CDeon

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

// The nesting limit is enforced on a value built by hand and never parsed, the same way the parser
// enforces it on input (section 11.1). A too-deep value must fail through an error channel — the C
// writers return NULL and set DEON_PARSE_EXPECTED, which the Swift wrapper turns into a thrown
// `DeonError` — rather than a silent empty string or a crash.
//
// The Swift `Document` API can only write a parsed document's root, and the parser refuses a source that
// nests past the limit before a `Document` could ever hold one. So the hand-built value is assembled at
// the CDeon boundary — the very functions `Document.canonical()`/`stringify()`/`typed()` wrap — and the
// wrapper's own code-to-`DeonError` mapping is checked directly.

var failures = 0
func check(_ ok: Bool, _ what: String) {
    if ok { print("ok   \(what)") }
    else { print("FAIL \(what)"); failures += 1 }
}

// The hand-built nodes are left to be reclaimed when this one-shot process exits; the point of the test
// is the writers' refusal, not node bookkeeping.
func makeLeaf() -> UnsafeMutablePointer<deon_value> {
    var leaf = deon_value()
    leaf.kind = DEON_STRING
    leaf.as.string.data = strdup("leaf")
    leaf.as.string.len = 4
    let node = UnsafeMutablePointer<deon_value>.allocate(capacity: 1)
    node.initialize(to: leaf)
    return node
}

// A linear chain of `levels` nested lists with a leaf string at the bottom, so the leaf sits at depth
// `levels`. Built by hand — the parser never saw it.
func nestLists(_ levels: Int) -> UnsafeMutablePointer<deon_value> {
    var inner = makeLeaf()
    for _ in 0 ..< levels {
        let items = UnsafeMutablePointer<UnsafeMutablePointer<deon_value>?>.allocate(capacity: 1)
        items.initialize(to: inner)
        var list = deon_value()
        list.kind = DEON_LIST
        list.as.list.items = items
        list.as.list.len = 1
        list.as.list.cap = 1
        let node = UnsafeMutablePointer<deon_value>.allocate(capacity: 1)
        node.initialize(to: list)
        inner = node
    }
    return inner
}

// A live document, for its arena, to type into.
let document = deon_parse("{}", 2)

// ~130 deep: past the limit of 128 enclosing values.
let deep = nestLists(130)

var options = deon_default_stringify_options()

// The C writers the wrapper calls refuse the too-deep value with a NULL result and DEON_PARSE_EXPECTED.
do {
    var length = 0
    var code = DEON_OK
    let result = deon_stringify(deep, &options, &length, &code)
    check(result == nil && code == DEON_PARSE_EXPECTED, "stringify refuses a too-deep hand-built value")
    free(result)
}
do {
    var length = 0
    var code = DEON_OK
    let result = deon_canonical(deep, &length, &code)
    check(result == nil && code == DEON_PARSE_EXPECTED, "canonical refuses a too-deep hand-built value")
    free(result)
}
do {
    var code = DEON_OK
    let result = deon_typed(document, deep, &code)
    check(result == nil && code == DEON_PARSE_EXPECTED, "typed refuses a too-deep hand-built value")
}

// The wrapper turns that NULL + DEON_PARSE_EXPECTED into the DeonError it throws.
let thrown = writeError(DEON_PARSE_EXPECTED)
check(thrown.code == "DEON_PARSE_EXPECTED", "the wrapper throws a DeonError carrying the parse-expected code")

// A shallow value succeeds, with the OK code and a non-NULL result.
let shallow = nestLists(5)
do {
    var length = 0
    var code = DEON_PARSE_EXPECTED
    let result = deon_stringify(shallow, &options, &length, &code)
    check(result != nil && code == DEON_OK, "stringify accepts a shallow hand-built value")
    free(result)
}
do {
    var length = 0
    var code = DEON_PARSE_EXPECTED
    let result = deon_canonical(shallow, &length, &code)
    check(result != nil && code == DEON_OK, "canonical accepts a shallow hand-built value")
    free(result)
}
do {
    var code = DEON_PARSE_EXPECTED
    let result = deon_typed(document, shallow, &code)
    check(result != nil && code == DEON_OK, "typed accepts a shallow hand-built value")
}

deon_document_free(document)

if failures == 0 {
    print("all depth-guard checks passed")
    exit(0)
} else {
    fputs("\n\(failures) depth-guard failure(s)\n", stderr)
    exit(1)
}
