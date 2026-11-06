package app.bookstr

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import androidx.test.runner.AndroidJUnitRunner
import java.util.concurrent.ConcurrentHashMap

class BookstrTestRunner : AndroidJUnitRunner() {
    override fun newActivity(cl: ClassLoader, className: String, intent: Intent): Activity {
        val activity = super.newActivity(cl, className, intent)
        activityConfigurations[className]?.let { configuration ->
            activity.applyOverrideConfiguration(Configuration(configuration))
        }
        return activity
    }

    companion object {
        private val activityConfigurations = ConcurrentHashMap<String, Configuration>()

        fun setActivityConfiguration(className: String, configuration: Configuration) {
            activityConfigurations[className] = Configuration(configuration)
        }

        fun clearActivityConfiguration(className: String) {
            activityConfigurations.remove(className)
        }
    }
}
