# Pocket TTS Dutch: implementation handoff

> Initial draft for issue #222: documents candidate artifacts, upstream runtime guidance, and validation work. It does not propose or claim a completed runtime integration.

## Artifact and rights

- Pin the Dutch companion bundle to [`pocket_tts_nl_int8.litertlm` at HF revision `03f949ec418ccd4d153008f7ef9c58c754cc0616`](https://huggingface.co/litert-community/pocket-tts/resolve/03f949ec418ccd4d153008f7ef9c58c754cc0616/pocket_tts_nl_int8.litertlm). The pinned repository tree reports 125,247,496 bytes (~120 MiB), with SHA-256 `e38af0d6b726c550548b0126c5563245d9ac563c6669b66af924a2b545b51387` (HF LFS object digest). It contains Dutch (`nl-NL`), with `daan` as default and `alba` also listed.
- Repository model card and bundle documentation declare [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Credit Kyutai for the original architecture, weights, and voice embeddings; credit LiteRT Community / MediaPipe for conversion and quantization. Preserve the license and attribution with any redistributed model artifact. Check the current model card and underlying voice assets before release.
- Keep the artifact URL and digest revision-pinned; do not silently replace them with `main`. Treat the ~120 MiB artifact as a user-initiated, resumable download if the product flow supports that.

## Runtime feasibility (unverified for Bookstr)

- The model card documents Android `com.google.mediapipe:tasks-audio` and specifies `minSdk = 26` plus `arm64-v8a`. Bookstr currently sets `minSdk = 27`, so the SDK floor is not a blocker by itself, but ABI coverage, dependency resolution, app packaging, native library size, and actual inference/build compatibility remain to be checked. The model-card snippet uses `latest.release`; choose and pin a concrete version before integrating.
- The model card documents Swift Package Manager dependency `https://github.com/google-ai-edge/mediapipe` and library `MediaPipeTasksAudio` for iOS. This is not evidence that the current Bookstr Swift package/project can consume it or that the bundle runs on the project's deployment target; verify package product/platform support and build separately before proposing a shared implementation.
- Treat the upstream README as integration guidance, not proof of Bookstr compatibility or performance. First compile a minimal loader on each platform, list the Dutch voices, synthesize a short Dutch sample, and validate PCM format, lifecycle/cancellation, memory, and error handling on supported hardware. No runtime integration or performance result is claimed here.

## Readiness checklist

- [ ] Confirm model licensing and attribution for all shipped files; retain a copy of the pinned model card/license metadata.
- [ ] Implement a staged, resumable downloader that verifies the pinned SHA-256 before atomically promoting the artifact; cover interruption/resume, mismatch, storage failure, and cleanup.
- [ ] Confirm Android ABI support on Bookstr's supported devices; pin MediaPipe version and compile/run a Dutch smoke test.
- [ ] Confirm iOS SPM product and deployment-target compatibility; compile/run an independent Dutch smoke test.
- [ ] Test the default `daan` voice and explicit `alba` selection with Dutch text; verify audio playback and reader cancellation.
- [ ] Measure download, cold-start, peak memory, synthesis speed, and battery on representative devices before making product/performance claims.
- [ ] Add platform unit/contract coverage, user-flow end-to-end coverage where controls/navigation change, and generated coverage reports before implementation is considered ready.

## Audition alternative: Supertonic 3

Supertonic 3 is another candidate for a Dutch voice audition. The [official model card](https://huggingface.co/Supertone/supertonic-3/raw/main/README.md) lists Dutch among 31 languages, links the source at [supertone-inc/supertonic](https://github.com/supertone-inc/supertonic), describes local ONNX Runtime inference. Issue #222 estimates approximately 398 MB for standard ONNX assets; verify the actual selected artifacts before budgeting storage. It states the project code is MIT licensed and model weights are OpenRAIL-M licensed. Treat those as model-card claims pending independent verification. No Bookstr integration or comparative quality/performance testing has been done.

For an audition, prepare matched Dutch passages that exercise ordinary prose, numbers/dates/currency, abbreviations, and quoted dialogue. Audition Pocket TTS and Supertonic 3 against existing Kokoro quality expectations, without implying Kokoro has a Dutch voice. Use matched Dutch text for the Dutch candidates, then listen for pronunciation, omissions/repetitions, pacing, and intelligibility. Also validate pause/resume behavior and the mapping of generated audio back to reader offsets; record samples and device/runtime conditions before drawing conclusions.

## Sources

- [Pinned Pocket TTS model card](https://huggingface.co/litert-community/pocket-tts/blob/03f949ec418ccd4d153008f7ef9c58c754cc0616/README.md)
- [Pocket TTS Hugging Face repository](https://huggingface.co/litert-community/pocket-tts)
- [MediaPipe Text-to-Speech Android guide](https://ai.google.dev/edge/mediapipe/solutions/audio/text_to_speech/android) and [iOS guide](https://ai.google.dev/edge/mediapipe/solutions/audio/text_to_speech/ios)
- [Official MediaPipe Android sample](https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/text_to_speech/android) and [iOS sample](https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/text_to_speech/ios)
- [Supertonic 3 official model card](https://huggingface.co/Supertone/supertonic-3/raw/main/README.md) and [linked source repository](https://github.com/supertone-inc/supertonic)
