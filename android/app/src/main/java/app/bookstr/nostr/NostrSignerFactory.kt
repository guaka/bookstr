package app.bookstr.nostr

import android.content.Context
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository

object NostrSignerFactory {
    fun create(context: Context, settings: SettingsRepository): NostrSigner? =
        when (settings.authMode) {
            NostrAuthMode.None -> null
            NostrAuthMode.Nsec ->
                if (settings.nsec.isNullOrBlank()) null else LocalNsecSigner(settings)
            NostrAuthMode.Amber ->
                if (settings.pubkeyHex.isNullOrBlank() || settings.signerPackage.isNullOrBlank()) {
                    null
                } else {
                    ExternalSigner(context.applicationContext, settings)
                }
        }
}
