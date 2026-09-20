package app.bookstr.ui

import androidx.lifecycle.ViewModelStore
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.bookstr.BookstrApp
import app.bookstr.speech.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class SpeechSettingsViewModelTest {
    private val app get() = ApplicationProvider.getApplicationContext<BookstrApp>()
    private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
    private fun await(block: () -> Boolean) {
        val until = System.currentTimeMillis() + 10000
        while (!block() && System.currentTimeMillis() < until) Thread.sleep(20)
        assertTrue(block())
    }
    private fun model(id: String = "fixture") = SpeechModel(id, "nl", "Dutch", "repo", "rev", "vits", "voice", listOf(SpeechModelFile("voice", 4)))

    @Test fun installsForOtherLanguagesGuardsBusyStateAndResetsOnlySelectedVoice() {
        val root = File(app.cacheDir, "speech-vm-test").apply { deleteRecursively(); mkdirs() }
        val model = model()
        val repository = SpeechModels(root, listOf(model))
        File(repository.directory(model).apply { mkdirs() }, "voice").writeText("test")
        lateinit var vm: SpeechSettingsViewModel
        val owner = ViewModelStore()
        try {
            main {
                vm = SpeechSettingsViewModel(app, repository); owner.put("speech", vm)
                vm.selectLanguage("en"); vm.selectVoice("system-test")
                vm.install(model); vm.install(model); vm.remove(model)
            }
            await { vm.busy == null }
            main {
                assertEquals("system-test", vm.voice); assertEquals(model.id, vm.settings.voice("nl"))
                vm.selectLanguage("nl"); assertEquals(model.id, vm.voice)
                vm.remove(model); assertEquals("", vm.voice)
                vm.selectVoice("another-voice"); vm.remove(model)
                assertEquals("another-voice", vm.voice)
                vm.settings.setVoice("en", "")
            }
        } finally { main { owner.clear() }; root.deleteRecursively() }
    }
    @Test fun clearingDuringAnActiveDownloadCancelsWithoutInstallingOrShowingAnError() {
        val root = File(app.cacheDir, "speech-vm-cancel").apply { deleteRecursively(); mkdirs() }
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val client = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            entered.countDown(); release.await(10, java.util.concurrent.TimeUnit.SECONDS)
            okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200).message("OK").body(okhttp3.ResponseBody.create(null, "test")).build()
        }.build()
        val model = model("cancel")
        val repository = SpeechModels(root, listOf(model), client)
        lateinit var vm: SpeechSettingsViewModel
        val owner = ViewModelStore()
        try {
            main { vm = SpeechSettingsViewModel(app, repository); owner.put("speech", vm); vm.install(model) }
            assertTrue(entered.await(10, java.util.concurrent.TimeUnit.SECONDS))
            main { owner.clear() }
            release.countDown()
            await { vm.busy == null }
            assertNull(vm.error); assertFalse(repository.installed(model))
            assertFalse(File(root, "cancel.partial").exists())
        } finally { release.countDown(); main { owner.clear() }; root.deleteRecursively() }
    }
    @Test fun reportsDownloadAndRemovalFailuresAndCancelsWhenCleared() {
        val root = File(app.cacheDir, "speech-vm-fail").apply { deleteRecursively(); writeText("not a directory") }
        val model = model("failure")
        val repository = SpeechModels(root, listOf(model))
        lateinit var vm: SpeechSettingsViewModel
        val owner = ViewModelStore()
        try {
            main { vm = SpeechSettingsViewModel(app, repository); owner.put("speech", vm); vm.install(model) }
            await { vm.busy == null }
            assertNotNull(vm.error)
            root.delete(); root.mkdirs()
            val folder = repository.directory(model).apply { mkdirs() }
            File(folder, "voice").writeText("test")
            folder.setWritable(false, false)
            main { vm.remove(model) }
            assertNotNull(vm.error)
            folder.setWritable(true, true)
            main { vm.install(model); owner.clear() }
            await { vm.busy == null }
        } finally { root.setWritable(true, true); repository.directory(model).setWritable(true, true); main { owner.clear() }; root.deleteRecursively() }
    }
}
