import Foundation
import CoreImage.CIFilterBuiltins
import UIKit
import NostrConnect
import NostrCore

struct Nip46Session {
    let uri: String
    let clientPubkey: String
    let clientNsec: String
    let name: String
    let relays: [URL]
}

struct Nip46HandshakeResult {
    let remoteSignerPubkey: String
    let userPubkey: String
}

actor Nip46Service {
    private static let handshakeTimeout: TimeInterval = 300
    /// Favorites ciphertext is tens of KB; Amber also needs time to prompt.
    nonisolated static let requestTimeout: TimeInterval = 30
    nonisolated static let authChallengeTimeout: TimeInterval = 300

    private static let relaySession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    private var signer: RemoteSigner?
    private var handshakeTask: Task<String, Error>?
    private var authTask: Task<Void, Never>?
    private var handshakeBackgroundActivity: UIBackgroundTaskIdentifier = .invalid
    private var lastRestoreStatus = "not attempted"

    func startQrSession(relays: [String], appURL: String = "https://guaka.github.io/bookstr/") async throws -> Nip46Session {
        await disconnect()

        let relayURLs = relays.compactMap(URL.init(string:))
        guard !relayURLs.isEmpty else {
            throw Nip46Error.missingRelay
        }

        let keyPair = try KeyPair()
        let displayName = "Bookstr iOS+\(String(keyPair.publicKeyHex.prefix(6)))"
        let invitation = try NostrConnectURI.invitation(
            clientKeyPair: keyPair,
            relays: relayURLs,
            permissions: Self.permissions,
            name: displayName,
            url: URL(string: appURL)
        )
        let config = RemoteSigner.Config(
            requestTimeout: Self.handshakeTimeout,
            authChallengeTimeout: Self.handshakeTimeout
        )
        let signer = try RemoteSigner(
            invitation: invitation,
            clientKeyPair: keyPair,
            transport: RelayConnectionTransport(relayURLs: relayURLs, urlSession: Self.relaySession),
            config: config
        )
        self.signer = signer

        // Subscribe to relays immediately so Amber's connect reply is not missed
        // while the QR is still being rendered.
        handshakeTask = Task {
            try await signer.awaitConnection()
        }
        handshakeBackgroundActivity = await Self.beginBackgroundActivity(name: "Bookstr NIP-46 pairing")
        authTask = Task {
            for await challenge in await signer.authChallenges() {
                await MainActor.run {
                    NotificationCenter.default.post(name: .bookstrAmberAuth, object: challenge.url.absoluteString)
                    UIApplication.shared.open(challenge.url)
                }
            }
        }

        return Nip46Session(
            uri: invitation.stringValue,
            clientPubkey: keyPair.publicKeyHex,
            clientNsec: try keyPair.nsec,
            name: displayName,
            relays: relayURLs
        )
    }

    func awaitConnection() async throws -> Nip46HandshakeResult {
        defer { endHandshakeBackgroundActivity() }
        guard let handshakeTask else {
            throw Nip46Error.sessionNotStarted
        }
        let remoteSignerPubkey = try await handshakeTask.value
        let userPubkey = (try? await signer?.userPublicKey()) ?? remoteSignerPubkey
        return Nip46HandshakeResult(
            remoteSignerPubkey: remoteSignerPubkey,
            userPubkey: NostrIdentity.hexPublicKey(from: userPubkey) ?? userPubkey.lowercased()
        )
    }

    func hasLiveSigner() -> Bool {
        signer != nil
    }

    func restoreStatus() -> String {
        lastRestoreStatus
    }

    func restore(from settings: SettingsRepository) async {
        guard settings.authMode == .nip46 else {
            lastRestoreStatus = "auth mode is \(settings.authMode.rawValue)"
            return
        }
        if signer != nil {
            lastRestoreStatus = "already live"
            startAuthListenerIfNeeded()
            return
        }

        let secret = settings.nip46ClientSecret ?? ""
        let bunkerURL = settings.nip46BunkerURL ?? ""
        guard !secret.isEmpty, bunkerURL.hasPrefix("bunker://") else {
            lastRestoreStatus = "missing credentials secret=\(!secret.isEmpty) bunker=\(bunkerURL.isEmpty ? "missing" : String(bunkerURL.prefix(64)))"
            return
        }

        do {
            let keyPair = try KeyPair(nsec: secret)
            let bunker = try BunkerURI(string: bunkerURL)
            lastRestoreStatus = "connecting relays=\(bunker.relays.map(\.absoluteString).joined(separator: ","))"
            let config = RemoteSigner.Config(
                requestTimeout: Self.requestTimeout,
                authChallengeTimeout: Self.authChallengeTimeout
            )
            let signer = try RemoteSigner(
                bunker: bunker,
                clientKeyPair: keyPair,
                transport: RelayConnectionTransport(relayURLs: bunker.relays, urlSession: Self.relaySession),
                config: config
            )
            self.signer = signer
            startAuthListenerIfNeeded()
            lastRestoreStatus = "session ready (connect deferred)"
        } catch {
            authTask?.cancel()
            authTask = nil
            if let signer {
                await signer.disconnect()
            }
            self.signer = nil
            lastRestoreStatus = "restore failed: \(error.localizedDescription)"
        }
    }

    /// Rebuilds the relay session without logging Amber out, then reconnects.
    func reconnect(from settings: SettingsRepository) async {
        handshakeTask?.cancel()
        handshakeTask = nil
        authTask?.cancel()
        authTask = nil
        if let signer {
            await signer.disconnect()
        }
        signer = nil
        await restore(from: settings)
    }

    func userPublicKey() async throws -> String {
        try await withSignerBackgroundActivity(name: "Bookstr public key") {
            let signer = try await self.connectedSigner()
            return try await signer.userPublicKey()
        }
    }

    func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String {
        try await withSignerBackgroundActivity(name: "Bookstr decrypt") {
            let signer = try await self.connectedSigner()
            return try await signer.nip44Decrypt(ciphertext, from: senderPubkey)
        }
    }

    func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String {
        try await withSignerBackgroundActivity(name: "Bookstr encrypt") {
            let signer = try await self.connectedSigner()
            return try await signer.nip44Encrypt(plaintext, to: recipientPubkey)
        }
    }

    /// Completes the NIP-46 `connect` handshake on a small request so the first
    /// real command is not a 50KB favorites decrypt.
    func connectedSigner() async throws -> RemoteSigner {
        guard let signer else {
            throw Nip46Error.notConnected
        }
        startAuthListenerIfNeeded()
        try await signer.connect()
        return signer
    }

    func disconnect() async {
        endHandshakeBackgroundActivity()
        handshakeTask?.cancel()
        handshakeTask = nil
        authTask?.cancel()
        authTask = nil
        if let signer {
            await signer.logout()
        }
        signer = nil
    }

    func signEvent(_ event: NostrEvent) async throws -> NostrEvent {
        try await withSignerBackgroundActivity(name: "Bookstr sign") {
            let signer = try await self.connectedSigner()
            let unsigned = UnsignedEvent(
                pubkey: event.pubkey ?? "",
                createdAt: event.createdAt,
                kind: Event.Kind(rawValue: event.kind),
                rawTags: event.tags,
                content: event.content
            )
            let signed = try await signer.sign(unsigned)
            return NostrEvent(
                id: signed.id,
                pubkey: signed.pubkey,
                createdAt: signed.createdAt,
                kind: signed.kind.rawValue,
                tags: signed.tags,
                content: signed.content,
                sig: signed.sig
            )
        }
    }

    private func withSignerBackgroundActivity<T>(
        name: String,
        operation: () async throws -> T
    ) async throws -> T {
        let identifier = await Self.beginBackgroundActivity(name: name)
        do {
            let value = try await operation()
            await Self.endBackgroundActivity(identifier)
            return value
        } catch {
            await Self.endBackgroundActivity(identifier)
            throw error
        }
    }

    private func endHandshakeBackgroundActivity() {
        let identifier = handshakeBackgroundActivity
        handshakeBackgroundActivity = .invalid
        Task { await Self.endBackgroundActivity(identifier) }
    }

    private nonisolated static func beginBackgroundActivity(name: String) async -> UIBackgroundTaskIdentifier {
        await MainActor.run {
            UIApplication.shared.beginBackgroundTask(withName: name)
        }
    }

    private nonisolated static func endBackgroundActivity(_ identifier: UIBackgroundTaskIdentifier) async {
        guard identifier != .invalid else { return }
        await MainActor.run { UIApplication.shared.endBackgroundTask(identifier) }
    }

    func bunkerURL(remoteSignerPubkey: String, relays: [URL]) throws -> String {
        try BunkerURI(remoteSignerPubkey: remoteSignerPubkey, relays: relays).stringValue
    }

    private func startAuthListenerIfNeeded() {
        guard authTask == nil, let signer else { return }
        authTask = Task {
            for await challenge in await signer.authChallenges() {
                await MainActor.run {
                    NotificationCenter.default.post(name: .bookstrAmberAuth, object: challenge.url.absoluteString)
                    UIApplication.shared.open(challenge.url)
                }
            }
        }
    }

    private func refreshUserPubkey(in settings: SettingsRepository) async {
        guard let signer else { return }
        guard let raw = try? await signer.userPublicKey(),
              let userPubkey = NostrIdentity.hexPublicKey(from: raw)
        else { return }
        if settings.pubkeyHex?.lowercased() != userPubkey {
            settings.pubkeyHex = userPubkey
            await MainActor.run {
                NotificationCenter.default.post(name: .bookstrIdentityDidChange, object: nil)
            }
        }
    }

    func qrImage(for text: String, size: CGFloat = 280) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaleX = size / output.extent.size.width
        let scaleY = size / output.extent.size.height
        let transformed = output.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        let context = CIContext()
        guard let cgImage = context.createCGImage(transformed, from: transformed.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    private static let permissions: [RemoteSignerPermission] = [
        .signEvent(kind: .applicationSpecificData),
        .signEvent(kind: .bookmarkSet),
        .signEvent(kind: Event.Kind(rawValue: 24242)),
        .nip44Encrypt,
        .nip44Decrypt,
        .getPublicKey,
    ]
}

enum Nip46Error: LocalizedError {
    case missingRelay
    case sessionNotStarted
    case notConnected
    case timedOut
    case payloadTooLarge(Int)

    var errorDescription: String? {
        switch self {
        case .missingRelay:
            return "Add at least one valid relay URL"
        case .sessionNotStarted:
            return "Start a NIP-46 QR session first"
        case .notConnected:
            return "NIP-46 signer is not connected"
        case .timedOut:
            return "Amber did not respond in time. Open Amber, approve decrypt, then pull to refresh."
        case .payloadTooLarge(let count):
            return "Favorites list is \(count) characters—too large for this signer request. Reconnect Nostr so Bookstr can republish it in smaller pieces, then pull to refresh."
        }
    }
}
