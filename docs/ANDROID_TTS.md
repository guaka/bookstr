# Android text-to-speech

Settings → Text-to-speech saves a voice independently for each language. The list
includes English, Portuguese (Portugal), French, German, Spanish, Catalan, Dutch,
Italian, and languages found in downloaded books. Installing a voice selects it
for that language. Removing the selected voice restores System default.

The downloadable voices include Kokoro English, Italian (Sara), Brazilian
Portuguese and European Portuguese (logus2k); Portuguese Tugão, Miro and Dii;
French, German and Spanish Miro; Catalan UPC Ona. Dutch adds
[Dii (Netherlands)](https://huggingface.co/csukuangfj/vits-piper-nl_NL-dii-high).
Device TTS voices remain selectable; network-dependent voices are marked Online.

Models run locally with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), pinned
to Android AAR 1.13.8. `android/app/src/main/assets/speech-models.json` pins model
repository revisions and expected file sizes. Each repository contains the
upstream model documentation and licensing information. Downloads stream into a
staging directory and become available only after every file passes validation.
All models carry the complete supported pronunciation data and share one stable
eSpeak directory, allowing language switches within a running app.
No speech text is sent to a server by the built-in neural voices.

Neural synthesis runs on a serial executor, using bounded phrases and disk-backed
PCM audio. It feeds the existing narration media session, including lock-screen
controls, progress, pause/resume, and requests to continue into the next section.

The European Portuguese Kokoro voice uses the logus2k fine-tuned acoustic model
and matching speaker table from the immutable
[ONNX conversion](https://github.com/buchwandler/kokoro-onnx-models/releases/tag/model-files-portuguese-eu-pt-v1.0-r3).
Bookstr uses its existing eSpeak European Portuguese text frontend. This differs
from the upstream Python TugaPhone frontend, so pronunciation and number
normalization can differ from upstream samples. Catalog files may specify an
explicit artifact URL when the model, speaker table and pronunciation data come
from different pinned sources.

Local verification:

- JVM tests: `android/gradlew -p android testDebugUnitTest`
- UI: `app.bookstr.ui.SpeechSettingsTest` and `SpeechSettingsActivityTest`
- Native voice generation: `app.bookstr.speech.NeuralSpeechTest`
- Playback integration: `app.bookstr.speech.NeuralNarrationServiceTest`

The native test downloads Dutch plus English, Italian and European Portuguese
Kokoro by default; pass instrumentation argument `speechModelIds` with
comma-separated catalog IDs to exercise more voices. Run on an emulator: the
activity test downloads and removes its Dutch
and Kokoro voice fixtures. GitHub Actions runs Android unit, build and emulator
checks for pull requests.
