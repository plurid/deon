// swift-tools-version:5.9
// The Swift distribution of Deon, as a local Swift Package Manager package. It is consumed by a local
// path dependency — `.package(path: ".../packages/deon-swift")` — not from a URL, so the manifest can
// live here in the package directory instead of at the repository root.
//
// Swift does not reimplement the specification; it wraps `deon-c`, the C implementation, so there is one
// parser, one evaluator, and one canonical writer, and nothing here can drift from them. SwiftPM will
// not reference a target path outside the package root, and the C sources are the sibling `deon-c`, so
// `Sources/CDeonImpl` is a symlink to `../../deon-c/source/deon`; SwiftPM follows it and compiles those
// sources in place. The public header is exposed through `deon-c`'s own `module.modulemap` (only
// `deon.h`, so an opaque `deon_document` imports as an `OpaquePointer`).
//
// The CLI, the harness adapter, and the tests are built by the `Makefile` (which the cross-implementation
// harness uses); this manifest exposes only the `Deon` library.
import PackageDescription

let package = Package(
    name: "deon-swift",
    products: [
        .library(name: "Deon", targets: ["Deon"]),
    ],
    targets: [
        .target(
            name: "CDeon",
            path: "Sources/CDeonImpl",
            publicHeadersPath: "."
        ),
        .target(
            name: "Deon",
            dependencies: ["CDeon"],
            path: "Sources/Deon"
        ),
    ],
    cLanguageStandard: .c17
)
