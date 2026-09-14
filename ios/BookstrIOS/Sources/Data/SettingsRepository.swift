import Foundation
import Combine

final class SettingsRepository: ObservableObject {
    private let defaults: UserDefaults
    private let keychain: any SecureStringStore

    private enum Keys {
        static let relays = "relays"
        static let theme = "theme"
        static let readerFont = "reader_font"
        static let readerAlignment = "reader_alignment"
        static let authMode = "auth_mode"
        static let pubkey = "pubkey_hex"
        static let signerPackage = "signer_package"
        static let readerSession = "reader_session"
        static let readerSelection = "reader_selection"
        static let nip46BunkerURL = "nip46_bunker_url"
        static let nip46ClientSecret = "nip46_client_secret"
        static let nip46ClientPubkey = "nip46_client_pubkey"
        static let cachedFavoritesPrefix = "nostr_favorites_"
        static let cachedFavoritesEventPrefix = "nostr_favorites_event_"
        static let favoriteOutboxPrefix = "nostr_favorites_outbox_"
        static let favoritePublishTimestampPrefix = "nostr_favorites_timestamp_"
        static let cachedCollectionsPrefix = "nostr_collections_"
        static let keepDownloadedCollections = "keep_downloaded_collections"
        static let lastApplicationDataSync = "last_application_data_sync"
        static let lastReadingMetadataSync = "last_reading_metadata_sync"
        static let speechVoice = "speech_voice"
        static let speechRate = "speech_rate"
        static let speechEngine = SpeechLanguageSettings.speechEngineKey
        static let speechLanguageSettings = "speech_language_settings"
        static let keepReadingOnLockScreen = "keep_reading_on_lock_screen"
        static let wordSort = "word_sort"
        static let dictionarySource = "dictionary_source"
        static let dictionaryTarget = "dictionary_target"
    }

    @Published var theme: ReaderTheme {
        didSet { defaults.set(theme.rawValue, forKey: Keys.theme) }
    }

    @Published var readerFont: ReaderFont {
        didSet { defaults.set(readerFont.rawValue, forKey: Keys.readerFont) }
    }

    @Published var readerAlignment: ReaderAlignment {
        didSet { defaults.set(readerAlignment.rawValue, forKey: Keys.readerAlignment) }
    }

    @Published var speechVoiceIdentifier: String {
        didSet { defaults.set(speechVoiceIdentifier, forKey: Keys.speechVoice) }
    }

    @Published var speechLanguageSettings: [String: SpeechLanguageSetting] {
        didSet { defaults.set(SpeechLanguageSettings.encodeSettings(speechLanguageSettings), forKey: Keys.speechLanguageSettings) }
    }

    @Published var speechRate: Double {
        didSet { defaults.set(speechRate, forKey: Keys.speechRate) }
    }

    func speechChoice(for bookLanguage: String) -> SpeechPlaybackChoice {
        SpeechLanguageSettings.resolve(
            bookLanguage: bookLanguage,
            settingsByLanguage: speechLanguageSettings,
            defaultRate: speechRate
        )
    }

    func setSpeechVoice(_ identifier: String, for language: String) {
        let tag = SpeechLanguageSettings.preferredLanguageTag(language)
        var next = speechLanguageSettings
        next[tag] = SpeechLanguageSetting(
            voiceIdentifier: identifier,
            rate: next[tag]?.rate
        )
        speechLanguageSettings = next
    }

    init(
        defaults: UserDefaults = .standard,
        keychain: any SecureStringStore = KeychainStore(service: "app.bookstr.ios")
    ) {
        self.defaults = defaults
        self.keychain = keychain
        self.theme = ReaderTheme(rawValue: defaults.string(forKey: Keys.theme) ?? "") ?? .paper
        self.readerFont = ReaderFont(rawValue: defaults.string(forKey: Keys.readerFont) ?? "") ?? .arial
        self.readerAlignment = ReaderAlignment(rawValue: defaults.string(forKey: Keys.readerAlignment) ?? "") ?? .justified
        self.speechVoiceIdentifier = defaults.string(forKey: Keys.speechVoice) ?? ""
        self.speechLanguageSettings = SpeechLanguageSettings.migrateLegacyEngine(
            defaults.string(forKey: Keys.speechEngine),
            into: SpeechLanguageSettings.decodeSettings(
                defaults.data(forKey: Keys.speechLanguageSettings)
            )
        )
        let savedRate = defaults.double(forKey: Keys.speechRate)
        self.speechRate = savedRate == 0 ? SpeechLanguageSettings.defaultRate : SpeechLanguageSettings.clampRate(savedRate)
    }

    var catalogConnection: CatalogConnection? {
        get {
            guard let data = defaults.data(forKey: "catalog_connection_v1") else { return nil }
            return try? JSONDecoder().decode(CatalogConnection.self, from: data)
        }
        set {
            objectWillChange.send()
            defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "catalog_connection_v1")
        }
    }

    var relays: [String] {
        get {
            let raw = defaults.string(forKey: Keys.relays) ?? "wss://relay.nomadwiki.org"
            return raw.split(whereSeparator: { $0 == "\n" || $0 == "," }).map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        set { defaults.set(newValue.joined(separator: "\n"), forKey: Keys.relays) }
    }

    var keepReadingOnLockScreen: Bool {
        get {
            defaults.object(forKey: Keys.keepReadingOnLockScreen) == nil
                ? true
                : defaults.bool(forKey: Keys.keepReadingOnLockScreen)
        }
        set { defaults.set(newValue, forKey: Keys.keepReadingOnLockScreen) }
    }

    var wordSort: String {
        get { defaults.string(forKey: Keys.wordSort) ?? "recent" }
        set { defaults.set(newValue, forKey: Keys.wordSort) }
    }

    var dictionarySource: String {
        get { defaults.string(forKey: Keys.dictionarySource) ?? "en" }
        set { defaults.set(newValue, forKey: Keys.dictionarySource) }
    }

    var dictionaryTarget: String {
        get { defaults.string(forKey: Keys.dictionaryTarget) ?? "pt" }
        set { defaults.set(newValue, forKey: Keys.dictionaryTarget) }
    }

    var authMode: NostrAuthMode {
        get { NostrAuthMode(rawValue: defaults.string(forKey: Keys.authMode) ?? "") ?? .none }
        set { defaults.set(newValue.rawValue, forKey: Keys.authMode) }
    }

    var pubkeyHex: String? {
        get { defaults.string(forKey: Keys.pubkey) }
        set {
            defaults.set(newValue?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased(), forKey: Keys.pubkey)
        }
    }

    var hasNostrIdentity: Bool {
        authMode != .none && !(pubkeyHex ?? "").isEmpty
    }

    var hasNip46SessionCredentials: Bool {
        authMode == .nip46
            && !(nip46ClientSecret ?? "").isEmpty
            && (nip46BunkerURL ?? "").hasPrefix("bunker://")
    }

    var signerPackage: String? {
        get { defaults.string(forKey: Keys.signerPackage) }
        set { defaults.set(newValue?.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.signerPackage) }
    }

    var nsec: String? {
        get { keychain.get(key: "nsec") }
        set { keychain.set(key: "nsec", value: newValue?.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    var nip46ClientSecret: String? {
        get {
            if let value = keychain.get(key: Keys.nip46ClientSecret), !value.isEmpty {
                defaults.removeObject(forKey: Keys.nip46ClientSecret)
                return value
            }
            guard let legacyValue = defaults.string(forKey: Keys.nip46ClientSecret),
                  !legacyValue.isEmpty else { return nil }
            if keychain.set(key: Keys.nip46ClientSecret, value: legacyValue) {
                defaults.removeObject(forKey: Keys.nip46ClientSecret)
            }
            return legacyValue
        }
        set {
            keychain.set(key: Keys.nip46ClientSecret, value: newValue)
            defaults.removeObject(forKey: Keys.nip46ClientSecret)
        }
    }

    var nip46ClientPubkey: String? {
        get { defaults.string(forKey: Keys.nip46ClientPubkey) }
        set { defaults.set(newValue, forKey: Keys.nip46ClientPubkey) }
    }

    var nip46BunkerURL: String? {
        get { defaults.string(forKey: Keys.nip46BunkerURL) }
        set { defaults.set(newValue, forKey: Keys.nip46BunkerURL) }
    }

    func saveReaderSession(_ session: ReaderSession) {
        guard !session.bookId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            clearReaderSession()
            return
        }
        guard let data = try? JSONEncoder().encode(session) else { return }
        defaults.set(data, forKey: Keys.readerSession)
    }

    func readerSession() -> ReaderSession? {
        guard let data = defaults.data(forKey: Keys.readerSession) else { return nil }
        return try? JSONDecoder().decode(ReaderSession.self, from: data)
    }

    func clearReaderSession() {
        defaults.removeObject(forKey: Keys.readerSession)
    }

    func saveReaderSelection(_ selection: ReaderSelection) {
        guard !selection.bookId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let data = try? JSONEncoder().encode(selection) else { return }
        defaults.set(data, forKey: Keys.readerSelection)
    }

    func readerSelection() -> ReaderSelection? {
        guard let data = defaults.data(forKey: Keys.readerSelection) else { return nil }
        return try? JSONDecoder().decode(ReaderSelection.self, from: data)
    }

    func connectNip46(pubkeyHex: String, bunkerURL: String, clientSecret: String, clientPubkey: String? = nil) {
        authMode = .nip46
        self.pubkeyHex = pubkeyHex.lowercased()
        signerPackage = nil
        nsec = nil
        nip46BunkerURL = bunkerURL
        nip46ClientSecret = clientSecret
        nip46ClientPubkey = (clientPubkey ?? pubkeyHex).lowercased()
        NotificationCenter.default.post(name: .bookstrIdentityDidChange, object: nil)
    }

    func cacheNostrFavorites(pubkey: String, plaintext: String, eventId: String? = nil) {
        let key = pubkey.lowercased()
        defaults.set(plaintext, forKey: Keys.cachedFavoritesPrefix + key)
        if let eventId, !eventId.isEmpty {
            defaults.set(eventId, forKey: Keys.cachedFavoritesEventPrefix + key)
        }
    }

    func cachedNostrFavorites(pubkey: String) -> String? {
        defaults.string(forKey: Keys.cachedFavoritesPrefix + pubkey.lowercased())
    }

    func cachedFavoritesEventId(pubkey: String) -> String? {
        defaults.string(forKey: Keys.cachedFavoritesEventPrefix + pubkey.lowercased())
    }

    func saveFavoriteOutbox(pubkey: String, snapshot: FavoritePendingSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: Keys.favoriteOutboxPrefix + pubkey.lowercased())
    }

    func favoriteOutbox(pubkey: String) -> FavoritePendingSnapshot? {
        guard let data = defaults.data(forKey: Keys.favoriteOutboxPrefix + pubkey.lowercased()) else { return nil }
        return try? JSONDecoder().decode(FavoritePendingSnapshot.self, from: data)
    }

    /// Only clears the snapshot it successfully published. A newer tap may
    /// have replaced the outbox while a relay request was still in flight.
    func clearFavoriteOutbox(pubkey: String, timestamp: Int64) {
        let key = Keys.favoriteOutboxPrefix + pubkey.lowercased()
        guard favoriteOutbox(pubkey: pubkey)?.timestamp == timestamp else { return }
        defaults.removeObject(forKey: key)
    }

    func nextFavoritePublishTimestamp(pubkey: String, wallClock: Int64) -> Int64 {
        let key = Keys.favoritePublishTimestampPrefix + pubkey.lowercased()
        let previous = defaults.object(forKey: key) as? Int64 ?? 0
        let timestamp = max(wallClock, previous + 1)
        defaults.set(timestamp, forKey: key)
        return timestamp
    }

    func cacheNostrCollections(pubkey: String, snapshot: CollectionSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: Keys.cachedCollectionsPrefix + pubkey.lowercased())
    }

    func cachedNostrCollections(pubkey: String) -> CollectionSnapshot {
        guard let data = defaults.data(forKey: Keys.cachedCollectionsPrefix + pubkey.lowercased()),
              let snapshot = try? JSONDecoder().decode(CollectionSnapshot.self, from: data) else {
            return CollectionSnapshot()
        }
        return snapshot
    }

    func keepsCollectionDownloaded(_ id: String) -> Bool {
        Set(defaults.stringArray(forKey: Keys.keepDownloadedCollections) ?? []).contains(id)
    }

    func setKeepCollectionDownloaded(_ id: String, enabled: Bool) {
        var ids = Set(defaults.stringArray(forKey: Keys.keepDownloadedCollections) ?? [])
        if enabled { ids.insert(id) } else { ids.remove(id) }
        defaults.set(Array(ids).sorted(), forKey: Keys.keepDownloadedCollections)
    }

    var lastApplicationDataSync: Date? {
        get { defaults.object(forKey: Keys.lastApplicationDataSync) as? Date }
        set { defaults.set(newValue, forKey: Keys.lastApplicationDataSync) }
    }

    var lastReadingMetadataSync: Date? {
        get { defaults.object(forKey: Keys.lastReadingMetadataSync) as? Date }
        set { defaults.set(newValue, forKey: Keys.lastReadingMetadataSync) }
    }
}
