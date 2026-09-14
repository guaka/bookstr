import SwiftUI

@main
struct BookstrIOSApp: App {
    @UIApplicationDelegateAdaptor(BookstrBackgroundDownloads.self) private var backgroundDownloads
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var container = AppContainer.bootstrap()

    init() {
        ScreenChrome.configure()
        _ = PublicationDownloadManager.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(container)
                .environmentObject(container.settingsRepository)
                .environmentObject(container.readerPlayback)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .background(TopSafeAreaCollapser())
                .onChange(of: scenePhase, initial: true) { _, phase in
                    Task { await ForegroundTorrentDownloader.shared.setActive(phase == .active) }
                }
        }
    }
}


final class BookstrBackgroundDownloads: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == PublicationDownloadManager.identifier else { completionHandler(); return }
        PublicationDownloadManager.shared.handleBackgroundEvents(completion: completionHandler)
    }
}
