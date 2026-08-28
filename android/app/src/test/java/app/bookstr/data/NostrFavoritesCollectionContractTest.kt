package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NostrFavoritesCollectionContractTest {
    private val firstId = "bookstr-collection-${"a".repeat(32)}"
    private val secondId = "bookstr-collection-${"b".repeat(32)}"

    @Test
    fun collectionIndexAcceptsValidEntriesAndAppliesTombstones() {
        val index = NostrFavoritesRepository.parseCollectionIndex(
            """[["collection","$firstId","Reading","12"],["collection","$secondId","","bad"],["deleted","$secondId","13"],["ignored"]]""",
        )

        assertEquals(listOf(CollectionIndexEntry(firstId, "Reading", 12)), index.entries)
        assertEquals(listOf(CollectionTombstone(secondId, 13)), index.tombstones)
    }

    @Test
    fun collectionIndexIgnoresInvalidInputAndUsesDefaults() {
        assertEquals(CollectionIndex(), NostrFavoritesRepository.parseCollectionIndex("not json"))
        val index = NostrFavoritesRepository.parseCollectionIndex(
            """[null,["collection","$firstId"],["collection","bad","No","1"],["collection","$firstId","","invalid"],["deleted","bad","2"],["deleted","$secondId","bad"]]""",
        )
        assertEquals(listOf(CollectionIndexEntry(firstId, "Untitled list", 0)), index.entries)
        assertEquals(listOf(CollectionTombstone(secondId, 0)), index.tombstones)
    }

    @Test
    fun collectionParserKeepsPublicationRefsAndCollectionMetadata() {
        val collection = NostrFavoritesRepository.parseCollection(
            """[["title","Custom"],["description","Notes"],["updated","21"],["book","isbn","978-0-306-40615-7","9"]]""",
            firstId,
            "Fallback",
            8,
        )!!

        assertEquals(firstId, collection.id)
        assertEquals("Custom", collection.title)
        assertEquals("Notes", collection.description)
        assertEquals(21, collection.updatedAt)
        assertEquals("9780306406157", collection.items.single().isbn)
    }

    @Test
    fun collectionParserRejectsInvalidIdAndMalformedDocumentAndUsesFallbacks() {
        assertNull(NostrFavoritesRepository.parseCollection("[]", "bad", "Fallback", 8))
        assertNull(NostrFavoritesRepository.parseCollection("bad", firstId, "Fallback", 8))

        val collection = NostrFavoritesRepository.parseCollection("[]", firstId, "Fallback", 8)!!
        assertEquals("Fallback", collection.title)
        assertEquals("", collection.description)
        assertEquals(8, collection.updatedAt)

        val withEmptyMetadata = NostrFavoritesRepository.parseCollection(
            """[null,["title",""],["updated","bad"]]""",
            firstId,
            "Fallback",
            8,
        )!!
        assertEquals("Fallback", withEmptyMetadata.title)
        assertEquals(8, withEmptyMetadata.updatedAt)
    }

    @Test
    fun collectionIdsAreStrictLowercaseUuidHex() {
        assertTrue(NostrFavoritesRepository.isCollectionId(firstId))
        assertFalse(NostrFavoritesRepository.isCollectionId("bookstr-collection-${"A".repeat(32)}"))
        assertFalse(NostrFavoritesRepository.isCollectionId("bookstr-favorites-${"a".repeat(32)}"))
    }

    @Test
    fun collectionSnapshotCodecRoundTripsRefsAndTombstones() {
        val snapshot = CollectionSnapshot(
            collections = listOf(
                BookCollection(
                    id = firstId,
                    title = "Reading",
                    description = "Soon",
                    updatedAt = 12,
                    items = listOf(SharedFavoriteRef(isbn = "978-0-306-40615-7", addedAt = 9)),
                ),
                BookCollection("", "Ignored", "", 0, emptyList()),
            ),
            tombstones = listOf(CollectionTombstone(secondId, 13), CollectionTombstone("", 0)),
        )

        assertEquals(
            CollectionSnapshot(
                collections = listOf(
                    snapshot.collections.first().copy(
                        items = listOf(SharedFavoriteRef(isbn = "9780306406157", addedAt = 9)),
                    ),
                ),
                tombstones = listOf(CollectionTombstone(secondId, 13)),
            ),
            CollectionSnapshotCodec.decode(CollectionSnapshotCodec.encode(snapshot)),
        )
    }

    @Test
    fun collectionSnapshotCodecHandlesMissingMalformedAndPartialCache() {
        assertEquals(CollectionSnapshot(), CollectionSnapshotCodec.decode(null))
        assertEquals(CollectionSnapshot(), CollectionSnapshotCodec.decode("bad"))
        assertEquals(
            CollectionSnapshot(
                collections = listOf(BookCollection(firstId, "", "", 0, emptyList())),
                tombstones = listOf(CollectionTombstone(secondId, 0)),
            ),
            CollectionSnapshotCodec.decode("""{"collections":[null, {}, {"id":"$firstId","items":"bad"}],"tombstones":[null, {}, {"id":"$secondId"}]}"""),
        )
    }
}
