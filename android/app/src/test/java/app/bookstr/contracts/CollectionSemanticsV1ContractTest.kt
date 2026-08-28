package app.bookstr.contracts

import app.bookstr.data.CollectionIndexEntry
import app.bookstr.data.CollectionTombstone
import app.bookstr.data.NostrFavoritesRepository
import app.bookstr.data.SharedFavoriteRef
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

class CollectionSemanticsV1ContractTest {
    private val fixture = JSONObject(File("../../shared/fixtures/collection-semantics-v1.json").readText())

    @Test
    fun androidCollectionIndexParserConformsToEverySharedV1Case() {
        assertEquals(1, fixture.getInt("version"))
        val cases = fixture.getJSONArray("indexCases")
        repeat(cases.length()) { index ->
            val entry = cases.getJSONObject(index)
            val expected = entry.getJSONObject("expected")
            val actual = NostrFavoritesRepository.parseCollectionIndex(entry.getString("plaintext"))
            assertEquals(
                entry.getString("name"),
                indexEntries(expected.getJSONArray("entries")),
                actual.entries,
            )
            assertEquals(
                entry.getString("name"),
                tombstones(expected.getJSONArray("tombstones")),
                actual.tombstones,
            )
        }
    }

    @Test
    fun androidCollectionParserConformsToEverySharedV1Case() {
        val cases = fixture.getJSONArray("collectionCases")
        repeat(cases.length()) { index ->
            val entry = cases.getJSONObject(index)
            val actual = NostrFavoritesRepository.parseCollection(
                entry.getString("plaintext"),
                entry.getString("id"),
                entry.getString("fallbackTitle"),
                entry.getLong("fallbackUpdatedAt"),
            )
            if (entry.isNull("expected")) {
                assertNull(entry.getString("name"), actual)
                return@repeat
            }
            val expected = entry.getJSONObject("expected")
            val canonical = JSONObject()
                .put("id", actual!!.id)
                .put("title", actual.title)
                .put("description", actual.description)
                .put("updatedAt", actual.updatedAt)
                .put("items", JSONArray(actual.items.map(::canonicalReference)))
            assertEquals(entry.getString("name"), expected.toString(), canonical.toString())
        }
    }

    private fun indexEntries(values: JSONArray): List<CollectionIndexEntry> =
        List(values.length()) { index ->
            values.getJSONObject(index).let {
                CollectionIndexEntry(it.getString("id"), it.getString("title"), it.getLong("updatedAt"))
            }
        }

    private fun tombstones(values: JSONArray): List<CollectionTombstone> =
        List(values.length()) { index ->
            values.getJSONObject(index).let { CollectionTombstone(it.getString("id"), it.getLong("deletedAt")) }
        }

    private fun canonicalReference(ref: SharedFavoriteRef): JSONObject {
        val (type, identifier, locator) = when {
            ref.libvaultMd5 != null -> Triple("libvault", ref.libvaultMd5, ref.url)
            ref.bookstrId != null -> Triple("bookstr", ref.bookstrId, ref.url)
            ref.isbn != null -> Triple("isbn", ref.isbn, ref.url)
            ref.blossomSha256 != null -> Triple("blossom", ref.blossomSha256, ref.blossomUrl)
            else -> Triple("url", ref.url.orEmpty(), ref.url)
        }
        return JSONObject()
            .put("type", type)
            .put("identifier", identifier)
            .put("locator", locator.orEmpty())
            .put("addedAt", ref.addedAt ?: 0L)
    }
}
