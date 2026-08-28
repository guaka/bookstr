package app.bookstr.data

import org.json.JSONArray
import org.json.JSONObject

/** Stable, private-cache representation for named Nostr collections. */
object CollectionSnapshotCodec {
    fun encode(snapshot: CollectionSnapshot): String {
        val collections = JSONArray()
        snapshot.collections.filter { it.id.isNotBlank() }.forEach { collection ->
            collections.put(
                JSONObject()
                    .put("id", collection.id)
                    .put("title", collection.title)
                    .put("description", collection.description)
                    .put("updatedAt", collection.updatedAt)
                    .put("items", JSONArray(NostrFavoritesRepository.serializeSharedFavoriteTags(collection.items))),
            )
        }
        val tombstones = JSONArray()
        snapshot.tombstones.filter { it.id.isNotBlank() }.forEach { tombstone ->
            tombstones.put(JSONObject().put("id", tombstone.id).put("deletedAt", tombstone.deletedAt))
        }
        return JSONObject().put("collections", collections).put("tombstones", tombstones).toString()
    }

    fun decode(raw: String?): CollectionSnapshot {
        val root = runCatching { JSONObject(raw ?: "{}") }.getOrElse { return CollectionSnapshot() }
        val collections = mutableListOf<BookCollection>()
        val rawCollections = root.optJSONArray("collections") ?: JSONArray()
        for (index in 0 until rawCollections.length()) {
            val item = rawCollections.optJSONObject(index) ?: continue
            val id = item.optString("id")
            if (id.isBlank()) continue
            val refs = runCatching {
                NostrFavoritesRepository.parseSharedFavoriteTags(item.optJSONArray("items")?.toString() ?: "[]")
            }.getOrElse { emptyList() }
            collections += BookCollection(
                id = id,
                title = item.optString("title"),
                description = item.optString("description"),
                updatedAt = item.optLong("updatedAt"),
                items = refs,
            )
        }
        val tombstones = mutableListOf<CollectionTombstone>()
        val rawTombstones = root.optJSONArray("tombstones") ?: JSONArray()
        for (index in 0 until rawTombstones.length()) {
            val item = rawTombstones.optJSONObject(index) ?: continue
            val id = item.optString("id")
            if (id.isBlank()) continue
            tombstones += CollectionTombstone(id, item.optLong("deletedAt"))
        }
        return CollectionSnapshot(collections, tombstones)
    }
}
