package app.bookstr

import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import java.util.Locale

/** Stable cross-app contract for the downloaded-books MediaBrowser catalog. */
internal object BookstrMediaCatalog {
    const val ROOT_ID = "bookstr-downloaded-books"
    const val EXTRA_FORMAT = "app.bookstr.extra.FORMAT"
    const val EXTRA_PLAYABLE = "app.bookstr.extra.PLAYABLE"
    const val EXTRA_OPEN_READER = "app.bookstr.extra.OPEN_READER"

    private val mediaIdPattern = Regex("(?:[0-9a-f]{32}|[0-9a-f]{64})")
    private val allowedClients = setOf(
        "app.bookstr",
        "org.guaka.radio",
        "com.google.android.projection.gearhead",
    )

    data class Entry(val book: CatalogBook, val playable: Boolean)

    fun isValidMediaId(id: String): Boolean = mediaIdPattern.matches(id)

    /** Accepts only real local download IDs and preserves all readable-format metadata. */
    fun entries(books: List<CatalogBook>, isDownloaded: (CatalogBook) -> Boolean): List<Entry> =
        books.asSequence()
            .filter { isValidMediaId(it.id) }
            .filter(isDownloaded)
            .distinctBy { it.id }
            .sortedBy { it.title.lowercase(Locale.ROOT) }
            .map { Entry(it, playable = it.format == BookFormat.Epub) }
            .toList()

    /** Match both Android's claimed package and the packages actually owning the calling UID. */
    fun isAllowedClient(packageName: String, packagesForUid: Collection<String>): Boolean =
        packageName in allowedClients && packageName in packagesForUid
}
