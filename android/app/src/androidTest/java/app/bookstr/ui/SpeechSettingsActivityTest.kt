package app.bookstr.ui

import android.content.Context
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.NarrationService
import app.bookstr.speech.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.After
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Rule
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain

class SpeechSettingsActivityTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<BookstrApp>()
    private val clean = object : ExternalResource() {
        override fun before() { app.settingsRepository.clearReaderSession(); app.settingsRepository.catalogConnection = null }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(clean).around(compose)
    private lateinit var fixtureModels: SpeechModels
    private val requests = AtomicInteger()

    @Before fun installDownloadFixture() {
        val root = File(app.cacheDir, "speech-settings-download-fixture").apply { deleteRecursively(); mkdirs() }
        val models = SpeechModels(app).models.map { model ->
            model.copy(repository = "fixture/${model.id}", revision = "fixture", files = listOf(SpeechModelFile("model", 4)))
        }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            check(chain.request().url.host == "fixture.invalid")
            requests.incrementAndGet()
            okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200).message("OK").body(okhttp3.ResponseBody.create(null, "test")).build()
        }.build()
        fixtureModels = SpeechModels(root, models, client, "https://fixture.invalid")
        compose.runOnUiThread {
            compose.activity.viewModelStore.put(
                "androidx.lifecycle.ViewModelProvider.DefaultKey:${SpeechSettingsViewModel::class.java.name}",
                SpeechSettingsViewModel(app, fixtureModels),
            )
        }
    }

    @After fun removeDownloadFixture() {
        fixtureModels.root.deleteRecursively()
    }

    private fun dutch() {
        compose.onNodeWithTag("speech-language").performScrollTo().performClick()
        compose.onNodeWithTag("speech-language-option-nl").performClick()
    }
    @Test fun italianKokoroDownloadPersistsThroughRecreationAndCanBeRemoved() =
        kokoroDownloadPersistsThroughRecreationAndCanBeRemoved("kokoro_it", "it", "Italiano")

    @Test fun portugalKokoroDownloadPersistsThroughRecreationAndCanBeRemoved() =
        kokoroDownloadPersistsThroughRecreationAndCanBeRemoved("kokoro_pt_pt", "pt-pt", "Portuguese")

    private fun kokoroDownloadPersistsThroughRecreationAndCanBeRemoved(id: String, language: String, alias: String) {
        val store = fixtureModels
        val model = store.models.single { it.id == id }
        store.remove(model)
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        settings.setVoice(language, "")
        compose.onNodeWithContentDescription("Settings").performClick()
        compose.onNodeWithTag("speech-language").performScrollTo().performClick()
        compose.onNodeWithTag("speech-language-option-$language").performScrollTo().performClick()
        compose.onNodeWithTag("speech-model-kokoro_en").assertDoesNotExist()
        compose.onNodeWithTag("speech-model-$id").performScrollTo().performClick()
        compose.waitUntil(10_000) { store.installed(model) && settings.voice(alias) == model.id }
        compose.onNodeWithTag("speech-voice").performScrollTo().assertTextContains(model.label, substring = true)
        assertEquals(1, requests.get())
        assertEquals("test", File(store.directory(model), "model").readText())
        compose.activityRule.scenario.recreate()
        compose.onNodeWithContentDescription("Settings").performClick()
        compose.onNodeWithTag("speech-language").performScrollTo().performClick()
        compose.onNodeWithTag("speech-language-option-$language").performScrollTo().performClick()
        compose.onNodeWithTag("speech-voice").performScrollTo().assertTextContains(model.label, substring = true)
        compose.onNodeWithTag("speech-model-$id").performScrollTo().performClick()
        compose.runOnIdle { assertFalse(store.installed(model)); assertEquals("", settings.voice(language)) }
    }

    @Test fun voiceDownloadPersistsThroughRecreationAndCanBeRemoved() {
        val store = fixtureModels
        val model = store.models.first { it.language == "nl" }
        store.remove(model)
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        settings.setVoice("nl", "")
        compose.onNodeWithContentDescription("Settings").performClick()
        dutch()
        compose.onNodeWithTag("speech-model-${model.id}").performScrollTo().performClick()
        compose.waitUntil(10_000) { store.installed(model) && settings.voice("Dutch") == model.id }
        compose.onNodeWithTag("speech-voice").performScrollTo().assertTextContains("Dii · Nederlands", substring = true)
        assertEquals(1, requests.get())
        assertEquals("test", File(store.directory(model), "model").readText())
        compose.activityRule.scenario.recreate()
        compose.onNodeWithContentDescription("Settings").performClick()
        dutch()
        compose.onNodeWithTag("speech-voice").performScrollTo().assertTextContains("Dii · Nederlands", substring = true)
        compose.onNodeWithTag("speech-model-${model.id}").performScrollTo().performClick()
        compose.runOnIdle { assertFalse(store.installed(model)); assertEquals("", settings.voice("nl")) }
    }
}
