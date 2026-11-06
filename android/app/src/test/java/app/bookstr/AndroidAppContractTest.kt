package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidAppContractTest {
    @Test fun screensaverIsDiscoverableAndProtectedByTheSystemDreamPermission() {
        val manifest = javax.xml.parsers.DocumentBuilderFactory.newInstance()
            .newDocumentBuilder().parse(File("src/main/AndroidManifest.xml"))
        val services = manifest.getElementsByTagName("service")
        val dream = (0 until services.length).map { services.item(it) as org.w3c.dom.Element }
            .single { it.getAttribute("android:name") == ".BookPagesDreamService" }
        assertEquals("true", dream.getAttribute("android:exported"))
        assertEquals("android.permission.BIND_DREAM_SERVICE", dream.getAttribute("android:permission"))
        val action = dream.getElementsByTagName("action").item(0) as org.w3c.dom.Element
        assertEquals("android.service.dreams.DreamService", action.getAttribute("android:name"))
        val metadata = dream.getElementsByTagName("meta-data").item(0) as org.w3c.dom.Element
        assertEquals("android.service.dream", metadata.getAttribute("android:name"))
        assertEquals("@xml/bookstr_dream", metadata.getAttribute("android:resource"))
        val descriptor = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/res/xml/bookstr_dream.xml")).documentElement
        assertEquals("dream", descriptor.tagName)
        assertEquals("@drawable/tv_banner", descriptor.getAttribute("android:previewImage"))
    }
    @Test fun televisionLauncherDoesNotExcludePhonesOrRequireTouch() {
        val manifest = javax.xml.parsers.DocumentBuilderFactory.newInstance()
            .newDocumentBuilder().parse(File("src/main/AndroidManifest.xml"))
        val features = manifest.getElementsByTagName("uses-feature")
        for (name in listOf("android.hardware.touchscreen", "android.software.leanback", "android.hardware.usb.host")) {
            val feature = (0 until features.length).map { features.item(it) as org.w3c.dom.Element }
                .single { it.getAttribute("android:name") == name }
            assertEquals("false", feature.getAttribute("android:required"))
        }
        val activity = (0 until manifest.getElementsByTagName("activity").length)
            .map { manifest.getElementsByTagName("activity").item(it) as org.w3c.dom.Element }
            .single { it.getAttribute("android:name") == ".MainActivity" }
        assertTrue(activity.textContent != null)
        val categories = activity.getElementsByTagName("category")
        assertTrue((0 until categories.length).any {
            (categories.item(it) as org.w3c.dom.Element).getAttribute("android:name") == "android.intent.category.LEANBACK_LAUNCHER"
        })
        val app = manifest.getElementsByTagName("application").item(0) as org.w3c.dom.Element
        assertEquals("@drawable/tv_banner", app.getAttribute("android:banner"))
        val banner = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/res/drawable/tv_banner.xml")).documentElement
        assertEquals("320", banner.getAttribute("android:viewportWidth"))
        assertEquals("180", banner.getAttribute("android:viewportHeight"))
    }

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
