package app.bookstr.ui

import androidx.compose.runtime.*
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import app.bookstr.data.*
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalTestApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
class TvSettingsConnectionTest {
    @get:Rule val compose = createComposeRule()

    private fun settings(television: Boolean, signerAvailable: Boolean) {
        var keyboardReadyForTest = !television
        compose.setContent {
            var pairing by remember { mutableStateOf(false) }
            var keyboardReady by remember { mutableStateOf(!television) }
            val inputModeManager = LocalInputModeManager.current
            val windowFocused = LocalWindowInfo.current.isWindowFocused
            SideEffect { keyboardReadyForTest = keyboardReady }
            LaunchedEffect(television, windowFocused, inputModeManager.inputMode) {
                if (!television) {
                    keyboardReady = true
                } else if (windowFocused) {
                    if (inputModeManager.inputMode == InputMode.Keyboard) keyboardReady = true
                    else inputModeManager.requestInputMode(InputMode.Keyboard)
                }
            }
            if (keyboardReady) {
                SettingsScreen(
                    authMode = NostrAuthMode.None, television = television, npubDisplay = "", amberAvailable = signerAvailable,
                    nsec = "", showNsec = false, relays = "", theme = ReaderTheme.entries.first(),
                    readerFont = ReaderFont.entries.first(), readerAlignment = ReaderAlignment.entries.first(),
                    keepOnLockScreen = false, syncing = false, connectingAmber = false, syncMessage = null,
                    dictionaryPacks = emptyList(), dictionaryPackBusy = null, dictionaryPackProgress = null,
                    dictionaryMessage = null, initialDictionarySource = "en", initialDictionaryTarget = "pt",
                    onDictionaryPairChange = { _, _ -> }, onConnectAmber = {}, onConnectNip46 = { pairing = true },
                    onDisconnectNostr = {}, onShowNsecChange = {}, onNsecChange = {}, onRelaysChange = {},
                    onThemeChange = {}, onReaderFontChange = {}, onReaderAlignmentChange = {}, onKeepOnLockScreenChange = {},
                    onInstallDictionaryPack = {}, onRemoveDictionaryPack = {}, onSyncNow = {},
                )
                if (pairing) Nip46PairingQrDialog("nostrconnect://${"ab".repeat(32)}?secret=fixture", false, null, { pairing = false })
            }
        }
        if (television) compose.waitUntil(5_000) { keyboardReadyForTest }
    }

    @Test fun televisionConnectOpensQrUsingRemoteWithoutInstallingALocalSigner() {
        settings(television = true, signerAvailable = false)
        compose.onNodeWithText("Install Huddle or another NIP-55 signer to connect.").assertDoesNotExist()
        compose.onNodeWithTag("signer.connect").assertDoesNotExist()
        compose.onNodeWithTag("signer.connect-qr").performScrollTo()
            .performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithTag("signer.connect-qr").assertIsFocused().performKeyInput { pressKey(Key.DirectionCenter) }
        compose.onNodeWithTag("nip46.qr").assertIsDisplayed()
        compose.onNodeWithTag("nip46.cancel").performClick()
        compose.onNodeWithTag("nip46.qr").assertDoesNotExist()
    }

    @Test fun televisionPrefersPhonePairingEvenWhenALocalSignerIsInstalled() {
        settings(television = true, signerAvailable = true)
        compose.onNodeWithTag("signer.connect-qr").assertExists()
        compose.onNodeWithTag("signer.connect").assertDoesNotExist()
    }

    @Test fun phoneKeepsItsInstalledSignerConnection() {
        settings(television = false, signerAvailable = true)
        compose.onNodeWithTag("signer.connect").assertExists()
        compose.onNodeWithTag("signer.connect-qr").assertDoesNotExist()
    }

    @Test fun phoneWithoutSignerKeepsInstallationPrompt() {
        settings(television = false, signerAvailable = false)
        compose.onNodeWithText("Install Huddle or another NIP-55 signer to connect.").assertExists()
        compose.onNodeWithTag("signer.connect-qr").assertDoesNotExist()
    }
}
