import SwiftUI

struct ReaderSpeechControls: View {
    @Binding var expanded: Bool
    @Binding var rate: Double
    let state: ReaderSpeechState
    let choice: SpeechPlaybackChoice
    let languageOverride: String
    let tint: Color
    let onToggle: () -> Void
    let onLanguageChange: (String) -> Void
    let onEngineChange: (SpeechEngineID) -> Void
    let onRateCommit: () -> Void
    let onStop: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if expanded {
                playbackButton
                languageMenu
                engineMenu
                rateSlider
                if state != .idle {
                    Button(action: onStop) { Image(systemName: "stop.fill") }
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Stop reading aloud")
                        .accessibilityIdentifier("reader-speech-stop")
                }
            }
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, expanded ? 10 : 0)
        .frame(height: expanded ? 52 : 0)
        .background(Color(uiColor: .secondarySystemBackground), in: Capsule())
        .overlay(Capsule().strokeBorder(.primary.opacity(expanded ? 0.22 : 0), lineWidth: 1))
        .shadow(color: .black.opacity(expanded ? 0.22 : 0), radius: 8, y: 3)
        .tint(tint)
    }

    private var playbackButton: some View {
        Button(action: onToggle) {
            if state == .preparing {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: state == .playing ? "pause.fill" : "play.fill")
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .accessibilityLabel(state == .playing ? "Pause reading aloud" : "Read aloud")
        .accessibilityIdentifier("reader-speech-playback")
    }

    private var languageMenu: some View {
        Menu {
            Button("Auto") { onLanguageChange(SpeechLanguageSettings.automaticLanguage) }
            ForEach(SpeechLanguageSettings.seededLanguageTags, id: \.self) { language in
                Button(SpeechLanguageSettings.displayName(for: language)) {
                    onLanguageChange(language)
                }
            }
        } label: {
            Text(languageOverride == SpeechLanguageSettings.automaticLanguage ? "Auto" : languageOverride.uppercased())
                .font(.caption.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel("Reading language")
        .accessibilityIdentifier("reader-speech-language")
    }

    private var engineMenu: some View {
        Menu {
            Button("Apple voices") { onEngineChange(.system) }
            ForEach(SpeechEngineID.allCases.filter {
                $0.isNeural && $0.supports(language: choice.languageTag)
            }, id: \.rawValue) { engine in
                if SpeechModelCatalog.model(engine)?.isInstalled == true {
                    Button(engine.label) { onEngineChange(engine) }
                } else {
                    Button("\(engine.label) — Settings", action: onOpenSettings)
                }
            }
        } label: {
            Image(systemName: "waveform")
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel("Reading voice")
        .accessibilityIdentifier("reader-speech-engine")
    }

    private var rateSlider: some View {
        Slider(
            value: $rate,
            in: SpeechLanguageSettings.minimumRate...SpeechLanguageSettings.maximumRate,
            onEditingChanged: { editing in
                if !editing { onRateCommit() }
            }
        )
        .frame(width: 120)
        .accessibilityLabel("Reading speed")
        .accessibilityIdentifier("reader-speech-speed")
    }
}
