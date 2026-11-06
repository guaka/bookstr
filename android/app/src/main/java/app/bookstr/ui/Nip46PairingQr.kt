package app.bookstr.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.util.EnumMap

internal fun nip46QrBitmap(uri: String, size: Int = 640): Bitmap {
    require(uri.startsWith("nostrconnect://") && uri.length <= 4096) { "Invalid NIP-46 pairing URI" }
    require(size in 128..2048) { "QR size must be between 128 and 2048 pixels" }
    val hints = EnumMap<EncodeHintType, Any>(EncodeHintType::class.java).apply {
        put(EncodeHintType.MARGIN, 4)
        put(EncodeHintType.ERROR_CORRECTION, com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M)
    }
    val matrix = QRCodeWriter().encode(uri, BarcodeFormat.QR_CODE, size, size, hints)
    return Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also { bitmap ->
        for (y in 0 until size) for (x in 0 until size) {
            bitmap.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }
}

@Composable
internal fun Nip46PairingQrDialog(
    uri: String,
    connecting: Boolean,
    error: String?,
    onDismiss: () -> Unit,
) {
    val qr = remember(uri) { nip46QrBitmap(uri).asImageBitmap() }
    AlertDialog(
        modifier = Modifier.testTag("nip46.pairing"),
        onDismissRequest = onDismiss,
        title = { Text(if (connecting) "Waiting for phone approval" else "Connect your phone signer") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Image(qr, contentDescription = "NIP-46 pairing QR code", modifier = Modifier.size(280.dp).testTag("nip46.qr"))
                Text("Scan this code with Amber or another NIP-46 signer. Approve Bookstr to finish connecting.")
                if (connecting) CircularProgressIndicator(modifier = Modifier.testTag("nip46.connecting"))
                error?.let { Text(it, modifier = Modifier.testTag("nip46.error")) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("nip46.cancel")) { Text("Cancel") } },
    )
}
