import SwiftUI

@main
struct BookstrIOSApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var container = AppContainer.shared

    init() {
        ScreenChrome.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(container)
                .environmentObject(container.settingsRepository)
                .environmentObject(container.readerPlayback)
                .environmentObject(container.coverDiscovery)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .task {
                    container.downloads.resume(prepare: container.catalogRepository.prepareForOpening)
                }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    Task { await ForegroundTorrentDownloader.shared.setActive(phase == .active) }
                    container.coverDiscovery.setActive(phase == .active)
                }
        }
    }
}
