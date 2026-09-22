// swift-tools-version: 5.9
// Standalone package metadata for the prebuilt XCFramework.
// The BookstrIOS app links TorrentEngine.xcframework directly via XcodeGen
// (see ios/project.yml). Do not re-add this as an SPM local package in the
// app project — a missing gitignored binaryTarget breaks package resolution.
import PackageDescription

let package = Package(
    name: "TorrentEngine",
    platforms: [.iOS("18.0")],
    products: [
        .library(name: "TorrentEngine", targets: ["TorrentEngine"])
    ],
    targets: [
        .binaryTarget(name: "TorrentEngine", path: "TorrentEngine.xcframework")
    ]
)
