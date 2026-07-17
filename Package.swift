// swift-tools-version:5.9
// The Swift distribution of Deon, declared at the repository root so that Swift Package Manager can
// reach the C sources it binds. Swift does not reimplement the specification — it wraps `deon-c`, the C
// implementation, so there is one parser, one evaluator, and one canonical writer, and nothing here can
// drift from them. The CLI, the harness adapter, and the tests are built by `packages/deon-swift/Makefile`
// (which the cross-implementation harness uses); this manifest exposes only the `Deon` library.
import PackageDescription

let package = Package(
    name: "deon",
    products: [
        .library(name: "Deon", targets: ["Deon"]),
    ],
    targets: [
        .target(
            name: "CDeon",
            path: "packages/deon-c/source/deon",
            publicHeadersPath: "."
        ),
        .target(
            name: "Deon",
            dependencies: ["CDeon"],
            path: "packages/deon-swift/Sources/Deon"
        ),
    ],
    cLanguageStandard: .c17
)
