import SwiftUI

@main
struct BookstrIOSApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var container = AppContainer.bootstrap()

    init() {
        ScreenChrome.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(container)
                .environmentObject(container.settingsRepository)
                .environmentObject(container.readerPlayback)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .task {
                    container.downloads.resume(prepare: container.catalogRepository.prepareForOpening)
                }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    Task { await ForegroundTorrentDownloader.shared.setActive(phase == .active) }
                }
        }
    }
}
