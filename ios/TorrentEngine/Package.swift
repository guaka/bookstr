// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "TorrentEngine", platforms: [.iOS("18.0")],
    products: [.library(name: "TorrentEngine", targets: ["TorrentEngine"])],
    targets: [.binaryTarget(name: "TorrentEngine", path: "TorrentEngine.xcframework")])
