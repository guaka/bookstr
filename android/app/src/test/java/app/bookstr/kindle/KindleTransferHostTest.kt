package app.bookstr.kindle

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.mtp.MtpConstants
import android.mtp.MtpDevice
import android.mtp.MtpObjectInfo
import android.mtp.MtpStorageInfo
import android.os.CancellationSignal
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsProvider
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.bookstr.BookstrApp
import app.bookstr.ShadowEncryptedPreferences
import app.bookstr.ShadowMasterKeyBuilder
import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import app.bookstr.data.TorrentEdition
import app.bookstr.download.DownloadJob
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implements
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.RealObject
import org.robolectric.shadows.ShadowContentResolver
import org.robolectric.shadows.ShadowLooper
import org.robolectric.util.ReflectionHelpers
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest

private object HostUsbFixture {
    var permitted = false
    var requestCount = 0
    var closeCount = 0
    val devices = linkedMapOf<String, UsbDevice>()
    val entries = linkedMapOf<Int, Pair<MtpObjectInfo, ByteArray>>()
    var nextHandle = 10
    const val STORAGE = 77
    const val DOCUMENTS = 1

    fun reset() {
        permitted = false
        requestCount = 0
        closeCount = 0
        devices.clear()
        entries.clear()
        nextHandle = 10
        add(DOCUMENTS, "documents", MtpConstants.FORMAT_ASSOCIATION, -1)
    }

    fun add(handle: Int, name: String, format: Int, parent: Int, bytes: ByteArray = byteArrayOf()): MtpObjectInfo {
        val info = MtpObjectInfo.Builder().setObjectHandle(handle).setStorageId(STORAGE).setName(name)
            .setFormat(format).setParent(parent).setCompressedSize(bytes.size.toLong()).build()
        entries[handle] = info to bytes
        return info
    }
}

@Implements(UsbManager::class)
class ShadowHostUsbManager {
    @Implementation fun hasPermission(device: UsbDevice) = HostUsbFixture.permitted
    @Implementation fun getDeviceList() = HashMap(HostUsbFixture.devices)
    @Implementation fun openDevice(device: UsbDevice): UsbDeviceConnection = ReflectionHelpers.callConstructor(
        UsbDeviceConnection::class.java,
        ReflectionHelpers.ClassParameter.from(UsbDevice::class.java, device),
    )
    @Implementation fun requestPermission(device: UsbDevice, pendingIntent: PendingIntent) {
        HostUsbFixture.requestCount++
    }
}

/** Android derives USB IDs natively from device names; the SDK 28 Robolectric stub returns 0 for every device. */
@Implements(UsbDevice::class)
class ShadowHostUsbDevice {
    @RealObject lateinit var device: UsbDevice

    @Implementation fun getDeviceId(): Int = device.deviceName.hashCode()
}

@Implements(MtpDevice::class)
class ShadowHostMtpDevice {
    @Implementation fun __constructor__(device: UsbDevice) {}
    @Implementation fun open(connection: UsbDeviceConnection) = true
    @Implementation fun close() { HostUsbFixture.closeCount++ }
    @Implementation fun getStorageIds() = intArrayOf(HostUsbFixture.STORAGE)
    @Implementation fun getObjectHandles(storageId: Int, format: Int, parent: Int): IntArray =
        HostUsbFixture.entries.values.filter { it.first.parent == parent }.map { it.first.objectHandle }.toIntArray()
    @Implementation fun getObjectInfo(handle: Int): MtpObjectInfo? = HostUsbFixture.entries[handle]?.first
    @Implementation fun getStorageInfo(storageId: Int): MtpStorageInfo? = null
    @Implementation fun getPartialObject(handle: Int, offset: Long, length: Long, buffer: ByteArray): Long {
        val bytes = HostUsbFixture.entries[handle]?.second ?: return 0
        val start = offset.toInt()
        val count = minOf(length.toInt(), buffer.size, bytes.size - start)
        if (count <= 0) return 0
        bytes.copyInto(buffer, 0, start, start + count)
        return count.toLong()
    }
    @Implementation fun sendObjectInfo(info: MtpObjectInfo): MtpObjectInfo {
        val created = MtpObjectInfo.Builder(info).setObjectHandle(HostUsbFixture.nextHandle++).build()
        HostUsbFixture.entries[created.objectHandle] = created to byteArrayOf()
        return created
    }
    @Implementation fun sendObject(handle: Int, size: Long, descriptor: ParcelFileDescriptor): Boolean {
        val bytes = ParcelFileDescriptor.AutoCloseInputStream(ParcelFileDescriptor.dup(descriptor.fileDescriptor)).use { it.readBytes() }
        HostUsbFixture.entries[handle] = HostUsbFixture.entries.getValue(handle).first to bytes
        return bytes.size.toLong() == size
    }
    @Implementation fun deleteObject(handle: Int): Boolean = HostUsbFixture.entries.remove(handle) != null
}

@RunWith(RobolectricTestRunner::class)
@Config(
    application = BookstrApp::class,
    sdk = [28],
    instrumentedPackages = ["androidx.security.crypto"],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedPreferences::class,
        ShadowHostUsbManager::class, ShadowHostUsbDevice::class, ShadowHostMtpDevice::class,
        ModernDocumentsProviderQuery::class],
)
class KindleTransferHostTest {
    @get:Rule val compose = createComposeRule()

    private val app get() = RuntimeEnvironment.getApplication() as BookstrApp
    private val usbAction = "app.bookstr.KINDLE_USB_PERMISSION"
    private val device get() = usbDevice("/dev/mtp0")
    private val provider = HostDocumentsProvider()

    @Before fun setUp() {
        HostUsbFixture.reset()
        HostUsbFixture.devices[device.deviceName] = device
        val preferences = app.getSharedPreferences("kindle-transfer", Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        app.downloadStore.jobs.value.forEach { app.downloadStore.markPublicationDeleted(it.book.id) }
    }

    @Test fun connectedDeviceOpensPickerAndDoneClosesIt() {
        compose.setContent { KindleTransferHost(app, null) {} }
        compose.onNodeWithText("Put missing books on Kindle").assertExists()
        compose.onNodeWithText("Host-test Kindle").assertExists()
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithText("Put missing books on Kindle").assertDoesNotExist()
    }

    @After fun tearDown() {
        provider.files.values.forEach(File::delete)
        app.downloadStore.jobs.value.forEach {
            app.downloadStore.markPublicationDeleted(it.book.id)
            app.catalogRepository.publicationFile(it.book.id, it.book.format).delete()
        }
        app.getSharedPreferences("kindle-transfer", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun ignoresPermissionRepliesForMissingOrDifferentDeviceIdsUntilMatchingDenial() {
        compose.setContent { KindleTransferHost(app, null) {} }
        compose.onNodeWithTag("kindle.device.${device.deviceId}").performClick()
        compose.waitUntil(5_000) { HostUsbFixture.requestCount == 1 }
        compose.onNodeWithTag("kindle.device.${device.deviceId}").assertIsNotEnabled()

        app.sendBroadcast(Intent(usbAction).setPackage(app.packageName)
            .putExtra(UsbManager.EXTRA_PERMISSION_GRANTED, true))
        val otherDevice = usbDevice("/dev/mtp-other")
        assertNotEquals(device.deviceId, otherDevice.deviceId)
        app.sendBroadcast(Intent(usbAction).setPackage(app.packageName)
            .putExtra(UsbManager.EXTRA_DEVICE, otherDevice)
            .putExtra(UsbManager.EXTRA_PERMISSION_GRANTED, true))
        ShadowLooper.idleMainLooper()
        compose.onNodeWithTag("kindle.device.${device.deviceId}").assertIsNotEnabled()

        app.sendBroadcast(Intent(usbAction).setPackage(app.packageName)
            .putExtra(UsbManager.EXTRA_DEVICE, device)
            .putExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
        ShadowLooper.idleMainLooper()
        compose.onNodeWithText("Kindle USB permission was denied.").assertExists()
        compose.onNodeWithTag("kindle.device.${device.deviceId}").assertIsEnabled()
    }

    @Test fun matchingPermissionGrantPreviewsAndCopiesCompletedBookOverMtp() {
        val publication = completedBook()
        compose.setContent { KindleTransferHost(app, null) {} }
        compose.onNodeWithTag("kindle.device.${device.deviceId}").performClick()
        compose.waitUntil(5_000) { HostUsbFixture.requestCount == 1 }
        HostUsbFixture.permitted = true
        app.sendBroadcast(Intent(usbAction).setPackage(app.packageName)
            .putExtra(UsbManager.EXTRA_DEVICE, device)
            .putExtra(UsbManager.EXTRA_PERMISSION_GRANTED, true))
        ShadowLooper.idleMainLooper()

        compose.waitUntil(5_000) { compose.onAllNodesWithText("1 missing · 0 already there · 0 skipped").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("kindle.transfer-all").performClick()
        waitForText("1 copied · 0 already there · 0 failed")
        val expectedName = kindleFilename(KindleBook(publication.first, "A Test Book", "An Author", publication.second, "pdf"), sha256(publication.second))
        val copied = HostUsbFixture.entries.values.single { it.first.name == expectedName }
        assertEquals(publication.second.readBytes().toList(), copied.second.toList())
        assertTrue(HostUsbFixture.closeCount > 0)
    }

    @Test fun savedDocumentsFolderPreviewsAndCopiesThroughSafProvider() {
        val publication = completedBook()
        provider.attachInfo(app, ProviderInfo().apply {
            authority = "kindle-host-test"
            exported = true
            grantUriPermissions = true
            readPermission = "android.permission.MANAGE_DOCUMENTS"
            writePermission = "android.permission.MANAGE_DOCUMENTS"
        })
        ShadowContentResolver.registerProviderInternal("kindle-host-test", provider)
        val tree = DocumentsContract.buildTreeDocumentUri("kindle-host-test", "root")
        app.getSharedPreferences("kindle-transfer", Context.MODE_PRIVATE).edit()
            .putString("documentsUri", tree.toString()).commit()

        compose.setContent { KindleTransferHost(app, KindleRequest(null, 1L)) {} }
        compose.onNodeWithTag("kindle.folder").performClick()
        waitForText("1 missing · 0 already there · 0 skipped")
        val copyStarted = CountDownLatch(1)
        val allowCopy = CountDownLatch(1)
        provider.beforeCreateDocument = {
            copyStarted.countDown()
            check(allowCopy.await(15, TimeUnit.SECONDS)) { "Copy fixture was not released" }
        }
        try {
            compose.onNodeWithTag("kindle.transfer-all").performClick()
            assertTrue("Storage copy did not start", copyStarted.await(5, TimeUnit.SECONDS))
            compose.onNodeWithTag("kindle.folder").assertIsNotEnabled()
            compose.onNodeWithTag("kindle.transfer-all").assertIsNotEnabled()
        } finally {
            allowCopy.countDown()
        }
        waitForText("1 copied · 0 already there · 0 failed")

        val expectedName = kindleFilename(KindleBook(publication.first, "A Test Book", "An Author", publication.second, "pdf"), sha256(publication.second))
        val fileId = provider.names.entries.single { it.value == expectedName }.key
        assertEquals(publication.second.readBytes().toList(), provider.files.getValue(fileId).readBytes().toList())

        compose.onNodeWithTag("kindle.folder").performClick()
        waitForText("0 missing · 1 already there · 0 skipped")
        compose.onNodeWithTag("kindle.transfer-all").assertIsNotEnabled()
    }

    private fun completedBook(): Pair<String, File> {
        val bytes = "%PDF-1.7\nBookstr transfer fixture".toByteArray()
        val id = MessageDigest.getInstance("MD5").digest(bytes).joinToString("") { "%02x".format(it) }
        val book = CatalogBook(id, "A Test Book", "An Author", "", null,
            libvaultMd5 = id, format = BookFormat.Pdf)
        app.downloadStore.update(DownloadJob(book, TorrentEdition(id, 42, "fiction", bytes.size.toLong()), "complete"))
        val file = app.catalogRepository.publicationFile(id, BookFormat.Pdf)
        file.parentFile?.mkdirs()
        file.writeBytes(bytes)
        return id to file
    }

    private fun waitForText(text: String) {
        compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun usbDevice(name: String) = ReflectionHelpers.callConstructor(
        UsbDevice::class.java,
        ReflectionHelpers.ClassParameter.from(String::class.java, name),
        ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, AMAZON_USB_VENDOR_ID),
        ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 1),
        ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 0),
        ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 0),
        ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 0),
        ReflectionHelpers.ClassParameter.from(String::class.java, "Fixture"),
        ReflectionHelpers.ClassParameter.from(String::class.java, "Host-test Kindle"),
        ReflectionHelpers.ClassParameter.from(String::class.java, "1.0"),
        ReflectionHelpers.ClassParameter.from(String::class.java, "serial"),
    )
}

private class HostDocumentsProvider : DocumentsProvider() {
    val files = linkedMapOf<String, File>()
    val names = linkedMapOf<String, String>()
    private var nextId = 0
    var beforeCreateDocument: (() -> Unit)? = null

    override fun onCreate() = true
    override fun isChildDocument(parentDocumentId: String, documentId: String) = parentDocumentId == "root" && documentId in files
    override fun queryRoots(projection: Array<out String>?): Cursor = MatrixCursor(projection ?: emptyArray())
    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val columns = projection ?: emptyArray()
        val cursor = MatrixCursor(columns)
        cursor.newRow().also { row -> columns.forEach { column ->
            row.add(when (column) {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID -> documentId
                DocumentsContract.Document.COLUMN_DISPLAY_NAME -> if (documentId == "root") "documents" else names[documentId]
                DocumentsContract.Document.COLUMN_MIME_TYPE -> if (documentId == "root") DocumentsContract.Document.MIME_TYPE_DIR else "application/pdf"
                DocumentsContract.Document.COLUMN_SIZE -> files[documentId]?.length()
                else -> null
            })
        } }
        return cursor
    }
    override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor {
        val columns = projection ?: emptyArray()
        val cursor = MatrixCursor(columns)
        files.keys.forEach { id -> cursor.newRow().also { row -> columns.forEach { column -> row.add(when (column) {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID -> id
            DocumentsContract.Document.COLUMN_DISPLAY_NAME -> names[id]
            DocumentsContract.Document.COLUMN_MIME_TYPE -> "application/pdf"
            DocumentsContract.Document.COLUMN_SIZE -> files[id]?.length()
            else -> null
        }) } } }
        return cursor
    }
    override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor {
        val file = files[documentId] ?: throw FileNotFoundException(documentId)
        val flags = if (mode.contains("w")) ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_TRUNCATE else ParcelFileDescriptor.MODE_READ_ONLY
        return ParcelFileDescriptor.open(file, flags)
    }
    override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
        beforeCreateDocument?.invoke()
        check(parentDocumentId == "root")
        val id = "copy-${nextId++}"
        files[id] = File.createTempFile("kindle-host-copy", ".pdf")
        names[id] = displayName
        return id
    }
    override fun deleteDocument(documentId: String) {
        names.remove(documentId)
        files.remove(documentId)?.delete()
    }
}
