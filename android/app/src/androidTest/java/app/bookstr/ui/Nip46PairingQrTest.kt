package app.bookstr.ui

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertTextEquals
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test

class Nip46PairingQrTest {
    @get:Rule val compose = createComposeRule()

    @Test fun qrEncodesTheCompleteNostrConnectUri() {
        val uri = "nostrconnect://${"ab".repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=0123456789abcdef"
        val bitmap = nip46QrBitmap(uri, 640)
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val source = RGBLuminanceSource(bitmap.width, bitmap.height, pixels)
        val decoded = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(source))).text
        assertEquals(uri, decoded)
    }

    @Test fun dialogShowsQrAndCancelClosesIt() {
        var dismissed = false
        compose.setContent {
            Nip46PairingQrDialog(
                uri = "nostrconnect://${"cd".repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=0123456789abcdef",
                connecting = true,
                error = null,
                onDismiss = { dismissed = true },
            )
        }
        compose.onNodeWithTag("nip46.qr").assertExists()
        compose.onNodeWithTag("nip46.connecting").assertExists()
        compose.onNodeWithTag("nip46.cancel").performClick()
        compose.runOnIdle { assertTrue(dismissed) }
    }

    @Test fun invalidQrInputIsRejectedBeforeAllocatingABitmap() {
        assertThrows(IllegalArgumentException::class.java) { nip46QrBitmap("https://example.org") }
        assertThrows(IllegalArgumentException::class.java) { nip46QrBitmap("nostrconnect://" + "a".repeat(4096)) }
        val uri = "nostrconnect://${"ab".repeat(32)}"
        assertThrows(IllegalArgumentException::class.java) { nip46QrBitmap(uri, 127) }
        assertThrows(IllegalArgumentException::class.java) { nip46QrBitmap(uri, 2049) }
    }

    @Test fun dialogShowsConnectionErrorWithoutAnActiveSpinner() {
        compose.setContent {
            Nip46PairingQrDialog("nostrconnect://${"ab".repeat(32)}", false, "Pairing expired", {})
        }
        compose.onNodeWithTag("nip46.error").assertTextEquals("Pairing expired")
        compose.onNodeWithTag("nip46.connecting").assertDoesNotExist()
    }
}
