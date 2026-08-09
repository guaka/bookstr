package app.bookstr.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.ReaderTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    catalogUrl: String,
    authMode: NostrAuthMode,
    npubDisplay: String,
    amberAvailable: Boolean,
    nsec: String,
    showNsec: Boolean,
    relays: String,
    theme: ReaderTheme,
    keepOnLockScreen: Boolean,
    syncing: Boolean,
    connectingAmber: Boolean,
    syncMessage: String?,
    onCatalogUrlChange: (String) -> Unit,
    onConnectAmber: () -> Unit,
    onDisconnectNostr: () -> Unit,
    onShowNsecChange: (Boolean) -> Unit,
    onNsecChange: (String) -> Unit,
    onRelaysChange: (String) -> Unit,
    onThemeChange: (ReaderTheme) -> Unit,
    onKeepOnLockScreenChange: (Boolean) -> Unit,
    onSyncNow: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Settings") })
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            OutlinedTextField(
                value = catalogUrl,
                onValueChange = onCatalogUrlChange,
                label = { Text("Catalog URL") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            Text("Nostr sync")

            when (authMode) {
                NostrAuthMode.Amber -> {
                    Text("Connected via Amber (NIP-55)")
                    if (npubDisplay.isNotEmpty()) {
                        Text(npubDisplay)
                    }
                    OutlinedButton(
                        onClick = onDisconnectNostr,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Disconnect")
                    }
                }
                NostrAuthMode.Nsec -> {
                    Text("Connected with local nsec")
                    if (npubDisplay.isNotEmpty()) {
                        Text(npubDisplay)
                    }
                    OutlinedButton(
                        onClick = onDisconnectNostr,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Disconnect")
                    }
                }
                NostrAuthMode.None -> {
                    if (amberAvailable) {
                        Button(
                            onClick = onConnectAmber,
                            enabled = !connectingAmber,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(if (connectingAmber) "Connecting…" else "Connect Amber")
                        }
                        Text("Keeps your key in Amber. Prefer this over pasting nsec.")
                    } else {
                        Text("Install Amber (or another NIP-55 signer) to connect without pasting a key.")
                    }
                }
            }

            if (authMode != NostrAuthMode.Amber) {
                if (!showNsec && authMode == NostrAuthMode.None) {
                    TextButton(onClick = { onShowNsecChange(true) }) {
                        Text("Use nsec instead (advanced)")
                    }
                }
                if (showNsec || authMode == NostrAuthMode.Nsec) {
                    OutlinedTextField(
                        value = nsec,
                        onValueChange = onNsecChange,
                        label = { Text("nsec (private key)") },
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                    )
                }
            }

            OutlinedTextField(
                value = relays,
                onValueChange = onRelaysChange,
                label = { Text("Relays (one per line)") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Theme: Paper")
                Switch(
                    checked = theme == ReaderTheme.Night,
                    onCheckedChange = { checked ->
                        onThemeChange(if (checked) ReaderTheme.Night else ReaderTheme.Paper)
                    },
                )
                Text("Night")
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Keep reading on lock screen")
                Switch(
                    checked = keepOnLockScreen,
                    onCheckedChange = onKeepOnLockScreenChange,
                )
            }

            Button(
                onClick = onSyncNow,
                enabled = !syncing && authMode != NostrAuthMode.None,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (syncing) "Syncing…" else "Sync now")
            }

            if (syncMessage != null) {
                Text(syncMessage)
            }
        }
    }
}
