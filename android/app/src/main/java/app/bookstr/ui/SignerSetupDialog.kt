package app.bookstr.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.bookstr.nostr.NostrCrypto

internal enum class SignerSetupChoice { Generate, Import, Connect }

@Composable
internal fun SignerSetupDialog(
    preferredSignerLabel: String?,
    signerAvailable: Boolean,
    connecting: Boolean,
    connectionError: String?,
    onDismiss: () -> Unit,
    onSaveNsec: (String) -> Unit,
    onConnectSigner: () -> Unit,
) {
    var choice by remember { mutableStateOf(if (preferredSignerLabel != null) SignerSetupChoice.Connect else SignerSetupChoice.Generate) }
    var importedNsec by remember { mutableStateOf("") }
    var generatedNsec by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        modifier = Modifier.testTag("signer.setup"),
        onDismissRequest = onDismiss,
        title = { Text(if (generatedNsec == null) "Let's get you ready to search" else "Save your secret key") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (generatedNsec != null) {
                    Text("This key belongs to you. Save it somewhere safe before you continue. Anyone with it can use your account.")
                    SelectionContainer {
                        Text(generatedNsec!!, modifier = Modifier.testTag("signer.generated-key"))
                    }
                } else {
                    Text("Pick how you'd like to unlock the book search.")
                    SetupChoiceRow(SignerSetupChoice.Generate, choice, "Make a new key", "Start fresh with a secret key to keep safe.") {
                        choice = it; error = null
                    }
                    SetupChoiceRow(SignerSetupChoice.Import, choice, "Use my secret key", "Have a key starting with nsec1? Paste it here.") {
                        choice = it; error = null
                    }
                    SetupChoiceRow(
                        SignerSetupChoice.Connect, choice, "Connect a signer app",
                        preferredSignerLabel?.let { "$it is ready on this tablet." }
                            ?: "Use Amber or Huddle on this tablet (NIP-55).",
                    ) {
                        choice = it; error = null
                    }
                    if (choice == SignerSetupChoice.Import) {
                        OutlinedTextField(
                            value = importedNsec,
                            onValueChange = { importedNsec = it; error = null },
                            label = { Text("Your nsec") },
                            visualTransformation = PasswordVisualTransformation(),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth().testTag("signer.import-key"),
                        )
                    }
                    if (choice == SignerSetupChoice.Connect && !signerAvailable) {
                        Text("Install Amber, Huddle, or another NIP-55 signer app first, then come back.")
                    }
                    (error ?: connectionError)?.let { Text(it, modifier = Modifier.testTag("signer.setup-error")) }
                }
            }
        },
        confirmButton = {
            Button(
                modifier = Modifier.testTag("signer.setup-confirm"),
                enabled = !connecting && (generatedNsec != null || choice != SignerSetupChoice.Connect || signerAvailable),
                onClick = {
                    when {
                        generatedNsec != null -> onSaveNsec(generatedNsec!!)
                        choice == SignerSetupChoice.Generate -> generatedNsec = NostrCrypto.generateNsec()
                        choice == SignerSetupChoice.Import -> {
                            val value = importedNsec.trim()
                            error = try {
                                NostrCrypto.publicKeyHex(NostrCrypto.parsePrivateKey(value))
                                onSaveNsec(value)
                                null
                            } catch (_: Exception) {
                                "That key doesn't look right. Check it and try again."
                            }
                        }
                        else -> onConnectSigner()
                    }
                },
            ) {
                Text(when {
                    generatedNsec != null -> "I've saved my key"
                    choice == SignerSetupChoice.Generate -> "Make my key"
                    choice == SignerSetupChoice.Import -> "Use this key"
                    connecting -> "Connecting…"
                    else -> "Connect app"
                })
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Later") } },
    )
}

@Composable
private fun SetupChoiceRow(
    option: SignerSetupChoice,
    selected: SignerSetupChoice,
    title: String,
    description: String,
    onSelect: (SignerSetupChoice) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onSelect(option) }.testTag("signer.choice.${option.name.lowercase()}").padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = option == selected, onClick = { onSelect(option) }, modifier = Modifier.testTag("signer.radio.${option.name.lowercase()}"))
        Column {
            Text(title)
            Text(description)
        }
    }
}
