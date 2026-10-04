package app.bookstr.kindle

import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.mtp.MtpConstants
import android.mtp.MtpDevice
import android.mtp.MtpObjectInfo
import android.os.ParcelFileDescriptor
import java.security.MessageDigest

const val AMAZON_USB_VENDOR_ID = 0x1949

fun connectedKindles(manager: UsbManager): List<UsbDevice> = manager.deviceList.values
    .filter { it.vendorId == AMAZON_USB_VENDOR_ID }.sortedBy { it.deviceName }

class MtpKindleDocuments(context: Context, private val usb: UsbDevice) : KindleDocuments {
    private val manager = context.getSystemService(UsbManager::class.java)
    private val mtp = MtpDevice(usb)
    private var storageId = 0
    private var documentsHandle = 0
    override val name: String = usb.productName ?: "Kindle"

    init {
        check(manager.hasPermission(usb)) { "Kindle USB permission is required." }
        val connection = checkNotNull(manager.openDevice(usb)) { "Kindle is disconnected." }
        check(mtp.open(connection)) { "Kindle MTP connection failed." }
        try {
            val roots = checkNotNull(mtp.storageIds) { "Kindle storage is unavailable." }
            for (id in roots) {
                val folder = findDocuments(id)
                if (folder != 0) { storageId = id; documentsHandle = folder; break }
            }
            check(documentsHandle != 0) { "Kindle documents folder was not found." }
        } catch (failure: Exception) { mtp.close(); throw failure }
    }

    private fun findDocuments(id: Int): Int {
        for (handle in mtp.getObjectHandles(id, 0, -1) ?: intArrayOf()) {
            val info = mtp.getObjectInfo(handle) ?: continue
            if (info.name.equals("documents", ignoreCase = true) && info.format == MtpConstants.FORMAT_ASSOCIATION) return handle
        }
        return 0
    }

    private fun descendants(parent: Int, depth: Int = 0): List<MtpObjectInfo> {
        check(depth <= 8) { "Kindle documents are too deeply nested." }
        val result = mutableListOf<MtpObjectInfo>()
        for (handle in checkNotNull(mtp.getObjectHandles(storageId, 0, parent)) { "Kindle is disconnected." }) {
            val info = checkNotNull(mtp.getObjectInfo(handle)) { "Kindle is disconnected." }
            if (info.format == MtpConstants.FORMAT_ASSOCIATION) result += descendants(handle, depth + 1)
            else result += info
        }
        return result
    }

    override fun files(): List<KindleFile> = descendants(documentsHandle).map { info ->
        KindleFile(info.name, info.compressedSizeLong) { hashObject(info.objectHandle, info.compressedSizeLong) }
    }

    private fun hashObject(handle: Int, size: Long): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        var offset = 0L
        while (offset < size) {
            val count = mtp.getPartialObject(handle, offset, minOf(buffer.size.toLong(), size - offset), buffer)
            check(count > 0 && count <= buffer.size) { "Kindle disconnected while reading." }
            digest.update(buffer, 0, count.toInt())
            offset += count
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    override fun freeBytes(): Long? = mtp.getStorageInfo(storageId)?.freeSpace

    override fun copy(book: KindleBook, name: String) {
        check(files().none { it.name == name }) { "A Kindle file already has this name." }
        val info = MtpObjectInfo.Builder()
            .setStorageId(storageId).setParent(documentsHandle).setName(name)
            .setFormat(if (book.extension == "txt") MtpConstants.FORMAT_TEXT else MtpConstants.FORMAT_UNDEFINED_DOCUMENT)
            .setCompressedSize(book.file.length()).build()
        val created = checkNotNull(mtp.sendObjectInfo(info)) { "Kindle could not create a file." }
        ParcelFileDescriptor.open(book.file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
            check(mtp.sendObject(created.objectHandle, book.file.length(), descriptor)) { "Kindle copy failed." }
        }
        check(hashObject(created.objectHandle, book.file.length()) == sha256(book.file)) { "Kindle copy verification failed." }
    }

    override fun close() = mtp.close()
}
