import SwiftUI

@main
struct BookstrIOSApp: App {
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
                .background(TopSafeAreaCollapser())
        }
    }
}
