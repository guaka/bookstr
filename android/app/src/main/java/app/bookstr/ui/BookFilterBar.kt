package app.bookstr.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.util.Locale

internal fun languageDisplayName(value: String): String {
    val language = value.trim().replace('_', '-')
    if (language.equals("UND", ignoreCase = true)) return "Undefined"
    if (language.isEmpty()) return value

    val code = language.substringBefore('-')
    val normalized = if (code.length == 3) {
        Locale.getISOLanguages().firstOrNull { candidate ->
            runCatching { Locale(candidate).isO3Language.equals(code, ignoreCase = true) }.getOrDefault(false)
        }?.let { it + language.removePrefix(code) } ?: language
    } else language
    val locale = Locale.forLanguageTag(normalized)
    val display = locale.getDisplayLanguage(Locale.ENGLISH)
    return if (display.isNotBlank() && !display.equals(language, ignoreCase = true)) display else language
}

@Composable
fun BookFilterBar(prefix: String, languages: List<String>, formats: List<String>,
                  language: String, format: String, onLanguage: (String) -> Unit, onFormat: (String) -> Unit,
                  modifier: Modifier = Modifier) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        FilterMenu("$prefix.language", "All languages", languages, language, ::languageDisplayName,
            Icons.Default.Language, onLanguage, Modifier.weight(1f))
        FilterMenu("$prefix.format", "All formats", formats, format,
            { it.uppercase(Locale.ROOT) }, Icons.Default.Description, onFormat, Modifier.weight(1f))
    }
}

@Composable
private fun FilterMenu(tag: String, all: String, options: List<String>, selection: String,
                       display: (String) -> String, icon: androidx.compose.ui.graphics.vector.ImageVector,
                       onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        TextButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth().testTag(tag)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(5.dp))
            Text(if (selection.isEmpty()) all else display(selection), maxLines = 1)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            (listOf("") + options).forEach { option ->
                DropdownMenuItem(
                    text = { Text(if (option.isEmpty()) all else display(option)) },
                    onClick = { onSelect(option); expanded = false },
                    modifier = Modifier.testTag("$tag.${option.ifEmpty { "all" }}"),
                )
            }
        }
    }
}
