package app.bookstr

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import org.junit.rules.TestWatcher
import org.junit.runner.Description

class E2eScreenshotRule : TestWatcher() {
    override fun finished(description: Description) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(
            instrumentation.targetContext.getExternalFilesDir(null),
            "e2e-screenshots",
        ).apply { mkdirs() }
        val testName = "${description.className}-${description.methodName}"
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
        UiDevice.getInstance(instrumentation).takeScreenshot(File(directory, "$testName.png"))
    }
}
