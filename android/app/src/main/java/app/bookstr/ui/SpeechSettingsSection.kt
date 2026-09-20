package app.bookstr.ui

import android.app.Application
import android.content.Context
import android.speech.tts.TextToSpeech
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.bookstr.BookstrApp
import app.bookstr.speech.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SpeechSettingsViewModel(application: Application, val models: SpeechModels) : AndroidViewModel(application) {
    constructor(application: Application) : this(application, SpeechModels(application))
    val settings = SpeechSettings(application.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
    var languages by mutableStateOf(SpeechLanguages.available(emptyList()))
    var selected by mutableStateOf("en")
    var voice by mutableStateOf(settings.voice(selected))
    var installed by mutableStateOf(models.models.filter(models::installed).map { it.id }.toSet())
    var busy by mutableStateOf<String?>(null)
    var progress by mutableStateOf(0f)
    var error by mutableStateOf<String?>(null)
    var systemVoices by mutableStateOf<List<Pair<String, String>>>(emptyList())
    private var tts: TextToSpeech? = null

    init {
        tts = TextToSpeech(application) { status ->
            if (status == TextToSpeech.SUCCESS) refreshVoices()
        }
        viewModelScope.launch {
            val codes = withContext(Dispatchers.IO) { (application as BookstrApp).catalogRepository.downloadedBooks(emptyList()).map { it.language.orEmpty() } }
            languages = SpeechLanguages.available(codes)
        }
    }
    fun selectLanguage(language: String) {
        selected = language
        voice = settings.voice(language)
        refreshVoices()
    }
    private fun refreshVoices() {
        systemVoices = tts?.voices.orEmpty().filter { SpeechLanguages.tag(it.locale.language).substringBefore('-') == selected.substringBefore('-') }
            .sortedWith(compareByDescending<android.speech.tts.Voice> { it.quality }.thenBy { it.name })
            .map { it.name to "${it.name}${if (it.isNetworkConnectionRequired) " · Online" else ""}" }
    }
    fun selectVoice(id: String) { settings.setVoice(selected, id); voice = id }
    fun install(model: SpeechModel) {
        if (busy != null) return
        busy = model.id; progress = 0f; error = null
        viewModelScope.launch {
            try {
                models.install(model) { value -> progress = value }
                installed = installed + model.id
                settings.setVoice(model.language, model.id)
                if (selected == model.language) voice = model.id
            } catch (cancelled: CancellationException) { throw cancelled
            } catch (failure: Exception) { error = failure.message
            } finally { busy = null }
        }
    }
    fun remove(model: SpeechModel) {
        if (busy != null) return
        try {
            models.remove(model); installed = installed - model.id
            if (settings.voice(model.language) == model.id) {
                settings.setVoice(model.language, "")
                if (selected == model.language) voice = ""
            }
            error = null
        } catch (failure: Exception) { error = failure.message }
    }
    override fun onCleared() { tts?.shutdown() }
}

@Composable
fun SpeechSettingsSection(model: SpeechSettingsViewModel = viewModel()) {
    SpeechSettingsControls(model.languages, model.selected, model.voice, model.models.models, model.installed,
        model.systemVoices, model.busy, model.progress, model.error,
        model::selectLanguage, model::selectVoice, model::install, model::remove)
}

@Composable
fun SpeechSettingsControls(
    languages: List<String>, language: String, voice: String, models: List<SpeechModel>, installed: Set<String>,
    systemVoices: List<Pair<String, String>>, busy: String?, progress: Float, error: String?,
    onLanguage: (String) -> Unit, onVoice: (String) -> Unit, onInstall: (SpeechModel) -> Unit, onRemove: (SpeechModel) -> Unit,
) {
    Text("Text-to-speech", style = MaterialTheme.typography.titleSmall)
    SpeechPicker("Language", "speech-language", language, languages.map { it to SpeechLanguages.name(it) }, onLanguage)
    val matching = models.filter { it.language == language }
    matching.forEach { model ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f).padding(vertical = 12.dp)) {
                Text(model.label)
                Text("${model.bytes / 1_000_000} MB", style = MaterialTheme.typography.bodySmall)
            }
            TextButton(
                enabled = busy == null,
                modifier = Modifier.testTag("speech-model-${model.id}"),
                onClick = { if (model.id in installed) onRemove(model) else onInstall(model) },
            ) { Text(if (model.id in installed) "Remove" else "Download") }
        }
        if (busy == model.id) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().testTag("speech-download-progress"))
    }
    val choices = listOf("" to "System default") + matching.filter { it.id in installed }.map { it.id to it.label } + systemVoices
    SpeechPicker("Voice", "speech-voice", voice, choices, onVoice)
    error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("speech-error")) }
}

@Composable
private fun SpeechPicker(label: String, tag: String, selected: String, choices: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth().testTag(tag)) {
            Text("$label: ${choices.firstOrNull { it.first == selected }?.second ?: "System default"}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            choices.forEach { (id, name) ->
                DropdownMenuItem(text = { Text(name) }, modifier = Modifier.testTag("$tag-option-$id"), onClick = { onSelect(id); expanded = false })
            }
        }
    }
}
