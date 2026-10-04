package app.bookstr.kindle

import java.io.File
import java.security.MessageDigest

data class KindleBook(val id: String, val title: String, val author: String, val file: File, val extension: String)
data class KindleFile(val name: String, val size: Long, val hash: () -> String)
data class KindlePreview(val missing: List<KindleBook>, val alreadyPresent: Int, val skipped: List<String>)
data class KindleResult(val copied: List<String>, val alreadyPresent: Int, val skipped: List<String>, val errors: List<String>)

interface KindleDocuments : AutoCloseable {
    val name: String
    fun files(): List<KindleFile>
    fun freeBytes(): Long?
    fun copy(book: KindleBook, name: String)
    override fun close() {}
}

internal fun <T> copyNewKindleFile(
    create: () -> T,
    write: (T) -> Unit,
    verify: (T) -> Unit,
    removeIncomplete: (T) -> Unit,
) {
    val created = create()
    try {
        write(created)
        verify(created)
    } catch (failure: Exception) {
        try {
            removeIncomplete(created)
        } catch (cleanupFailure: Exception) {
            val reported = IllegalStateException(
                "${failure.message ?: "Kindle copy failed."} Incomplete Kindle file could not be removed.",
                failure,
            )
            reported.addSuppressed(cleanupFailure)
            throw reported
        }
        throw failure
    }
}

fun sha256(file: File): String = file.inputStream().use { input -> digest(input) }

fun digest(input: java.io.InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val bytes = ByteArray(64 * 1024)
    while (true) {
        val count = input.read(bytes)
        if (count < 0) break
        digest.update(bytes, 0, count)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

fun kindleFilename(book: KindleBook, hash: String): String {
    val label = "${book.title} - ${book.author}".replace(Regex("[<>:\"/\\\\|?*\\p{Cntrl}]"), " ")
        .replace(Regex("\\s+"), " ").trim().take(120).ifBlank { "Book" }
    return "$label - ${hash.take(16)}.${book.extension}"
}

class KindleTransfer(private val localBooks: () -> List<KindleBook>) {
    private fun selected(bookId: String?): Pair<List<KindleBook>, List<String>> {
        val all = localBooks()
        if (bookId != null && all.none { it.id == bookId }) error("Downloaded book was not found.")
        val candidates = if (bookId == null) all else all.filter { it.id == bookId }
        val skipped = candidates.filter { it.extension.lowercase() !in setOf("pdf", "txt") || !it.file.isFile }
        if (bookId != null && skipped.isNotEmpty()) error("Book is not a completed PDF or TXT download.")
        return candidates.filterNot { it in skipped } to skipped.map { "${it.title}: unsupported or unavailable" }
    }

    fun preview(target: KindleDocuments, bookId: String? = null): KindlePreview {
        val (books, skipped) = selected(bookId)
        val sizes = books.map { it.file.length() }.toSet()
        val existing = target.files().filter { it.size in sizes }
        val hashes = existing.map { it.hash() }.toMutableSet()
        val missing = books.filter { hashes.add(sha256(it.file)) }
        return KindlePreview(missing, books.size - missing.size, skipped)
    }

    fun transfer(target: KindleDocuments, bookId: String? = null, progress: (Int, Int, String) -> Unit = { _, _, _ -> }): KindleResult {
        val plan = preview(target, bookId)
        val copied = mutableListOf<String>()
        val errors = mutableListOf<String>()
        for (book in plan.missing) {
            progress(copied.size, plan.missing.size, book.title)
            try {
                val size = book.file.length()
                if (target.freeBytes()?.let { it < size * 2 } == true) error("Kindle is out of space.")
                target.copy(book, kindleFilename(book, sha256(book.file)))
                copied += book.id
            } catch (failure: Exception) {
                errors += "${book.title}: ${failure.message ?: "copy failed"}"
            }
        }
        return KindleResult(copied, plan.alreadyPresent, plan.skipped, errors)
    }
}
