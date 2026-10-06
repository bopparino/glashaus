// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "GlasHausCore", platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "GlasHausCore", targets: ["GlasHausCore"])],
    targets: [
        .target(name: "GlasHausCore", path: "Shared"),
        .testTarget(name: "GlasHausCoreTests", dependencies: ["GlasHausCore"], path: "Tests")
    ]
)
