package app.bookstr.nostr

import android.app.Activity
import android.app.Application
import android.content.Intent
import androidx.activity.ComponentActivity
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28])
class SignerSessionTest {
    @Test fun sequentialApprovalsReturnToSameSessionAndCancellationDoesNotConsumeNextRequest() = runBlocking<Unit> {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get()
        val session = AmberIntentSession(activity)
        controller.start().resume(); session.attach()
        fun answer(data: Intent, code: Int = Activity.RESULT_OK) {
            val request = shadowOf(activity).nextStartedActivityForResult
            assertNotNull(request)
            activity.activityResultRegistry.dispatchResult(request.requestCode, code, data)
        }
        try {
            assertSame(session, AmberIntentSession.Host.awaitSession())
            val key = async(start = CoroutineStart.UNDISPATCHED) { session.getPublicKey() }
            answer(Intent().putExtra("result", "a".repeat(64)).putExtra("package", "app.huddle"))
            assertEquals("app.huddle", key.await().second)
            val signing = async(start = CoroutineStart.UNDISPATCHED) { session.signEvent("{\"id\":\"id\"}", "a", "app.huddle") }
            answer(Intent().putExtra("result", "b".repeat(128)))
            assertEquals("id", signing.await().getString("id"))
            val encrypt = async(start = CoroutineStart.UNDISPATCHED) { session.encryptNip44("plain", "b", "a", "app.huddle") }
            answer(Intent().putExtra("result", "cipher")); assertEquals("cipher", encrypt.await())
            val decrypt = async(start = CoroutineStart.UNDISPATCHED) { session.decryptNip44("cipher", "b", "a", "app.huddle") }
            answer(Intent().putExtra("result", "plain")); assertEquals("plain", decrypt.await())
            val cancelled = async(start = CoroutineStart.UNDISPATCHED) { session.getPublicKey() }
            cancelled.cancel()
            answer(Intent().putExtra("result", "bad"))
            val next = async(start = CoroutineStart.UNDISPATCHED) { session.getPublicKey() }
            answer(Intent().putExtra("result", "b".repeat(64)).putExtra("package", "app.huddle"))
            assertEquals("b".repeat(64), next.await().first)
            session.detach(); assertNull(AmberIntentSession.Host.session)
        } finally { controller.pause().stop().destroy(); AmberIntentSession.Host.session = null }
    }
    @Test fun rejectedAndInterruptedRequestsFailWithoutKeepingActivityAlive() = runBlocking<Unit> {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get(); val session = AmberIntentSession(activity)
        controller.start().resume(); session.attach()
        supervisorScope {
            val pending = async(start = CoroutineStart.UNDISPATCHED) { session.encryptNip44("plain", "b", "a", "app.huddle") }
            val request = shadowOf(activity).nextStartedActivityForResult
            activity.activityResultRegistry.dispatchResult(request.requestCode, Activity.RESULT_OK, Intent().putExtra("rejected", true))
            try { pending.await(); fail("rejected") } catch (_: Nip55Exception) { }
            val destroyed = async(start = CoroutineStart.UNDISPATCHED) { session.decryptNip44("cipher", "b", "a", "app.huddle") }
            controller.pause().stop().destroy()
            withTimeout(5000) { destroyed.join() }
            assertTrue(destroyed.isCancelled); assertNull(AmberIntentSession.Host.session)
        }
    }
}
