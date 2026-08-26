import SwiftUI
import UIKit
import AVFoundation
import NostrCore

private enum SettingsField: Hashable {
    case nsec
    case relays
}

struct SettingsView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var settings: SettingsRepository
    @Environment(\.openURL) private var openURL
    @State private var relaysRaw = ""
    @State private var npub = ""
    @State private var nsec = ""
    @State private var activeMode: NostrAuthMode = .none
    @State private var nip46URI: String?
    @State private var qrImage: UIImage?
    @State private var awaitingNip46 = false
    @State private var status = ""
    @State private var dictionaryPacks: [DictionaryPack] = []
    @State private var dictionarySelection = DictionaryPairSelection()
    @State private var dictionaryBusy = false
    @StateObject private var speechModels = SpeechModelStore()
    @FocusState private var focusedField: SettingsField?

    var body: some View {
        Form {
            Section("Reader") {
                Picker("Theme", selection: $settings.theme) {
                    ForEach(ReaderTheme.allCases, id: \.self) { item in
                        Text(item.rawValue.capitalized).tag(item)
                    }
                }
                Picker("Speech engine", selection: $settings.speechEngineID) {
                    ForEach(SpeechEngineID.allCases) { engine in
                        Text(engine.label).tag(engine)
                    }
                }
                if settings.speechEngineID == .system {
                    Picker("Reading voice", selection: $settings.speechVoiceIdentifier) {
                        Text("Best installed voice").tag("")
                        ForEach(speechVoices, id: \.identifier) { voice in
                            Text("\(voice.name) · \(voice.language) · \(voiceQuality(voice))")
                                .tag(voice.identifier)
                        }
                    }
                } else {
                    speechModelControl(settings.speechEngineID)
                }
                VStack(alignment: .leading) {
                    HStack {
                        Text("Speech speed")
                        Spacer()
                        Text(settings.speechRate / 0.48, format: .number.precision(.fractionLength(2))) + Text("×")
                    }
                    Slider(value: $settings.speechRate, in: 0.35...0.60, step: 0.01)
                    HStack {
                        Text("0.73×")
                        Spacer()
                        Text("1.00×").foregroundStyle(.secondary)
                        Spacer()
                        Text("1.25×")
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
            }

            nostrSection

            Section("Offline dictionaries") {
                let installed = dictionaryPacks.filter(\.installed)
                if installed.isEmpty {
                    Text("Downloaded dictionaries: none").foregroundStyle(.secondary)
                } else {
                    ForEach(installed) { pack in
                        HStack(spacing: 8) {
                            Text(pack.label)
                                .font(.subheadline)
                            Text(ByteCountFormatter.string(fromByteCount: pack.bytes, countStyle: .file))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button(role: .destructive) {
                                container.dictionaryRepository.removePack(pack.id)
                                dictionaryPacks = container.dictionaryRepository.packs()
                                dictionarySelection.normalize(using: dictionaryPacks)
                                NotificationCenter.default.post(name: .bookstrDictionariesDidChange, object: nil)
                            } label: { Image(systemName: "trash") }
                            .disabled(dictionaryBusy)
                        }
                        .padding(.vertical, -3)
                        .frame(maxWidth: .infinity)
                        .listRowInsets(EdgeInsets(top: 3, leading: 0, bottom: 3, trailing: 0))
                    }
                }

                if dictionarySelection.availablePacks(in: dictionaryPacks).isEmpty {
                    Text("All available combinations downloaded")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    HStack(spacing: 4) {
                        Picker("", selection: Binding(
                            get: { dictionarySelection.source },
                            set: { dictionarySelection.selectSource($0, using: dictionaryPacks) }
                        )) {
                            ForEach(dictionarySourceLanguages, id: \.self) { language in
                                Text(dictionaryLanguageName(language)).tag(language)
                            }
                        }
                        .labelsHidden()
                        .frame(maxWidth: .infinity)
                        Text("→").foregroundStyle(.secondary)
                        Picker("", selection: Binding(
                            get: { dictionarySelection.target },
                            set: { dictionarySelection.selectTarget($0, using: dictionaryPacks) }
                        )) {
                            ForEach(dictionaryTargetLanguages, id: \.self) { language in
                                Text(dictionaryLanguageName(language)).tag(language)
                            }
                        }
                        .labelsHidden()
                        .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

                    if let selected = selectedDictionaryPack {
                        Button("Download") {
                            installDictionary(selected)
                        }
                        .disabled(dictionaryBusy)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    }
                }
            }

            if !status.isEmpty {
                Section("Status") { Text(status) }
            }

            Section("Relays") {
                TextEditor(text: $relaysRaw)
                    .frame(minHeight: 80)
                    .focused($focusedField, equals: .relays)
                Button("Save relays") {
                    container.settingsRepository.relays = relaysRaw
                        .split(whereSeparator: \.isNewline)
                        .map(String.init)
                        .map { $0.trimmingCharacters(in: .whitespaces) }
                        .filter { !$0.isEmpty }
                    status = "Relays saved"
                }
            }

            Section {
                HStack(spacing: 8) {
                    Spacer()
                    Link(destination: URL(string: "https://github.com/guaka/bookstr")!) {
                        Image("GithubMark")
                            .renderingMode(.template)
                            .frame(width: 18, height: 18)
                    }
                    .accessibilityLabel("GitHub")
                    Text(buildTime)
                    Spacer()
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
        .bookstrScreenTitle("Settings")
        .task {
            relaysRaw = container.settingsRepository.relays.joined(separator: "\n")
            npub = NostrIdentity.npub(fromHex: container.settingsRepository.pubkeyHex ?? "") ?? ""
            nsec = container.settingsRepository.nsec ?? ""
            activeMode = container.settingsRepository.authMode
            dictionaryPacks = container.dictionaryRepository.packs()
            dictionarySelection.normalize(using: dictionaryPacks)
            await container.nip46Service.restore(from: container.settingsRepository)
            npub = NostrIdentity.npub(fromHex: container.settingsRepository.pubkeyHex ?? "") ?? ""
            activeMode = container.settingsRepository.authMode
        }
    }

    @ViewBuilder
    private var nostrSection: some View {
        Section("Nostr") {
            if !npub.isEmpty {
                Text(npub)
                    .font(.footnote.monospaced())
                    .textSelection(.enabled)
                Text(modeLabel)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if activeMode == .nip46 {
                if settings.hasNip46SessionCredentials {
                    Text("Connected via Amber / NIP-46. Your nsec never enters this app.")
                } else {
                    Text("Amber looks connected, but the session key is missing. Scan the QR again.")
                        .foregroundStyle(.red)
                }
                Button(awaitingNip46 ? "Waiting for signer…" : "Reconnect NIP-46 signer") {
                    beginNip46QrFlow()
                }
                .disabled(awaitingNip46)
                nip46PairingContent
                Button("Disconnect", role: .destructive) {
                    disconnect()
                }
            } else {
                SecureField("nsec1…", text: $nsec)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($focusedField, equals: .nsec)
                    .onSubmit { focusedField = nil }
                Button("Connect nsec") {
                    focusedField = nil
                    connectNsec()
                }

                Button(awaitingNip46 ? "Waiting for signer…" : "Connect NIP-46 signer") {
                    focusedField = nil
                    beginNip46QrFlow()
                }
                .disabled(awaitingNip46)
                nip46PairingContent
                if let nip46URI, !awaitingNip46 {
                    Text(nip46URI)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            }
        }
    }

    @ViewBuilder
    private var nip46PairingContent: some View {
        if let qrImage {
            Image(uiImage: qrImage)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 240, maxHeight: 240)
                .listRowInsets(EdgeInsets())
                .padding(.vertical, 8)
        }
        if awaitingNip46 {
            Text("Approve in Signstr, or scan this QR with another NIP-46 signer.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Open Signstr") { openSignstr() }
            Button("Copy connection link") { copyNip46Link() }
            Button("Cancel") { cancelNip46() }
        }
    }

    private var selectedDictionaryPack: DictionaryPack? {
        dictionarySelection.selectedPack(in: dictionaryPacks)
    }

    private var buildTime: String {
        guard let executable = Bundle.main.executableURL,
              let values = try? executable.resourceValues(forKeys: [.contentModificationDateKey]),
              let date = values.contentModificationDate else { return "unknown" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private var dictionarySourceLanguages: [String] {
        dictionarySelection.sources(in: dictionaryPacks).sorted {
            dictionaryLanguageName($0) < dictionaryLanguageName($1)
        }
    }

    private var dictionaryTargetLanguages: [String] {
        dictionarySelection.targets(in: dictionaryPacks).sorted {
            dictionaryLanguageName($0) < dictionaryLanguageName($1)
        }
    }

    private func dictionaryLanguageName(_ code: String) -> String {
        for pack in dictionaryPacks {
            let pieces = pack.label.components(separatedBy: " → ")
            if pack.sourceLanguage == code, let first = pieces.first { return first }
            if pack.targetLanguage == code, pieces.count > 1 { return pieces[1] }
        }
        return code.uppercased()
    }

    private var speechVoices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().sorted {
            if $0.language != $1.language { return $0.language < $1.language }
            if $0.quality != $1.quality { return $0.quality.rawValue > $1.quality.rawValue }
            return $0.name < $1.name
        }
    }

    private func voiceQuality(_ voice: AVSpeechSynthesisVoice) -> String {
        switch voice.quality {
        case .premium: return "Premium"
        case .enhanced: return "Enhanced"
        default: return "Standard"
        }
    }

    @ViewBuilder
    private func speechModelControl(_ engine: SpeechEngineID) -> some View {
        if let model = SpeechModelCatalog.model(engine) {
            if speechModels.isInstalled(engine) {
                HStack {
                    Text(ByteCountFormatter.string(fromByteCount: model.approximateBytes, countStyle: .file))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(role: .destructive) {
                        speechModels.remove(engine)
                        settings.speechEngineID = .system
                    } label: {
                        Image(systemName: "trash")
                    }
                    .accessibilityLabel("Remove reading voice")
                }
            } else if speechModels.installing == engine {
                HStack {
                    ProgressView()
                    Text("Downloading…")
                    Spacer()
                    Text("\(speechModels.completedFiles)/\(model.files.count)")
                        .foregroundStyle(.secondary)
                }
            } else {
                Button("Download \(ByteCountFormatter.string(fromByteCount: model.approximateBytes, countStyle: .file))") {
                    Task { await speechModels.install(engine) }
                }
            }
            if let error = speechModels.errorMessage {
                Text(error).foregroundStyle(.red)
            }
        }
    }

    private func installDictionary(_ pack: DictionaryPack) {
        Task {
            dictionaryBusy = true
            status = "Downloading \(pack.label)…"
            do {
                try await container.dictionaryRepository.installPack(pack.id)
                dictionaryPacks = container.dictionaryRepository.packs()
                dictionarySelection.didInstall(pack, using: dictionaryPacks)
                status = "\(pack.label) is ready offline"
                NotificationCenter.default.post(name: .bookstrDictionariesDidChange, object: nil)
            } catch {
                status = "Dictionary download failed: \(error.localizedDescription)"
            }
            dictionaryBusy = false
        }
    }

    private var modeLabel: String {
        switch activeMode {
        case .nip46: return "NIP-46 remote signer"
        case .nsec: return "local nsec"
        case .amber: return "Amber"
        case .none: return ""
        }
    }

    private func connectNsec() {
        do {
            let trimmed = nsec.trimmingCharacters(in: .whitespacesAndNewlines)
            let keyPair = try KeyPair(nsec: trimmed)
            container.settingsRepository.pubkeyHex = keyPair.publicKeyHex
            container.settingsRepository.nsec = trimmed
            container.settingsRepository.authMode = .nsec
            npub = (try? keyPair.npub) ?? ""
            activeMode = .nsec
            status = "Connected with nsec"
            NotificationCenter.default.post(name: .bookstrIdentityDidChange, object: nil)
        } catch {
            status = "Invalid nsec"
        }
    }

    private func beginNip46QrFlow() {
        Task {
            awaitingNip46 = true
            status = "Listening on relays. Opening Signstr…"
            do {
                let relays = container.settingsRepository.relays
                let session = try await container.nip46Service.startQrSession(relays: relays)
                nip46URI = session.uri
                qrImage = await container.nip46Service.qrImage(for: session.uri)
                UIPasteboard.general.string = session.uri

                if let signerURL = signstrURL(for: session.uri) {
                    openURL(signerURL)
                    status = "Connection link copied. Approve Bookstr in Signstr."
                }

                let handshake = try await container.nip46Service.awaitConnection()
                let bunkerURL = try await container.nip46Service.bunkerURL(
                    remoteSignerPubkey: handshake.remoteSignerPubkey,
                    relays: session.relays
                )
                container.settingsRepository.connectNip46(
                    pubkeyHex: handshake.userPubkey,
                    bunkerURL: bunkerURL,
                    clientSecret: session.clientNsec,
                    clientPubkey: session.clientPubkey
                )
                npub = NostrIdentity.npub(fromHex: handshake.userPubkey) ?? ""
                activeMode = .nip46
                qrImage = nil
                nip46URI = nil
                status = "Connected via NIP-46"
            } catch is CancellationError {
                status = "Cancelled NIP-46 connect"
            } catch {
                status = error.localizedDescription
            }
            awaitingNip46 = false
        }
    }

    private func signstrURL(for connectionURI: String) -> URL? {
        var components = URLComponents()
        components.scheme = "signstr"
        components.host = "pair"
        components.queryItems = [URLQueryItem(name: "uri", value: connectionURI)]
        return components.url
    }

    private func openSignstr() {
        guard let nip46URI, let url = signstrURL(for: nip46URI) else { return }
        UIPasteboard.general.string = nip46URI
        openURL(url)
        status = "Connection link copied. Approve Bookstr in Signstr."
    }

    private func copyNip46Link() {
        guard let nip46URI else { return }
        UIPasteboard.general.string = nip46URI
        status = "Connection link copied. Paste it into Signstr if needed."
    }

    private func cancelNip46() {
        Task {
            await container.nip46Service.disconnect()
            awaitingNip46 = false
            qrImage = nil
            nip46URI = nil
            status = "Cancelled NIP-46 connect"
        }
    }

    private func disconnect() {
        Task {
            await container.nip46Service.disconnect()
            container.settingsRepository.authMode = .none
            container.settingsRepository.pubkeyHex = nil
            container.settingsRepository.nsec = nil
            container.settingsRepository.nip46BunkerURL = nil
            container.settingsRepository.nip46ClientSecret = nil
            container.settingsRepository.nip46ClientPubkey = nil
            npub = ""
            nsec = ""
            activeMode = .none
            qrImage = nil
            nip46URI = nil
            status = "Disconnected"
            NotificationCenter.default.post(name: .bookstrIdentityDidChange, object: nil)
        }
    }
}
