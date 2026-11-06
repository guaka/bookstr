package app.bookstr.data

import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import androidx.room.Room
import app.bookstr.nostr.Nip55
import app.bookstr.nostr.AmberIntentSession
import app.bookstr.nostr.NostrCrypto
import app.bookstr.nostr.NostrClient
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(
    application = Application::class,
    sdk = [28],
    instrumentedPackages = ["androidx.security.crypto"],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedSharedPreferences::class],
)
class NostrRepositoryCoverageTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private lateinit var settings: SettingsRepository
    private lateinit var database: AppDatabase
    private lateinit var vocabulary: VocabularyRepository
    private val servers = mutableListOf<RelayFixture>()

    @Before
    fun setUp() {
        AmberIntentSession.Host.session = null
        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("robolectric_encrypted_bookstr_secure", Context.MODE_PRIVATE).edit().clear().commit()
        settings = SettingsRepository(context)
        database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        vocabulary = VocabularyRepository(database.vocabularyWordDao())
    }

    @After
    fun tearDown() {
        AmberIntentSession.Host.session = null
        servers.forEach(RelayFixture::close)
        database.close()
    }

    @Test
    fun missingIdentityAndEmptyRelayListShortCircuitAllOperations() = runBlocking<Unit> {
        val repo = repository()
        assertFalse(repo.publishProgress("book", .5, "cfi"))
        assertNull(repo.pullProgress("book"))
        assertFalse(repo.publishVocabularyWord(word("one")))
        assertEquals(0, repo.pullVocabulary())

        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "   "
        assertFalse(repo.publishProgress("book", .5, "cfi"))
        assertNull(repo.pullProgress("book"))
        assertFalse(repo.publishVocabularyWord(word("two")))
        assertEquals(0, repo.pullVocabulary())

        settings.connectNsec(PRIVATE_KEY, PUBKEY)
        settings.relays = emptyList()
        assertFalse(repo.publishProgress("book", .5, "cfi"))
        assertNull(repo.pullProgress("book"))
        assertFalse(repo.publishVocabularyWord(word("three")))
        assertEquals(0, repo.pullVocabulary())

        settings.relays = listOf("ws://127.0.0.1:1/")
        settings.nsec = "not-a-private-key"
        settings.pubkeyHex = null
        assertFalse(repo.publishProgress("book", .5, "cfi"))
        assertNull(repo.pullProgress("book"))
    }

    @Test
    fun progressPublicationUsesRealLocalSignatureAndPullMergesFurthestProgress() = runBlocking<Unit> {
        val published = AtomicReference<JSONObject?>()
        var remoteContent = progressContent("book-1", .4, "remote-cfi", .6, 2_000L)
        val server = relay { socket, message ->
            val request = JSONArray(message)
            when (request.getString(0)) {
                "EVENT" -> {
                    val event = request.getJSONObject(1)
                    published.set(event)
                    socket.send(JSONArray().put("OK").put(event.getString("id")).put(true).put("").toString())
                }
                "REQ" -> socket.send(
                    JSONArray().put("EVENT").put(request.getString(1)).put(
                        JSONObject().put("content", remoteContent).put("created_at", 1L),
                    ).toString(),
                )
            }
        }
        settings.connectNsec(PRIVATE_KEY, PUBKEY)
        settings.relays = listOf(serverUrl(server))
        val repo = repository()

        assertTrue(
            repo.publishProgress(
                bookId = "book-1", progression = .35, cfi = "local-cfi", furthestProgression = .7,
                title = "Title", author = "Author", rights = BookRights("open_license", "CC BY 4.0", "https://license.example", "catalog"),
            ),
        )
        val signed = requireNotNull(published.get())
        assertTrue(NostrCrypto.verifyEvent(signed))
        assertEquals(NostrClient.KIND_PROGRESS, signed.getInt("kind"))
        assertEquals(NostrClient.progressDTag("book-1"), signed.getJSONArray("tags").getJSONArray(0).getString(1))
        val outgoing = JSONObject(signed.getString("content"))
        assertEquals("Title", outgoing.getString("title"))
        assertEquals("CC BY 4.0", outgoing.getString("license"))

        database.bookProgressDao().upsert(BookProgress("book-1", .9, "local", 1_000L, .95))
        val merged = repo.pullProgress("book-1")
        assertEquals(.4, merged?.progression ?: 0.0, 0.0001)
        assertEquals("remote-cfi", merged?.cfi)
        assertEquals(2_000L, merged?.updatedAt)
        assertEquals(.95, merged?.furthestProgression ?: 0.0, 0.0001)

        val staleRemote = progressContent("book-1", .1, "stale", .2, 1_500L)
        remoteContent = staleRemote
        val unchanged = repo.pullProgress("book-1")
        assertEquals(merged, unchanged)
        assertEquals(merged, database.bookProgressDao().get("book-1"))
    }

    @Test
    fun pullProgressReturnsNullForMissingRelayEventOrMalformedContentAndSyncDeduplicatesIds() = runBlocking<Unit> {
        val queriedIds = CopyOnWriteArrayList<String>()
        var respond = false
        val server = relay { socket, message ->
            val request = JSONArray(message)
            if (request.getString(0) == "REQ") {
                val filter = request.getJSONObject(2)
                val id = filter.getJSONArray("#d").getString(0).removePrefix(NostrClient.progressDTag(""))
                queriedIds += id
                if (respond) {
                    val content = if (id == "bad") "not-json" else progressContent(id, .3, "cfi-$id", .4, 3_000L)
                    socket.send(JSONArray().put("EVENT").put(request.getString(1))
                        .put(JSONObject().put("content", content).put("created_at", 3L)).toString())
                } else {
                    socket.send(JSONArray().put("EOSE").put(request.getString(1)).toString())
                }
            }
        }
        settings.connectNsec(PRIVATE_KEY, PUBKEY)
        settings.relays = listOf(serverUrl(server))
        val repo = repository()
        assertNull(repo.pullProgress("missing"))
        respond = true
        assertNull(repo.pullProgress("bad"))
        queriedIds.clear()
        repo.syncAllFromRelays(listOf("new", "new", "bad"))
        assertEquals(1, database.bookProgressDao().getAll().count { it.bookId == "new" })
        assertEquals(1, queriedIds.count { it == "new" })
        assertEquals(1, queriedIds.count { it == "bad" })
    }

    @Test
    fun amberVocabularyPublishAndPullMergeThroughSignerProviderAndRelay() = runBlocking<Unit> {
        val pubkey = NostrCrypto.publicKeyHex(NostrCrypto.parsePrivateKey(PRIVATE_KEY))
        val provider = registerAmberProvider(pubkey)
        val remote = word("remote", lastSeenAt = 2_000L).copy(language = "EN", word = "REMOTE")
        val remoteContent = VocabularyWire.encode(remote).toString()
        val older = word("older", lastSeenAt = 3_000L)
        database.vocabularyWordDao().upsert(older)
        val server = relay { socket, message ->
            val request = JSONArray(message)
            when (request.getString(0)) {
                "EVENT" -> socket.send(JSONArray().put("OK").put(request.getJSONObject(1).getString("id")).put(true).put("").toString())
                "REQ" -> {
                    val responseEvent = JSONObject().put("id", "vocab-event")
                        .put("tags", JSONArray().put(JSONArray().put("d").put(NostrClient.VOCABULARY_D_PREFIX + remote.syncId)))
                        .put("content", remoteContent)
                    socket.send(JSONArray().put("EVENT").put(request.getString(1)).put(responseEvent).toString())
                    socket.send(
                        JSONArray().put("EVENT").put(request.getString(1)).put(
                            JSONObject().put("id", "malformed-vocab")
                                .put("tags", JSONArray().put(JSONArray().put("d").put(NostrClient.VOCABULARY_D_PREFIX + "bad")))
                                .put("content", "not-json"),
                        ).toString(),
                    )
                    val staleContent = VocabularyWire.encode(older.copy(lastSeenAt = 2_000L)).toString()
                    socket.send(
                        JSONArray().put("EVENT").put(request.getString(1)).put(
                            JSONObject().put("id", "stale-vocab")
                                .put("tags", JSONArray().put(JSONArray().put("d").put(NostrClient.VOCABULARY_D_PREFIX + older.syncId)))
                                .put("content", staleContent),
                        ).toString(),
                    )
                    socket.send(JSONArray().put("EOSE").put(request.getString(1)).toString())
                }
            }
        }
        settings.connectAmber(pubkey, "fixture.amber")
        settings.relays = listOf(serverUrl(server))
        val repo = repository()
        val localWord = word("local", lastSeenAt = 1_000L)
        assertTrue(repo.publishVocabularyWord(localWord))
        val outgoingEvent = provider.signedEvents.single()
        assertTrue(NostrCrypto.verifyEvent(outgoingEvent))
        assertEquals(NostrClient.KIND_PROGRESS, outgoingEvent.getInt("kind"))
        assertEquals(NostrClient.VOCABULARY_D_PREFIX + localWord.syncId,
            outgoingEvent.getJSONArray("tags").getJSONArray(0).getString(1))

        assertEquals(1, repo.pullVocabulary())
        val merged = database.vocabularyWordDao().getByWord("en", "remote")
        assertEquals(remote.syncId, merged?.syncId)
        assertEquals("remote", merged?.word)
        assertEquals(2_000L, merged?.lastSeenAt)
        assertEquals(3_000L, database.vocabularyWordDao().getByWord("en", "older")?.lastSeenAt)
        assertTrue(provider.queries.any { it.first.endsWith("NIP44_ENCRYPT") })
        assertTrue(provider.queries.any { it.first.endsWith("NIP44_DECRYPT") })
    }

    @Test
    fun syncWithoutExplicitIdsPullsSavedReadingProgress() = runBlocking<Unit> {
        database.bookProgressDao().upsert(BookProgress("saved-book", .2, "before", 1_000L, .4))
        val queried = CopyOnWriteArrayList<String>()
        val server = relay { socket, message ->
            val request = JSONArray(message)
            if (request.getString(0) == "REQ") {
                request.getJSONObject(2).optJSONArray("#d")?.let { tags ->
                    queried += tags.getString(0)
                    val event = JSONObject().put("created_at", 2L)
                        .put("content", progressContent("saved-book", .6, "after", .8, 2_000L))
                    socket.send(JSONArray().put("EVENT").put(request.getString(1)).put(event).toString())
                }
                socket.send(JSONArray().put("EOSE").put(request.getString(1)).toString())
            }
        }
        settings.connectNsec(PRIVATE_KEY, PUBKEY)
        settings.relays = listOf(serverUrl(server))

        repository().syncAllFromRelays()

        assertEquals(listOf(NostrClient.progressDTag("saved-book")), queried)
        assertEquals(BookProgress("saved-book", .6, "after", 2_000L, .8), database.bookProgressDao().get("saved-book"))
    }

    @Test
    fun localSignerVocabularyRoundTripsEncryptedContentThroughTheRelay() = runBlocking<Unit> {
        val published = AtomicReference<JSONObject?>()
        val server = relay { socket, message ->
            val request = JSONArray(message)
            when (request.getString(0)) {
                "EVENT" -> {
                    val event = request.getJSONObject(1)
                    published.set(event)
                    socket.send(JSONArray().put("OK").put(event.getString("id")).put(true).put("").toString())
                }
                "REQ" -> {
                    published.get()?.let { event ->
                        socket.send(JSONArray().put("EVENT").put(request.getString(1)).put(event).toString())
                    }
                    socket.send(JSONArray().put("EOSE").put(request.getString(1)).toString())
                }
            }
        }
        settings.connectNsec(PRIVATE_KEY, PUBKEY)
        settings.relays = listOf(serverUrl(server))
        val repo = repository()
        val local = word("local")
        assertEquals(0, repo.pullVocabulary())
        assertTrue(repo.publishVocabularyWord(local))
        val event = requireNotNull(published.get())
        assertTrue(NostrCrypto.verifyEvent(event))
        assertEquals(PUBKEY, event.getString("pubkey"))
        assertFalse(event.getString("content") == VocabularyWire.encode(local).toString())
        assertEquals(1, repo.pullVocabulary())
        assertEquals(local.syncId, database.vocabularyWordDao().getByWord("en", local.word)?.syncId)
        assertEquals(0, repo.pullVocabulary())
    }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun missingEncryptionProviderFailsSafelyWithoutChangingVocabulary() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher(testScheduler))
        try {
            val repo = repository()
            val existing = word("existing", lastSeenAt = 9_000L)
            database.vocabularyWordDao().upsert(existing)
            val server = relay { socket, message ->
                val request = JSONArray(message)
                if (request.getString(0) == "REQ") {
                    val remote = JSONObject().put("id", "without-decrypt-permission")
                        .put("tags", JSONArray().put(JSONArray().put("d").put(NostrClient.VOCABULARY_D_PREFIX + "unreadable")))
                        .put("content", "ciphertext")
                    socket.send(JSONArray().put("EVENT").put(request.getString(1)).put(remote).toString())
                    socket.send(JSONArray().put("EOSE").put(request.getString(1)).toString())
                }
            }
            settings.connectAmber(PUBKEY, "absent.vocabulary.signer")
            settings.relays = listOf(serverUrl(server))
            assertFalse(repo.publishVocabularyWord(word("local")))
            assertEquals(0, repo.pullVocabulary())
            assertEquals(existing, database.vocabularyWordDao().get(existing.key))
            assertNull(database.vocabularyWordDao().getByWord("en", "unreadable"))

            settings.relays = listOf("not a relay URL")
            assertEquals(0, repo.pullVocabulary())
            assertEquals(existing, database.vocabularyWordDao().get(existing.key))
            assertNull(database.vocabularyWordDao().getByWord("en", "unreadable"))
        } finally {
            Dispatchers.resetMain()
        }
    }

    private fun repository() = NostrRepository(context, settings, database.bookProgressDao(), vocabulary)

    private fun relay(handler: (WebSocket, String) -> Unit): RelayFixture {
        val sockets = CopyOnWriteArrayList<RelaySocket>()
        val server = MockWebServer().also { mockServer ->
            mockServer.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse =
                    MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                        private fun track(webSocket: WebSocket): RelaySocket = synchronized(sockets) {
                            sockets.firstOrNull { it.socket === webSocket }
                                ?: RelaySocket(webSocket, CountDownLatch(1)).also { sockets.add(it) }
                        }

                        override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                            track(webSocket)
                        }

                        override fun onMessage(webSocket: WebSocket, text: String) {
                            track(webSocket)
                            handler(webSocket, text)
                        }

                        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                            webSocket.close(code, reason)
                        }

                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                            track(webSocket).closed.countDown()
                        }

                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                            track(webSocket).closed.countDown()
                        }
                    })
            }
            mockServer.start()
        }
        val fixture = RelayFixture(server, sockets)
        servers += fixture
        return fixture
    }

    private fun serverUrl(server: RelayFixture): String = server.server.url("/").toString().replaceFirst("http", "ws")

    private class RelaySocket(val socket: WebSocket, val closed: CountDownLatch)

    private class RelayFixture(
        val server: MockWebServer,
        private val sockets: List<RelaySocket>,
    ) {
        fun close() {
            sockets.forEach { it.socket.close(1000, "test teardown") }
            try {
                sockets.forEach {
                    assertTrue("Relay WebSocket did not complete its close lifecycle", it.closed.await(3, TimeUnit.SECONDS))
                }
            } finally {
                server.shutdown()
            }
        }
    }

    private fun progressContent(bookId: String, progression: Double, cfi: String, furthest: Double, updatedAt: Long) =
        NostrClient.progressContent(bookId, progression, cfi, furthest, updatedAt = updatedAt)

    private fun word(id: String, lastSeenAt: Long = 1_000L) = VocabularyWord(
        key = "en:$id", word = id, language = "en", syncId = "sync-$id", bookId = "book-$id",
        bookTitle = "Book $id", cfi = "cfi-$id", contextSentence = "Sentence for $id", partOfSpeech = "noun",
        definitionsJson = JSONArray(listOf("definition $id")).toString(), sourceUrl = "https://example.test/$id",
        lookupCount = 2, firstSeenAt = lastSeenAt - 100, lastSeenAt = lastSeenAt, deleted = false,
    )

    private fun registerAmberProvider(pubkey: String): AmberProvider {
        val provider = AmberProvider()
        val authorities = listOf("SIGN_EVENT", "NIP44_ENCRYPT", "NIP44_DECRYPT").map { "fixture.amber.$it" }
        provider.pubkey = pubkey
        provider.attachInfo(context, ProviderInfo().apply { authority = authorities.joinToString(";") })
        authorities.forEach { ShadowContentResolver.registerProviderInternal(it, provider) }
        return provider
    }

    private class AmberProvider : ContentProvider() {
        lateinit var pubkey: String
        val signedEvents = mutableListOf<JSONObject>()
        val queries = mutableListOf<Pair<String, List<String>?>>()
        private val secret = NostrCrypto.parsePrivateKey(PRIVATE_KEY)

        override fun onCreate() = true
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?,
        ): Cursor {
            val payload = projection?.firstOrNull().orEmpty()
            queries += uri.authority.orEmpty() to projection?.toList()
            val response = when (uri.authority?.substringAfterLast('.')) {
                "NIP44_ENCRYPT", "NIP44_DECRYPT" -> payload
                "SIGN_EVENT" -> {
                    val signed = NostrCrypto.signEvent(secret, JSONObject(payload))
                    signedEvents += signed
                    signed.toString()
                }
                else -> ""
            }
            return MatrixCursor(arrayOf(if (uri.authority?.endsWith("SIGN_EVENT") == true) Nip55.RESULT_EVENT else Nip55.RESULT))
                .apply { addRow(arrayOf(response)) }
        }
    }

    companion object {
        private val PRIVATE_KEY = "00".repeat(31) + "01"
        private const val PUBKEY = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    }
}
