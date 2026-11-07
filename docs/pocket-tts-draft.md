# Pocket TTS Dutch: implementation handoff

> Android integration for issue #222, following the initial draft in #227. Pocket uses the published MediaPipe 1.2.2 runtime. Phone performance and comparative narration quality remain unmeasured.

## Artifact and rights

- Pin the Dutch companion bundle to [`pocket_tts_nl_int8.litertlm` at HF revision `03f949ec418ccd4d153008f7ef9c58c754cc0616`](https://huggingface.co/litert-community/pocket-tts/resolve/03f949ec418ccd4d153008f7ef9c58c754cc0616/pocket_tts_nl_int8.litertlm). The pinned repository tree reports 125,247,496 bytes (~120 MiB), with SHA-256 `e38af0d6b726c550548b0126c5563245d9ac563c6669b66af924a2b545b51387` (HF LFS object digest). It contains Dutch (`nl-NL`), with `daan` as default and `alba` also listed.
- Repository model card and bundle documentation declare [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Credit Kyutai for the original architecture, weights, and voice embeddings; credit LiteRT Community / MediaPipe for conversion and quantization. Preserve the license and attribution with any redistributed model artifact. Check the current model card and underlying voice assets before release.
- Keep the artifact URL and digest revision-pinned; do not silently replace them with `main`. Treat the ~120 MiB artifact as a user-initiated, resumable download if the product flow supports that.

## Android runtime

The downloaded bundle is stored as `daan.litertlm`, preserving the original
revision-pinned URL and checksum. Do not use the upstream
`pocket_tts_nl_int8.litertlm` filename locally: MediaPipe's companion discovery
can recursively reload that file for `nl-NL` and exhaust memory
([upstream issue #6395](https://github.com/google-ai-edge/mediapipe/issues/6395)).


- Android pins `com.google.mediapipe:tasks-audio:1.2.2`. The published AAR contains the `TextToSpeech`, `TextToSpeechOptions` and `AudioResult` APIs and native libraries for arm64-v8a, armeabi-v7a, x86 and x86_64. Bookstr loads the Dutch bundle with voice `daan` and locale `nl-NL`, using 24 kHz PCM.
- Settings → Text-to-speech → Dutch offers **Pocket TTS · Daan**. The existing staged download verifies exact bytes and SHA-256 before promotion; intact files can be reused on retry. An interrupted partial download restarts rather than resuming its byte range.
- The serial narration executor owns and closes the engine, switching it when the selected model changes. Bounded phrases feed the existing WAV queue, playback controls, and reading offsets. Cancellation discards an in-flight phrase after its synchronous native call returns; it does not interrupt that call mid-inference.
- Pocket does not need or initialize eSpeak pronunciation files. Existing Piper and Kokoro voices continue through sherpa-onnx.
- The model card documents Swift Package Manager dependency `https://github.com/google-ai-edge/mediapipe` and library `MediaPipeTasksAudio` for iOS. This is not evidence that the current Bookstr Swift package/project can consume it or that the bundle runs on the project's deployment target; verify package product/platform support and build separately before proposing a shared implementation.
- Emulator tests exercise model loading, PCM output and switching. They do not establish phone latency, battery use, peak memory, or listening quality. See the implementation PR for commands and observed results.

## Validation and remaining work

- The downloaded bundle SHA-256 matches the pinned descriptor above.
- ARM64 Android 12 emulator testing passed native synthesis for Pocket, Nathalie,
  RDH and the existing Dutch/Kokoro voices; Settings install/select/remove;
  download cancellation; and Pocket narration progress/section continuation.
- All eight targeted tests passed with both 3 GB and 2 GB emulator memory. The
  original upstream filename triggered kernel OOM kills in both configurations;
  the neutral local filename avoids that failure without changing the model bytes.
- Cancellation is phrase-granular. Byte-range download resume, explicit Alba
  selection, iOS integration, phone latency/battery measurements and comparative
  Dutch listening quality remain follow-up work.
- See the implementation PR for exact unit, build, coverage and emulator results,
  including checks not performed locally. Emulator results do not establish
  performance on physical phones.

## Audition alternative: Supertonic 3

Supertonic 3 is another candidate for a Dutch voice audition. The [official model card](https://huggingface.co/Supertone/supertonic-3/raw/main/README.md) lists Dutch among 31 languages, links the source at [supertone-inc/supertonic](https://github.com/supertone-inc/supertonic), describes local ONNX Runtime inference. Issue #222 estimates approximately 398 MB for standard ONNX assets; verify the actual selected artifacts before budgeting storage. It states the project code is MIT licensed and model weights are OpenRAIL-M licensed. Treat those as model-card claims pending independent verification. No Bookstr integration or comparative quality/performance testing has been done.

For an audition, prepare matched Dutch passages that exercise ordinary prose, numbers/dates/currency, abbreviations, and quoted dialogue. Audition Pocket TTS and Supertonic 3 against existing Kokoro quality expectations, without implying Kokoro has a Dutch voice. Use matched Dutch text for the Dutch candidates, then listen for pronunciation, omissions/repetitions, pacing, and intelligibility. Also validate pause/resume behavior and the mapping of generated audio back to reader offsets; record samples and device/runtime conditions before drawing conclusions.

## Sources

- [Pinned Pocket TTS model card](https://huggingface.co/litert-community/pocket-tts/blob/03f949ec418ccd4d153008f7ef9c58c754cc0616/README.md)
- [Pocket TTS Hugging Face repository](https://huggingface.co/litert-community/pocket-tts)
- [MediaPipe Text-to-Speech Android guide](https://ai.google.dev/edge/mediapipe/solutions/audio/text_to_speech/android) and [iOS guide](https://ai.google.dev/edge/mediapipe/solutions/audio/text_to_speech/ios)
- [Official MediaPipe Android sample](https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/text_to_speech/android) and [iOS sample](https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/text_to_speech/ios)
- [Supertonic 3 official model card](https://huggingface.co/Supertone/supertonic-3/raw/main/README.md) and [linked source repository](https://github.com/supertone-inc/supertonic)
