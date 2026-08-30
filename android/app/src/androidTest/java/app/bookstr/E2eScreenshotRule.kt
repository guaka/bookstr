package app.bookstr

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.rules.TestWatcher
import org.junit.runner.Description

class E2eScreenshotRule : TestWatcher() {
    override fun finished(description: Description) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val testName = "${description.className}-${description.methodName}"
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
        val device = UiDevice.getInstance(instrumentation)
        device.executeShellCommand("mkdir -p /sdcard/e2e-screenshots")
        device.executeShellCommand("screencap -p /sdcard/e2e-screenshots/$testName.png")
    }
}
