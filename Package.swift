// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "app-store-slides-tool",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "app-store-slides-tool", targets: ["AppStoreSlidesTool"])
    ],
    targets: [
        .executableTarget(name: "AppStoreSlidesTool")
    ]
)
