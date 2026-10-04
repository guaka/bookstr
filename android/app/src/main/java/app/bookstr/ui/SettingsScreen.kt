package app.bookstr.ui

import android.graphics.Typeface
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.bookstr.BuildConfig
import app.bookstr.R
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.ReaderAlignment
import app.bookstr.data.ReaderFont
import app.bookstr.data.ReaderTheme
import app.bookstr.data.DictionaryPack

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    authMode: NostrAuthMode,
    signerLabel: String = "External signer",
    npubDisplay: String,
    amberAvailable: Boolean,
    nsec: String,
    showNsec: Boolean,
    relays: String,
    theme: ReaderTheme,
    readerFont: ReaderFont,
    readerAlignment: ReaderAlignment,
    keepOnLockScreen: Boolean,
    syncing: Boolean,
    connectingAmber: Boolean,
    syncMessage: String?,
    dictionaryPacks: List<DictionaryPack>,
    dictionaryPackBusy: String?,
    dictionaryPackProgress: Float?,
    dictionaryMessage: String?,
    initialDictionarySource: String,
    initialDictionaryTarget: String,
    onDictionaryPairChange: (String, String) -> Unit,
    onConnectAmber: () -> Unit,
    onDisconnectNostr: () -> Unit,
    onShowNsecChange: (Boolean) -> Unit,
    onNsecChange: (String) -> Unit,
    onRelaysChange: (String) -> Unit,
    onThemeChange: (ReaderTheme) -> Unit,
    onReaderFontChange: (ReaderFont) -> Unit,
    onReaderAlignmentChange: (ReaderAlignment) -> Unit,
    onKeepOnLockScreenChange: (Boolean) -> Unit,
    onInstallDictionaryPack: (DictionaryPack) -> Unit,
    onRemoveDictionaryPack: (DictionaryPack) -> Unit,
    onSyncNow: () -> Unit,
) {
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    var pendingDictionaryDelete by remember { mutableStateOf<DictionaryPack?>(null) }
    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .wrapContentWidth(Alignment.CenterHorizontally)
                .widthIn(max = 1100.dp)
                .fillMaxWidth()
                .padding(start = 20.dp, top = 12.dp, end = 20.dp, bottom = 20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(
                modifier = Modifier.fillMaxWidth().height(40.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("Settings", style = MaterialTheme.typography.headlineSmall)
            }
            ReaderAppearanceSection(
                theme = theme,
                readerFont = readerFont,
                readerAlignment = readerAlignment,
                onThemeChange = onThemeChange,
                onReaderFontChange = onReaderFontChange,
                onReaderAlignmentChange = onReaderAlignmentChange,
            )

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                shape = RoundedCornerShape(20.dp),
            ) {
              Column(modifier = Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SettingsSectionTitle("Reading")
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Keep screen awake while reading")
                    Switch(
                        checked = keepOnLockScreen,
                        onCheckedChange = onKeepOnLockScreenChange,
                    )
                }
                Text(
                    "Keeps the display on for EPUB, PDF, FB2, and comics. Your last book and position remain saved.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
              }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                shape = RoundedCornerShape(20.dp),
            ) {
                Column(modifier = Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SpeechSettingsSection()
                }
            }

            SettingsCard {
              SettingsSectionTitle("Nostr sync")

              when (authMode) {
                NostrAuthMode.Amber -> {
                    Text("Connected via $signerLabel (NIP-55)")
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
                            modifier = Modifier.fillMaxWidth().testTag("signer.connect"),
                        ) {
                            Text(if (connectingAmber) "Connecting…" else "Connect signer")
                        }
                        Text("Keeps your key in your signer.")
                    } else {
                        Text("Install Huddle or another NIP-55 signer to connect.")
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
            }

            SettingsCard {
             Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SettingsSectionTitle("Offline dictionaries")
                Text(
                    "Download WikDict translation pairs or Kaikki monolingual definitions. " +
                        "Downloaded packs are used first; online Wiktionary remains the fallback.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
                val languages = remember(dictionaryPacks) {
                    dictionaryPacks.flatMap { pack ->
                        listOf(
                            pack.sourceLanguage to pack.label.substringBefore(" → "),
                            pack.targetLanguage to pack.label.substringAfter(" → "),
                        )
                    }.distinctBy { it.first }.sortedBy { it.second }
                }
                var source by remember(initialDictionarySource) { mutableStateOf(initialDictionarySource) }
                var target by remember(initialDictionaryTarget) { mutableStateOf(initialDictionaryTarget) }
                var sourceMenu by remember { mutableStateOf(false) }
                var targetMenu by remember { mutableStateOf(false) }
                val selectedPack = dictionaryPacks.firstOrNull {
                    it.sourceLanguage == source && it.targetLanguage == target
                }
                val availablePacks = dictionaryPacks.filterNot(DictionaryPack::installed)
                LaunchedEffect(dictionaryPacks, source, target) {
                    if (selectedPack?.installed != false) {
                        (availablePacks.firstOrNull { it.sourceLanguage == source }
                            ?: availablePacks.firstOrNull())?.let { next ->
                            source = next.sourceLanguage
                            target = next.targetLanguage
                            onDictionaryPairChange(source, target)
                        }
                    }
                }
                val installed = dictionaryPacks
                    .filter(DictionaryPack::installed)
                    .sortedBy { it.label.lowercase() }
                if (installed.isEmpty()) {
                    Text(
                        "Downloaded dictionaries: none",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                } else {
                    Text("Downloaded dictionaries (${installed.size})")
                    installed.forEach { pack ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(pack.label, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    formatPackSize(pack.bytes) + " · ready offline",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            IconButton(
                                onClick = { pendingDictionaryDelete = pack },
                                enabled = dictionaryPackBusy == null,
                            ) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = "Delete ${pack.label}",
                                )
                            }
                        }
                    }
                }
                Text("Download another language pair", style = MaterialTheme.typography.labelMedium)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(modifier = Modifier.weight(1f)) {
                        OutlinedButton(onClick = { sourceMenu = true }, modifier = Modifier.fillMaxWidth()) {
                            Text(languages.firstOrNull { it.first == source }?.second ?: source)
                        }
                        DropdownMenu(expanded = sourceMenu, onDismissRequest = { sourceMenu = false }) {
                            val availableSources = availablePacks.map(DictionaryPack::sourceLanguage).toSet()
                            languages.filter { it.first in availableSources }.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.second) },
                                    onClick = {
                                        source = option.first
                                        availablePacks.firstOrNull {
                                            it.sourceLanguage == option.first
                                        }?.let { target = it.targetLanguage }
                                        onDictionaryPairChange(source, target)
                                        sourceMenu = false
                                    },
                                )
                            }
                        }
                    }
                    Text("→", modifier = Modifier.align(Alignment.CenterVertically))
                    Box(modifier = Modifier.weight(1f)) {
                        OutlinedButton(onClick = { targetMenu = true }, modifier = Modifier.fillMaxWidth()) {
                            Text(languages.firstOrNull { it.first == target }?.second ?: target)
                        }
                        DropdownMenu(expanded = targetMenu, onDismissRequest = { targetMenu = false }) {
                            val availableTargets = availablePacks
                                .filter { it.sourceLanguage == source }
                                .map(DictionaryPack::targetLanguage)
                                .toSet()
                            languages.filter { it.first in availableTargets }.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.second) },
                                    onClick = {
                                        target = option.first
                                        onDictionaryPairChange(source, target)
                                        targetMenu = false
                                    },
                                )
                            }
                        }
                    }
                }
                selectedPack?.let { pack ->
                    Text(
                        when {
                            pack.installed -> "Downloaded · ${formatPackSize(pack.bytes)} · ready offline"
                            dictionaryPackBusy == pack.id && dictionaryPackProgress != null ->
                                "Downloading · ${(dictionaryPackProgress * 100).toInt()}%"
                            dictionaryPackBusy == pack.id -> "Preparing offline dictionary…"
                            else -> "Not downloaded · online fallback only"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (pack.installed) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.secondary,
                    )
                    if (dictionaryPackBusy == pack.id) {
                        if (dictionaryPackProgress == null) {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        } else {
                            LinearProgressIndicator(
                                progress = { dictionaryPackProgress },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                    if (!pack.installed) {
                        OutlinedButton(
                            onClick = { onInstallDictionaryPack(pack) },
                            enabled = dictionaryPackBusy == null,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (dictionaryPackBusy == pack.id) "Downloading…" else "Download ${pack.label}") }
                    }
                }
                dictionaryMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
             }
            }

            SettingsCard {
            Button(
                onClick = onSyncNow,
                enabled = !syncing && authMode != NostrAuthMode.None,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (syncing) "Syncing Nostr data…" else "Sync Nostr data now")
            }

            Text(
                "Fetches favorites, reading positions, and saved words from your relays, " +
                    "then publishes pending saved-word updates.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )

            if (syncMessage != null) {
                Text(syncMessage)
            }
            }

            SettingsCard {
            SettingsSectionTitle("Relays")
            OutlinedTextField(
                value = relays,
                onValueChange = onRelaysChange,
                label = { Text("Relays (one per line)") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 5,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(
                    onDone = {
                        focusManager.clearFocus(force = true)
                        keyboardController?.hide()
                    },
                ),
            )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 24.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "v${BuildConfig.VERSION_NAME} · Build ${BuildConfig.BUILD_DATE}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
                androidx.compose.material3.IconButton(
                    onClick = {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/guaka/bookstr")),
                        )
                    },
                ) {
                    androidx.compose.material3.Icon(
                        painter = painterResource(R.drawable.ic_github),
                        contentDescription = "Open Bookstr on GitHub",
                    )
                }
            }
        }
    }
    pendingDictionaryDelete?.let { pack ->
        AlertDialog(
            onDismissRequest = { pendingDictionaryDelete = null },
            title = { Text("Delete dictionary?") },
            text = {
                Text(
                    "Delete ${pack.label} (${formatPackSize(pack.bytes)})? " +
                        "Online lookup will remain available.",
                )
            },
            dismissButton = {
                TextButton(onClick = { pendingDictionaryDelete = null }) { Text("Cancel") }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingDictionaryDelete = null
                        onRemoveDictionaryPack(pack)
                    },
                ) { Text("Delete") }
            },
        )
    }
}

internal fun readerFontPreviewFamily(font: ReaderFont): FontFamily =
    FontFamily(Typeface.create(font.previewTypefaceName, Typeface.NORMAL))

private val ReaderFont.previewTypefaceName: String
    get() = when (this) {
        ReaderFont.Arial -> "Arial"
        ReaderFont.Georgia -> "Georgia"
        ReaderFont.Palatino -> "Palatino"
        ReaderFont.System -> "sans-serif"
        ReaderFont.Roboto -> "Roboto"
        ReaderFont.NotoSerif -> "Noto Serif"
    }

private fun formatPackSize(bytes: Long): String = "%.1f MB".format(bytes / 1_048_576.0)

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ReaderAppearanceSection(
    theme: ReaderTheme,
    readerFont: ReaderFont,
    readerAlignment: ReaderAlignment,
    onThemeChange: (ReaderTheme) -> Unit,
    onReaderFontChange: (ReaderFont) -> Unit,
    onReaderAlignmentChange: (ReaderAlignment) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SettingsSectionTitle("Appearance")
                Text(
                    "Choose a page style and preview your reading typography.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Page", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ReaderTheme.entries.forEach { option ->
                        FilterChip(
                            selected = theme == option,
                            onClick = { onThemeChange(option) },
                            label = { Text(option.key.replaceFirstChar { it.uppercase() }) },
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Font", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ReaderFont.entries.forEach { option ->
                        FilterChip(
                            selected = readerFont == option,
                            onClick = { onReaderFontChange(option) },
                            label = { Text(option.label, fontFamily = readerFontPreviewFamily(option)) },
                        )
                    }
                }
                Text(
                    "The quick brown fox jumps over the lazy dog.\nA comfortable page starts with type that feels right.",
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(14.dp))
                        .padding(16.dp)
                        .testTag("settings.font-preview"),
                    style = MaterialTheme.typography.bodyLarge,
                    fontFamily = readerFontPreviewFamily(readerFont),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Paragraph alignment", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ReaderAlignment.entries.forEach { option ->
                        val selected = readerAlignment == option
                        Card(
                            onClick = { onReaderAlignmentChange(option) },
                            modifier = Modifier.weight(1f).testTag("settings.alignment-${option.key}"),
                            colors = CardDefaults.cardColors(
                                containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer
                                else MaterialTheme.colorScheme.surface,
                            ),
                            border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary)
                            else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Column(
                                modifier = Modifier.fillMaxWidth().padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(option.label, style = MaterialTheme.typography.labelLarge)
                                Text(
                                    "Words find their rhythm on the page, making every chapter a little easier to settle into. A thoughtful line length and steady spacing help the reader follow each sentence, whether the edges align neatly or remain naturally uneven.",
                                    modifier = Modifier.testTag("settings.alignment-preview-${option.key}"),
                                    style = MaterialTheme.typography.bodySmall,
                                    textAlign = if (option == ReaderAlignment.Justified) TextAlign.Justify else TextAlign.Start,
                                    maxLines = 3,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            content()
        }
    }
}

@Composable
private fun SettingsSectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onSurface,
    )
}
