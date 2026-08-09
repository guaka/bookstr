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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.bookstr.data.ReaderTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    catalogUrl: String,
    nsec: String,
    relays: String,
    theme: ReaderTheme,
    keepOnLockScreen: Boolean,
    syncing: Boolean,
    syncMessage: String?,
    onCatalogUrlChange: (String) -> Unit,
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

            OutlinedTextField(
                value = nsec,
                onValueChange = onNsecChange,
                label = { Text("nsec (private key)") },
                modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
            )

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
                enabled = !syncing,
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
