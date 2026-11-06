package app.bookstr.kindle

import android.app.Application
import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.mtp.MtpConstants
import android.mtp.MtpDevice
import android.mtp.MtpObjectInfo
import android.mtp.MtpStorageInfo
import android.os.ParcelFileDescriptor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.util.ReflectionHelpers
import java.io.File

private data class MtpEntry(val info: MtpObjectInfo, var bytes: ByteArray = byteArrayOf())

private object MtpFixture {
    var permitted = true
    var openSucceeds = true
    var returnNullHandles = false
    var returnNullInfoFor: Int? = null
    var failPartialRead = false
    var failSend = false
    var corruptSend = false
    var failDelete = false
    var storageIdsNull = false
    var nextHandle = 10
    var closed = false
    val objects = linkedMapOf<Int, MtpEntry>()
    val devices = linkedMapOf<String, UsbDevice>()
    const val STORAGE = 77
    const val DOCUMENTS = 1
    const val FOLDER = 2

    fun reset() {
        permitted = true; openSucceeds = true; returnNullHandles = false
        returnNullInfoFor = null; failPartialRead = false; failSend = false; corruptSend = false; failDelete = false; storageIdsNull = false
        nextHandle = 10; closed = false; objects.clear(); devices.clear()
        add(DOCUMENTS, "documents", MtpConstants.FORMAT_ASSOCIATION, -1)
        add(FOLDER, "nested", MtpConstants.FORMAT_ASSOCIATION, DOCUMENTS)
        add(3, "existing.pdf", MtpConstants.FORMAT_UNDEFINED_DOCUMENT, FOLDER, "existing bytes".toByteArray())
    }

    fun add(handle: Int, name: String, format: Int, parent: Int, bytes: ByteArray = byteArrayOf()): MtpEntry {
        val info = MtpObjectInfo.Builder().setObjectHandle(handle).setStorageId(STORAGE)
            .setName(name).setFormat(format).setParent(parent).setCompressedSize(bytes.size.toLong()).build()
        return MtpEntry(info, bytes).also { objects[handle] = it }
    }
}

@Implements(UsbManager::class)
class ShadowMtpUsbManager {
    @Implementation fun hasPermission(device: UsbDevice): Boolean = MtpFixture.permitted
    @Implementation fun openDevice(device: UsbDevice): UsbDeviceConnection =
        ReflectionHelpers.callConstructor(
            UsbDeviceConnection::class.java,
            ReflectionHelpers.ClassParameter.from(UsbDevice::class.java, device),
        )
    @Implementation fun getDeviceList(): HashMap<String, UsbDevice> = HashMap(MtpFixture.devices)
}

@Implements(MtpDevice::class)
class ShadowMtpDevice {
    @Implementation fun __constructor__(device: UsbDevice) {}
    @Implementation fun open(connection: UsbDeviceConnection): Boolean = MtpFixture.openSucceeds
    @Implementation fun close() { MtpFixture.closed = true }
    @Implementation fun getStorageIds(): IntArray? = if (MtpFixture.storageIdsNull) null else intArrayOf(MtpFixture.STORAGE)
    @Implementation fun getObjectHandles(storageId: Int, format: Int, parent: Int): IntArray? {
        if (MtpFixture.returnNullHandles) return null
        return MtpFixture.objects.values.filter { it.info.parent == parent }.map { it.info.objectHandle }.toIntArray()
    }
    @Implementation fun getObjectInfo(handle: Int): MtpObjectInfo? =
        if (MtpFixture.returnNullInfoFor == handle) null else MtpFixture.objects[handle]?.info
    @Implementation fun getStorageInfo(storageId: Int): MtpStorageInfo? = null
    @Implementation fun getPartialObject(handle: Int, offset: Long, length: Long, buffer: ByteArray): Long {
        if (MtpFixture.failPartialRead) return 0
        val bytes = MtpFixture.objects[handle]?.bytes ?: return 0
        val start = offset.toInt()
        val count = minOf(length.toInt(), buffer.size, bytes.size - start)
        if (count <= 0) return 0
        bytes.copyInto(buffer, 0, start, start + count)
        return count.toLong()
    }
    @Implementation fun sendObjectInfo(info: MtpObjectInfo): MtpObjectInfo? {
        val handle = MtpFixture.nextHandle++
        val created = MtpObjectInfo.Builder(info).setObjectHandle(handle).build()
        MtpFixture.objects[handle] = MtpEntry(created)
        return created
    }
    @Implementation fun sendObject(handle: Int, size: Long, descriptor: ParcelFileDescriptor): Boolean {
        if (MtpFixture.failSend) return false
        val bytes = ParcelFileDescriptor.AutoCloseInputStream(
            ParcelFileDescriptor.dup(descriptor.fileDescriptor),
        ).use { it.readBytes() }
        if (MtpFixture.corruptSend && bytes.isNotEmpty()) bytes[0] = (bytes[0].toInt() xor 1).toByte()
        MtpFixture.objects[handle]?.bytes = bytes
        return bytes.size.toLong() == size
    }
    @Implementation fun deleteObject(handle: Int): Boolean {
        if (MtpFixture.failDelete) return false
        return MtpFixture.objects.remove(handle) != null
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28], shadows = [ShadowMtpUsbManager::class, ShadowMtpDevice::class])
class MtpKindleDocumentsTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    private fun usbDevice(name: String, vendorId: Int = AMAZON_USB_VENDOR_ID, productName: String? = "Fixture Kindle"): UsbDevice =
        ReflectionHelpers.callConstructor(
            UsbDevice::class.java,
            ReflectionHelpers.ClassParameter.from(String::class.java, name),
            ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, vendorId),
            ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 1),
            ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 0),
            ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 0),
            ReflectionHelpers.ClassParameter.from(Int::class.javaPrimitiveType!!, 0),
            ReflectionHelpers.ClassParameter.from(String::class.java, "Fixture"),
            ReflectionHelpers.ClassParameter.from(String::class.java, productName),
            ReflectionHelpers.ClassParameter.from(String::class.java, "1.0"),
            ReflectionHelpers.ClassParameter.from(String::class.java, "serial"),
        )

    private fun target(device: UsbDevice = usbDevice("/dev/mtp0")) = MtpKindleDocuments(context, device)

    @org.junit.Before fun resetFixture() = MtpFixture.reset()

    @Test fun traversesNestedFoldersHashesFilesAndCopiesWithoutReplacingExistingNames() {
        val device = usbDevice("/dev/mtp0", productName = null)
        val target = target(device)
        val source = File.createTempFile("mtp-copy", ".txt").apply { writeText("new text") }
        try {
            assertEquals("Kindle", target.name)
            assertEquals(1, target.files().size)
            val existing = target.files().single()
            assertEquals("existing.pdf", existing.name)
            assertEquals("existing bytes".toByteArray().size.toLong(), existing.size)
            assertEquals(digest("existing bytes".byteInputStream()), existing.hash())
            assertNull(target.freeBytes())

            target.copy(KindleBook("new", "New", "Author", source, "txt"), "new-book.txt")
            val copied = target.files().single { it.name == "new-book.txt" }
            assertEquals(sha256(source), copied.hash())
            assertThrows(IllegalStateException::class.java) {
                target.copy(KindleBook("new", "New", "Author", source, "txt"), "new-book.txt")
            }
            assertEquals(MtpConstants.FORMAT_TEXT, MtpFixture.objects.values.single { it.info.name == "new-book.txt" }.info.format)
        } finally {
            target.close()
            source.delete()
        }
        assertTrue(MtpFixture.closed)
    }

    @Test fun rejectsMissingPermissionAndClosesConnectionAfterMtpOpenFailure() {
        MtpFixture.permitted = false
        assertThrows(IllegalStateException::class.java) { target() }
        MtpFixture.permitted = true
        MtpFixture.openSucceeds = false
        assertThrows(IllegalStateException::class.java) { target() }
        assertTrue(MtpFixture.closed)
    }

    @Test fun closesDeviceWhenStorageOrDocumentsFolderCannotBeOpened() {
        MtpFixture.storageIdsNull = true
        assertThrows(IllegalStateException::class.java) { target() }
        assertTrue(MtpFixture.closed)

        MtpFixture.reset()
        MtpFixture.objects.remove(MtpFixture.DOCUMENTS)
        assertThrows(IllegalStateException::class.java) { target() }
        assertTrue(MtpFixture.closed)

        MtpFixture.reset()
        MtpFixture.returnNullInfoFor = MtpFixture.DOCUMENTS
        assertThrows(IllegalStateException::class.java) { target() }
        assertTrue(MtpFixture.closed)
    }

    @Test fun rejectsDisconnectedDescendantListingsAndExcessiveFolderDepth() {
        val disconnected = target()
        try {
            MtpFixture.returnNullHandles = true
            assertThrows(IllegalStateException::class.java) { disconnected.files() }
        } finally { disconnected.close() }

        MtpFixture.reset()
        var parent = MtpFixture.FOLDER
        repeat(9) { index ->
            val handle = 20 + index
            MtpFixture.add(handle, "folder-$index", MtpConstants.FORMAT_ASSOCIATION, parent)
            parent = handle
        }
        val nested = target()
        try {
            assertThrows(IllegalStateException::class.java) { nested.files() }
        } finally { nested.close() }
    }

    @Test fun cleansUpFailedSendAndReportsFailedPartialReads() {
        val target = target()
        val source = File.createTempFile("mtp-copy", ".pdf").apply { writeText("pdf bytes") }
        try {
            MtpFixture.failSend = true
            assertThrows(IllegalStateException::class.java) {
                target.copy(KindleBook("new", "New", "Author", source, "pdf"), "new-book.pdf")
            }
            assertFalse(MtpFixture.objects.values.any { it.info.name == "new-book.pdf" })
            MtpFixture.failDelete = true
            val cleanupFailure = assertThrows(IllegalStateException::class.java) {
                target.copy(KindleBook("new", "New", "Author", source, "pdf"), "partial-book.pdf")
            }
            assertTrue(cleanupFailure.message!!.contains("could not be removed"))
            assertEquals(1, cleanupFailure.suppressed.size)
            MtpFixture.failDelete = false
            MtpFixture.objects.values.filter { it.info.name == "partial-book.pdf" }.map { it.info.objectHandle }.forEach { MtpFixture.objects.remove(it) }
            MtpFixture.failSend = false
            MtpFixture.corruptSend = true
            val verificationFailure = assertThrows(IllegalStateException::class.java) {
                target.copy(KindleBook("new", "New", "Author", source, "pdf"), "corrupt-book.pdf")
            }
            assertTrue(verificationFailure.message!!.contains("Kindle copy verification failed"))
            assertFalse(MtpFixture.objects.values.any { it.info.name == "corrupt-book.pdf" })
            assertEquals(listOf("existing.pdf"), target.files().map { it.name })
            MtpFixture.corruptSend = false
            MtpFixture.failPartialRead = true
            assertThrows(IllegalStateException::class.java) { target.files().single { it.name == "existing.pdf" }.hash() }
        } finally {
            target.close()
            source.delete()
        }
    }

    @Test fun connectedKindlesFiltersByAmazonVendorAndSortsDeviceNames() {
        val manager = context.getSystemService(UsbManager::class.java)
        val later = usbDevice("/dev/z", productName = "Later")
        val earlier = usbDevice("/dev/a", productName = "Earlier")
        val other = usbDevice("/dev/b", vendorId = 1, productName = "Other")
        MtpFixture.devices[later.deviceName] = later
        MtpFixture.devices[other.deviceName] = other
        MtpFixture.devices[earlier.deviceName] = earlier
        assertEquals(listOf("/dev/a", "/dev/z"), connectedKindles(manager).map { it.deviceName })
    }
}
