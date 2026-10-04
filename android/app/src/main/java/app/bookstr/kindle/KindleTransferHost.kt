package app.bookstr.kindle

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import app.bookstr.BookstrApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class KindleRequest(val bookId: String?, val token: Long = System.nanoTime())
private const val USB_PERMISSION_ACTION = "app.bookstr.KINDLE_USB_PERMISSION"

@Composable
fun KindleTransferHost(app: BookstrApp, request: KindleRequest?, onRequestHandled: () -> Unit) {
    val context = LocalContext.current
    val manager = remember { context.getSystemService(UsbManager::class.java) }
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf(connectedKindles(manager)) }
    var selectedBookId by remember { mutableStateOf<String?>(null) }
    var selectedDevice by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<KindlePreview?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var folderUri by remember { mutableStateOf<Uri?>(null) }
    val prefs = remember { context.getSharedPreferences("kindle-transfer", Context.MODE_PRIVATE) }
    val savedFolder = remember { prefs.getString("documentsUri", null)?.let(Uri::parse) }
    val transfer = remember(app) {
        KindleTransfer {
            app.downloadStore.jobs.value.filter { it.state == "complete" }
                .map { KindleBook(it.book.id, it.book.title, it.book.author,
                    app.catalogRepository.publicationFile(it.book.id, it.book.format), it.book.format.extension) }
        }
    }

    suspend fun <T> withTarget(key: String, action: (KindleDocuments) -> T): T = withContext(Dispatchers.IO) {
        val target = if (key == "folder") {
            SafKindleDocuments(context.contentResolver, checkNotNull(folderUri) { "Select the Kindle documents folder." })
        } else {
            val device = checkNotNull(connectedKindles(manager).find { it.deviceName == key }) { "Kindle is disconnected." }
            MtpKindleDocuments(context, device)
        }
        target.use(action)
    }

    fun choose(key: String) {
        selectedDevice = key
        preview = null
        message = null
        busy = true
        scope.launch {
            try {
                if (selectedBookId == null) {
                    preview = withTarget(key) { transfer.preview(it) }
                } else {
                    val result = withTarget(key) { transfer.transfer(it, selectedBookId) }
                    message = when {
                        result.errors.isNotEmpty() -> result.errors.joinToString("\n")
                        result.copied.isNotEmpty() -> "Copied to Kindle."
                        else -> "Already on Kindle."
                    }
                }
            } catch (failure: Exception) { message = failure.message ?: "Kindle transfer failed." }
            finally { busy = false }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            try {
                context.contentResolver.takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                folderUri = uri
                prefs.edit().putString("documentsUri", uri.toString()).apply()
                choose("folder")
            } catch (failure: Exception) { message = failure.message ?: "Kindle folder is unavailable." }
        }
    }

    fun chooseUsb(key: String) {
        val device = devices.find { it.deviceName == key } ?: return
        if (manager.hasPermission(device)) { choose(key); return }
        selectedDevice = key
        val intent = Intent(USB_PERMISSION_ACTION).setPackage(context.packageName)
        val permission = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        manager.requestPermission(device, permission)
    }

    DisposableEffect(context, manager) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                devices = connectedKindles(manager)
                when (intent.action) {
                    UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                        if (devices.isNotEmpty()) { selectedBookId = null; preview = null; message = null; open = true }
                    }
                    UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                        preview = null
                        message = "Kindle disconnected."
                    }
                    USB_PERMISSION_ACTION -> {
                        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) selectedDevice?.let(::choose)
                        else message = "Kindle USB permission was denied."
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            addAction(USB_PERMISSION_ACTION)
        }
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else context.registerReceiver(receiver, filter)
        onDispose { context.unregisterReceiver(receiver) }
    }

    LaunchedEffect(request?.token) {
        if (request != null) {
            selectedBookId = request.bookId
            preview = null
            message = null
            devices = connectedKindles(manager)
            open = true
            onRequestHandled()
        }
    }

    LaunchedEffect(Unit) {
        if (devices.isNotEmpty() && request == null) {
            selectedBookId = null
            open = true
        }
    }

    if (!open) return
    AlertDialog(
        onDismissRequest = { if (!busy) open = false },
        title = { Text(if (selectedBookId == null) "Put missing books on Kindle" else "Send to Kindle") },
        text = {
            androidx.compose.foundation.layout.Column {
                Text(message ?: preview?.let { "${it.missing.size} missing · ${it.alreadyPresent} already there · ${it.skipped.size} skipped" }
                    ?: "Choose a connected Kindle or its documents folder.")
                if (folderUri != null || savedFolder != null) TextButton(onClick = {
                    folderUri = folderUri ?: savedFolder
                    choose("folder")
                }, enabled = !busy, modifier = androidx.compose.ui.Modifier.testTag("kindle.folder")) { Text("Kindle folder") }
                TextButton(onClick = { picker.launch(null) }, enabled = !busy,
                    modifier = androidx.compose.ui.Modifier.testTag("kindle.pick-folder")) { Text("Choose documents folder") }
                devices.forEach { device ->
                    TextButton(onClick = { chooseUsb(device.deviceName) }, enabled = !busy,
                        modifier = androidx.compose.ui.Modifier.testTag("kindle.device.${device.deviceId}")) {
                        Text(device.productName ?: "Kindle USB")
                    }
                }
            }
        },
        confirmButton = {
            if (selectedBookId == null && preview != null) TextButton(onClick = {
                val key = selectedDevice ?: return@TextButton
                busy = true
                scope.launch {
                    try {
                        val result = withTarget(key) { transfer.transfer(it) { done, total, title ->
                            message = "Copying $title · $done of $total"
                        } }
                        message = "${result.copied.size} copied · ${result.alreadyPresent} already there · ${result.errors.size} failed"
                        preview = null
                    } catch (failure: Exception) { message = failure.message ?: "Kindle transfer failed." }
                    finally { busy = false }
                }
            }, enabled = !busy && preview!!.missing.isNotEmpty(),
                modifier = androidx.compose.ui.Modifier.testTag("kindle.transfer-all")) { Text("Put missing books on Kindle") }
        },
        dismissButton = { TextButton(onClick = { open = false }, enabled = !busy) { Text("Done") } },
    )
}
