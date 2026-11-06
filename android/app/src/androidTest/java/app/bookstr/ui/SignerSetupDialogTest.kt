package app.bookstr.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SignerSetupDialogTest {
    @get:Rule val compose = createComposeRule()

    @Test fun invalidImportDoesNotSaveAndEditingClearsValidationError() {
        val saved = mutableListOf<String>()
        compose.setContent {
            SignerSetupDialog(null, false, false, null, {}, { saved.add(it) }, {})
        }
        compose.onNodeWithTag("signer.radio.import").performClick()
        compose.onNodeWithTag("signer.import-key").performTextInput("not a key")
        // Exercise validation independently of keyboard placement and touch dispatch.
        compose.onNodeWithTag("signer.setup-confirm").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("signer.setup-error").assertExists()
        compose.runOnIdle { assertTrue(saved.isEmpty()) }
        val key = app.bookstr.util.Bech32.encode("nsec", ByteArray(32) { 1 })
        compose.onNodeWithTag("signer.import-key").performTextReplacement(key)
        compose.onNodeWithTag("signer.setup-error").assertDoesNotExist()
        compose.onNodeWithTag("signer.setup-confirm").performSemanticsAction(SemanticsActions.OnClick)
        compose.runOnIdle { assertEquals(listOf(key), saved) }
    }

    @Test fun installedAmberStartsOnConnect() {
        compose.setContent {
            SignerSetupDialog("Amber", true, false, null, {}, {}, {})
        }
        compose.onNodeWithTag("signer.radio.connect").assertIsSelected()
    }

    @Test fun noPreferredSignerStartsOnNewKey() {
        compose.setContent {
            SignerSetupDialog(null, false, false, null, {}, {}, {})
        }
        compose.onNodeWithTag("signer.radio.generate").assertIsSelected()
    }

    @Test fun televisionDefaultsToQrPairingAndOpensPhoneFlow() {
        var opened = false
        compose.setContent {
            SignerSetupDialog(null, false, false, null, {}, {}, {}, television = true, onConnectQr = { opened = true })
        }
        compose.onNodeWithTag("signer.radio.connectqr").assertIsSelected()
        compose.onNodeWithTag("signer.setup-confirm").performClick()
        compose.runOnIdle { assertTrue(opened) }
        compose.onNodeWithTag("signer.radio.generate").assertDoesNotExist()
    }
}
