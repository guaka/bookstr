package app.bookstr.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.util.ReflectionHelpers

/** Test-only storage substitute for Android Keystore-backed preferences in Robolectric. */
@Implements(value = MasterKey.Builder::class, isInAndroidSdk = false)
class ShadowMasterKeyBuilder {
    @Implementation
    fun build(): MasterKey = ReflectionHelpers.callConstructor(
        MasterKey::class.java,
        ReflectionHelpers.ClassParameter.from(String::class.java, "robolectric-master-key"),
        ReflectionHelpers.ClassParameter.from(Any::class.java, null),
    )
}

@Implements(value = EncryptedSharedPreferences::class, isInAndroidSdk = false)
class ShadowEncryptedSharedPreferences {
    companion object {
        @JvmStatic
        @Implementation
        fun create(
            context: Context,
            name: String,
            masterKey: MasterKey,
            keyScheme: EncryptedSharedPreferences.PrefKeyEncryptionScheme,
            valueScheme: EncryptedSharedPreferences.PrefValueEncryptionScheme,
        ): SharedPreferences = context.getSharedPreferences("robolectric_encrypted_$name", Context.MODE_PRIVATE)
    }
}
