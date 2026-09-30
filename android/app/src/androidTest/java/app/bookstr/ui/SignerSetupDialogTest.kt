package app.bookstr.ui

import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
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
}
