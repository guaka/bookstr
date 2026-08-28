// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "BookstrLogic",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "BookstrLogic", targets: ["BookstrLogic"]),
    ],
    targets: [
        .target(
            name: "BookstrLogic",
            path: "BookstrIOS/Sources",
            exclude: [
                "App",
                "Features/Library",
                "Features/Reader/EPUBReaderView.swift",
                "Features/Reader/PDFReaderView.swift",
                "Features/Reader/ReaderHostView.swift",
                "Features/Search/SearchView.swift",
                "Features/Settings",
                "Features/Words/WordsView.swift",
                "Nostr/Nip46Service.swift",
                "Nostr/NostrIdentity.swift",
                "Nostr/NostrSigner.swift",
                "Nostr/NostrSyncService.swift",
                "Shared/ScreenChrome.swift",
                "Shared/Theme.swift",
                "Data/CatalogRepository.swift",
            ],
            sources: [
                "Data/DictionaryRepository.swift",
                "Data/JSONFileStore.swift",
                "Data/KeychainStore.swift",
                "Data/ProgressRepository.swift",
                "Data/PublicationUtilities.swift",
                "Data/SettingsRepository.swift",
                "Data/VocabularyRepository.swift",
                "Features/Reader/SpeechPlaybackQueue.swift",
                "Features/Search/SearchFavoriteMatcher.swift",
                "Features/Words/WordFilterMatching.swift",
                "Nostr/Favorites.swift",
                "Nostr/NostrClient.swift",
                "Nostr/NostrModels.swift",
                "Shared/Generated/CatalogProviderRecordV1.swift",
                "Shared/Models.swift",
                "Shared/WordNavigationState.swift",
            ],
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .testTarget(
            name: "BookstrLogicTests",
            dependencies: ["BookstrLogic"],
            path: "BookstrIOS/Tests",
            exclude: ["AppContainerTests.swift"],
            sources: [
                "DictionaryRepositoryTests.swift",
                "CatalogProviderRecordV1ContractTests.swift",
                "FavoritesParserTests.swift",
                "NostrClientProgressTests.swift",
                "ProgressRepositoryTests.swift",
                "ReaderAssetContractTests.swift",
                "SettingsRepositoryTests.swift",
                "VocabularyRepositoryTests.swift",
                "WordNavigationStateTests.swift",
            ]
        ),
    ]
)
