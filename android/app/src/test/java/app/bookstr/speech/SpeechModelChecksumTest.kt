package app.bookstr.speech

import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SpeechModelChecksumTest {
    @get:Rule val temporary = TemporaryFolder()

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    private fun model(server: MockWebServer, payload: ByteArray = "valid".toByteArray()) =
        SpeechModel(
            "pocket", "nl", "Pocket", "pocket/repo", "pin", "pocket", "voice.litertlm",
            listOf(SpeechModelFile("voice.litertlm", payload.size.toLong(), server.url("/voice").toString(), sha256(payload))),
        )

    @Test fun parsesOptionalSha256WhilePreservingLegacyMetadata() {
        val parsed = SpeechModels.parse(
            """[{"id":"with-hash","language":"nl","label":"Pocket","repository":"repo","revision":"pin","kind":"pocket","model":"voice","files":[{"path":"voice","bytes":5,"sha256":"abc123"}]},{"id":"legacy","language":"nl","label":"Legacy","repository":"repo","revision":"pin","kind":"pocket","model":"voice","files":[{"path":"voice","bytes":5}]}]""",
        )

        assertEquals("abc123", parsed[0].files.single().sha256)
        assertNull(parsed[1].files.single().sha256)
    }

    @Test fun validDigestDownloadIsInstalled() = runBlocking {
        MockWebServer().use { server ->
            val content = "valid".toByteArray()
            val model = model(server, content)
            server.enqueue(MockResponse().setBody(String(content)))
            val store = SpeechModels(temporary.newFolder(), listOf(model))

            store.install(model) {}

            assertTrue(store.installed(model))
            assertEquals(sha256(content), sha256(File(store.directory(model), "voice.litertlm").readBytes()))
            assertFalse(File(store.root, "pocket.partial").exists())
        }
    }

    @Test fun sameLengthWrongDigestIsRejectedAndPartialIsRemoved() = runBlocking {
        MockWebServer().use { server ->
            val expected = "valid".toByteArray()
            val wrong = "wrong".toByteArray()
            val model = model(server, expected)
            server.enqueue(MockResponse().setBody(String(wrong)))
            val store = SpeechModels(temporary.newFolder(), listOf(model))

            assertTrue(runCatching { store.install(model) {} }.isFailure)

            assertFalse(store.installed(model))
            assertFalse(File(store.root, "pocket.partial").exists())
        }
    }

    @Test fun corruptedSameLengthOldArtifactIsRedownloaded() = runBlocking {
        MockWebServer().use { server ->
            val content = "valid".toByteArray()
            val model = model(server, content)
            server.enqueue(MockResponse().setBody(String(content)))
            val store = SpeechModels(temporary.newFolder(), listOf(model))
            store.directory(model).mkdirs()
            File(store.directory(model), "voice.litertlm").writeBytes("wrong".toByteArray())

            store.install(model) {}

            assertEquals(1, server.requestCount)
            assertEquals(sha256(content), sha256(File(store.directory(model), "voice.litertlm").readBytes()))
        }
    }

    @Test fun validExistingArtifactIsReusedWithoutRequest() = runBlocking {
        MockWebServer().use { server ->
            val content = "valid".toByteArray()
            val model = model(server, content)
            val store = SpeechModels(temporary.newFolder(), listOf(model))
            store.directory(model).mkdirs()
            File(store.directory(model), "voice.litertlm").writeBytes(content)

            store.install(model) {}

            assertEquals(0, server.requestCount)
            assertTrue(store.installed(model))
        }
    }

    @Test fun checksumFailurePreservesPreviouslyInstalledData() = runBlocking {
        MockWebServer().use { server ->
            val expected = "valid".toByteArray()
            val model = model(server, expected)
            server.enqueue(MockResponse().setBody("wrong"))
            val store = SpeechModels(temporary.newFolder(), listOf(model))
            store.directory(model).mkdirs()
            val oldArtifact = File(store.directory(model), "voice.litertlm").apply { writeText("old!!") }
            val oldCompanion = File(store.directory(model), "metadata").apply { writeText("keep") }

            assertTrue(runCatching { store.install(model) {} }.isFailure)

            assertEquals("old!!", oldArtifact.readText())
            assertEquals("keep", oldCompanion.readText())
            assertFalse(File(store.root, "pocket.partial").exists())
        }
    }
}
