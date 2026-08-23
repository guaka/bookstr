package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidAppContractTest {
    @Test
    fun appHasDiscoverableLauncherIdentity() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val strings = File("src/main/res/values/strings.xml").readText()

        assertTrue(manifest.contains("android:name=\".MainActivity\""))
        assertTrue(manifest.contains("android.intent.category.LAUNCHER"))
        assertTrue(manifest.contains("android:exported=\"true\""))
        assertTrue(manifest.contains("android:icon=\"@mipmap/ic_launcher\""))
        assertTrue(strings.contains("<string name=\"app_name\">bookstr</string>"))
    }

    @Test
    fun readerAndNarrationDeclareRequiredRuntimeCapabilities() {
        val manifest = File("src/main/AndroidManifest.xml").readText()

        assertTrue(manifest.contains("android.permission.INTERNET"))
        assertTrue(manifest.contains("android.permission.WAKE_LOCK"))
        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"))
        assertTrue(manifest.contains("android:showWhenLocked=\"true\""))
        assertTrue(manifest.contains("android:turnScreenOn=\"true\""))
    }

    @Test
    fun applicationIdAndNamespaceStayAligned() {
        val gradle = File("build.gradle.kts").readText()

        assertEquals(2, Regex("app\\.bookstr").findAll(gradle).count())
        assertTrue(gradle.contains("namespace = \"app.bookstr\""))
        assertTrue(gradle.contains("applicationId = \"app.bookstr\""))
    }
}
