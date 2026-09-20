package app.bookstr.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import java.util.Locale

@Composable
fun BookFilterBar(prefix: String, languages: List<String>, formats: List<String>,
                  language: String, format: String, onLanguage: (String) -> Unit, onFormat: (String) -> Unit) {
    Row {
        FilterMenu("$prefix.language", "All languages", languages, language, onLanguage)
        FilterMenu("$prefix.format", "All formats", formats, format, onFormat)
    }
}

@Composable
private fun FilterMenu(tag: String, all: String, options: List<String>, selection: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { expanded = true }, modifier = Modifier.testTag(tag)) {
            Text(if (selection.isEmpty()) all else selection.uppercase(Locale.ROOT))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            (listOf("") + options).forEach { option ->
                DropdownMenuItem(
                    text = { Text(if (option.isEmpty()) all else option.uppercase(Locale.ROOT)) },
                    onClick = { onSelect(option); expanded = false },
                    modifier = Modifier.testTag("$tag.${option.ifEmpty { "all" }}"),
                )
            }
        }
    }
}
