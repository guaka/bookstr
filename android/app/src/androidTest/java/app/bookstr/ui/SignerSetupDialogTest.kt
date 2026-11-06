package app.bookstr.ui

import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class SignerSetupDialogTest {
    @get:Rule val compose = createComposeRule()

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
