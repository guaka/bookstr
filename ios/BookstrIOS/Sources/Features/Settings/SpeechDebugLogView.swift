import SwiftUI

struct SpeechDebugLogView: View {
    @State private var lines: [String] = []

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if lines.isEmpty {
                        Text("—")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("log-bottom")
                    } else {
                        ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                            Text(line)
                                .font(.system(.footnote, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                                .id(index == lines.count - 1 ? "log-bottom" : "log-\(index)")
                        }
                    }
                }
                .padding()
            }
            .onAppear {
                reload()
                DispatchQueue.main.async {
                    proxy.scrollTo("log-bottom", anchor: .bottom)
                }
            }
        }
        .navigationTitle("Speech logs")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    UIPasteboard.general.string = lines.joined(separator: "\n")
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .accessibilityLabel("Copy")
                .disabled(lines.isEmpty)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) {
                    BookstrDebugLog.shared.clear()
                    lines = []
                } label: {
                    Image(systemName: "trash")
                }
                .accessibilityLabel("Clear")
                .disabled(lines.isEmpty)
            }
        }
    }

    private func reload() {
        let exported = BookstrDebugLog.shared.exportText(category: BookstrDebugLog.speech)
        lines = exported.isEmpty ? [] : exported.components(separatedBy: "\n")
    }
}
