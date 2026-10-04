# Text-to-Speech Direction

## Locale-aware speech text

Mobile TTS preprocessing runs after the original text and its reading offsets
have been established. Android uses ICU4J's sentence BreakIterator and
RuleBasedNumberFormat; iOS uses Foundation sentence enumeration and
NumberFormatter spell-out, backed by the system's ICU data. The selected voice
locale is passed through as a BCP 47 tag (en, nl, pt-PT, or pt-BR).
Only speech input is normalized or spelled out. Displayed book text and chunk
offsets continue to use the original text. Existing footnote removal and
pronunciation overrides remain in their current pipeline.

Android's offline neural player renders one phrase ahead. It keeps the first
phrase of each sentence to at most 70 characters so a long new sentence can
start sooner after a short one; later phrases can use 140 characters. This
changes only synthesis units, not displayed text or saved reading positions.

For English speech input, Dr., Mr., Mrs., e.g., and U.S. expand to their
spoken forms (doctor, mister, missus, for example, and United States). This
avoids spelling punctuation or introducing sentence breaks. ICU sentence
boundaries are used when processing numbers; punctuation and genuine sentence
endings are preserved. ICU/Foundation do not provide a
reliable semantic date parser or a complete editorial abbreviation lexicon.
Dates such as 9/10/2024 are therefore spelled as numeric components, and
ambiguous numeric dates keep the source order; meaning is not inferred.
Other abbreviations, initials, and edition-specific forms may still be
pronounced according to the installed voice. Spell-out wording depends on the
OS ICU/locale data and may differ by OS release or by TTS voice.

## iOS Dutch voice

In Settings → Text-to-speech, choose Dutch and download **Dii · Nederlands**.
The Piper high-quality model runs offline after download (about 64 MB).
Dutch metadata aliases (`nl`, `nld`, `dut`, `Dutch`, and `Nederlands`) all use
this language preference, including Netherlands and Belgian region tags.

Model: [csukuangfj/vits-piper-nl_NL-dii-high](https://huggingface.co/csukuangfj/vits-piper-nl_NL-dii-high),
pinned at `12169a38e0f40f3ffc429273346f6d0700387cdf`.
The model author licenses it under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Models download directly from the upstream repository.

Pronunciation files share a stable directory across neural voices because
eSpeak retains its first directory for the process lifetime. Older model
installations may need to be downloaded again to include the full language set.

## Goal

Make Bookstr's reading voice sound genuinely natural in European Portuguese,
while keeping the text preparation shared across iOS and Android.

The quality of the final experience comes from:

1. A good `pt-PT` voice.
2. A shared readability preprocessor.
3. Clean sentence chunking and adaptive pauses.
4. Pronunciation handling for names, abbreviations, and unusual terms.
5. Provider-specific rendering controls, used sparingly.

Prosody is a finishing layer. It can improve emphasis, pace, pauses, and
pronunciation, but it cannot make a weak voice sound human.

## Shared architecture

Do not make iOS and Android decide independently how a book should be spoken.
The shared preprocessor should produce a provider-neutral speech plan:

```text
SpeechPlan
  locale: pt-PT
  units:
    - spokenText
      sentenceBoundary
      paragraphBoundary
      pause: none | short | medium | long
      emphasis: none | light
      pronunciationOverrides
```

Each TTS adapter renders this plan for its provider:

- Azure and Amazon Polly: SSML, pronunciation lexicons, and breaks.
- OpenAI: clean text plus restrained natural-language delivery instructions.
- ElevenLabs: clean text, a Portugal-native voice, and limited voice settings.
- iOS and Android: local system-TTS fallback.

This keeps the reading behavior DRY across platforms and lets us change cloud
provider without rewriting the readability work.

## Implemented shared speech plan

EPUB narration on Android and iOS, plus EPUB and PDF narration in Electron,
uses the dependency-free `web/reader-speech.js` planner. `BookstrSpeech.buildPlan`
normalizes semantic paragraphs into one text string and returns ordered chunks
with exact `start` offsets and a `pauseMs` delay before each chunk.

- The default soft target is 180 characters, the hard ceiling is 240, and a
  request is capped at 100,000 characters.
- Sentences remain intact up to the hard ceiling. Longer material prefers
  sentence, clause, and whole-word boundaries; only a single overlong token is
  hard-split.
- A final one-word tail is merged or rebalanced with the preceding chunk, so
  narration does not strand the last word of a normal sentence.
- Continuations use a 35 ms delay, sentence boundaries 180 ms, clauses and
  ellipses 250–320 ms, and the first chunk of a new paragraph 400 ms.
- EPUB block elements define paragraphs. PDF pages define paragraphs because
  PDF text extraction does not provide dependable semantic paragraph markup.

Electron exposes read-aloud controls only inside the desktop bridge and only
when Chromium reports system speech support. It uses operating-system voices,
maps generic Portuguese to `pt-PT`, speaks one planned chunk at a time, and
cancels speech and pending timers when narration stops, navigation changes, a
new book opens, or the reader closes. The ordinary browser UI remains unchanged.

## European Portuguese comparison

Legend: green = strong fit, yellow = viable but audition carefully, red = not
a suitable primary `pt-PT` option.

| Provider | Naturalness | `pt-PT` support | Control | Recommendation |
|---|---|---|---|---|
| ElevenLabs | Green | Green. Portugal is supported, but accent follows the selected or cloned voice. | Green. Stability, style, similarity, speed. | Premium candidate. Audition Portugal-native voices first. |
| Azure Speech | Green | Green. Dedicated `pt-PT` voices. | Green. SSML, pauses, phonemes, lexicons, styles. | Best quality/control/value default. |
| Amazon Polly | Yellow | Yellow. `pt-PT` voices exist, but high-end engines are less compelling for this locale. | Yellow. SSML, pauses, phonemes, substitutions, rate and pitch. | Cheap fallback; audition before choosing as primary. |
| OpenAI `gpt-4o-mini-tts` | Green | Yellow. Portuguese works, but a dedicated `pt-PT` locale/voice selector is not confirmed in the API docs. | Green. Delivery instructions, speed, streaming. | Worth a native-speaker listening test. |
| Deepgram Aura-2 | Yellow | Red. The current TTS catalog covers seven languages, but not Portuguese. | Yellow. Streaming, speed, and interruption controls; no SSML or pronunciation controls documented. | Do not use for Bookstr's `pt-PT` narration unless Deepgram adds and documents a Portugal voice. |
| iOS / Android system TTS | Yellow | Yellow. Depends on installed device voice. | Yellow. Basic rate and pitch. | Offline fallback only. |

## Cost baseline

For planning, a median adult novel means:

- 80,000 words.
- About 500,000 characters including spaces and punctuation.
- About 8.9 hours at 150 words per minute.

This is a budget model, not a claim that every book has this length.

All figures below are USD and approximate. Costs vary with narration speed,
provider plan, region, and actual rendered output.

| Provider | `pt-PT` fit | Approx. cost/min | Approx. cost/hour | Approx. cost/book |
|---|---|---:|---:|---:|
| ElevenLabs Multilingual v2 / v3 | Green | $0.10 | $6.00 | $50 |
| ElevenLabs Flash / Turbo | Green | $0.05 | $3.00 | $25 |
| Azure Neural | Green | about $0.015 | about $0.90 | about $8 |
| Azure Neural HD | Yellow | about $0.022 | about $1.32 | about $11 |
| Amazon Polly Standard | Yellow | $0.004 | $0.24 | $2 |
| Amazon Polly Neural | Yellow | $0.015 | $0.90 | $8 |
| Amazon Polly Generative | Red for `pt-PT` | $0.028 | $1.68 | $15 |
| OpenAI `gpt-4o-mini-tts` | Yellow | about $0.015 | about $0.90 | about $8 |
| Deepgram Aura-2 | Red for `pt-PT` | about $0.028 | about $1.69 | about $15 |
| Native iOS / Android | Yellow | $0 | $0 | $0 |

Notes:

- ElevenLabs publishes $0.10 per 1,000 characters for Multilingual v2/v3 and
  $0.05 per 1,000 characters for Flash/Turbo.
- Amazon Polly publishes $4/$16/$30 per million characters for Standard,
  Neural, and Generative voices.
- Azure bills per character. It includes 0.5 million free Neural characters per
  month; paid rates depend on region and account.
- OpenAI bills `gpt-4o-mini-tts` by input text and output audio tokens. The
  per-minute and per-book values above are estimates, so measure a real sample
  before committing.
- Deepgram Aura-2 is $0.030 per 1,000 characters on pay-as-you-go pricing. It
  supports low-latency REST and WebSocket audio streaming, but its documented
  TTS languages currently exclude Portuguese. Deepgram's Portuguese support in
  speech-to-text is a separate product and does not imply Portuguese TTS.

## Recommendation

1. Make Azure Neural with a dedicated `pt-PT` voice the reliable default.
2. Run a blind listening comparison against two Portugal-native ElevenLabs
   voices using representative book passages.
3. If ElevenLabs clearly wins, offer it as the premium online voice; otherwise
   retain Azure as the main cloud voice.
4. Keep native iOS and Android TTS as an offline fallback.
5. Store `locale: pt-PT` and pronunciation overrides in every shared speech
   plan so Brazilian Portuguese defaults cannot leak in.

## Candidate OSS projects to evaluate

### Nari Qwen3-TTS (experimental)

- A Hacker News post by Nari Labs introduced this as an inference engine for
  `Qwen3-TTS` with reported benchmark results: sub-50 ms p95 time-to-first-audio
  at 10 RPS and top-2 latency/accuracy among a competitive set.
- Their repository advertises an open-source, HTTP/WebSocket-compatible service
  around Qwen3-TTS with very low latency modes (`sub-50ms` TTFA at 10 RPS,
  `sub-80ms` at 20 RPS) and requires H100-class CUDA hardware.
- Use this as a **potential trial** for latency experiments only, with two
  blockers for production Bookstr `pt-PT` adoption:
  1. Current docs indicate English is the tested primary language.
  2. We need to verify `pt-PT` naturalness and quality end-to-end ourselves.

Relevant links:

- [Show HN: Nari Qwen3-TTS and Qwen3-ASR](https://news.ycombinator.com/item?id=49699267)
- [Nari Qwen3-TTS GitHub repo](https://github.com/nari-labs/nari-qwen3-tts)

### Open-source TTS candidates to audit next (size + latency profile)

Priority remains `pt-PT`, but English-first engines are useful for parity testing.

For phone sizing, call anything above roughly **1 GB** “likely too large” unless we can
strongly quantize without quality regression.

| OSS project | Approx artifact size (published) | Runtime memory posture | pt / pt-PT support | English support | Latency profile | Phone fit (≈1GB practical budget) |
|---|---|---|---|---|---|---|
| `tts_eu_pt` (pt-PT Kokoro fine-tune) | `~313 MB` voicepack (downloads once) | Small, on-device runtime | `pt-PT` text-normalization tuned for Lisbon Portuguese | Limited (no dedicated English voice in package) | Not documented in benchmark form; likely short due small Kokoro + ONNX runtime | ✅ likely fits |
| eSpeak NG data (`espeak-ng-data`) | `~24 MB` installed package (`espeak-ng-data`) | Very small CPU footprint | Portuguese listed (`roa` family `pt`, Portugal variant indicated) | 100+ languages supported | Engine is rule-based/formant-based and typically low-latency | ✅ very likely fits |
| Nari Qwen3-TTS (`Qwen3-TTS-12Hz-1.7B`) | `3.6 GB` GGUF checkpoint | Reported on H100-class GPU in docs; no phone/runtime target published | `pt-PT` not yet documented; English-first public reporting | Yes | Public benchmark: `sub-50 ms` p95 TTFA at 10 RPS; `sub-80 ms` near 20 RPS | ❌ no |
| Coqui XTTS-v2 | `~2.09 GB` model artifact | Generally multi-GB model cache and inference memory | `Portuguese (pt)` listed, no explicit `pt-PT` split | Yes | `Streaming` examples are commonly used; published user tests reference `< 200 ms` chunks in practice | ⚠️ borderline only for phones |
| Piper | `~60–76 MB` per voice `.onnx` | Very small voice pack per language pair | `pt_BR` and `pt_PT` voices listed in catalog | Yes, large English voice set | OSS benches report low per-chunk latency (TTFA in low hundreds ms, RTF around `0.03`) plus cold start load overhead | ✅ very likely fits |
| Kokoro-ONNX (`kokoro-v1.0`) | `~349 MB` (`model.onnx`) + voice pack (`voices.bin`) | Small CPU/ONNX runtime; modest cache | `pt-BR` (`pf_*`, `pm_*`) public voices; pt-PT not confirmed | Yes, multi-language set | Inference work focuses on low RTF CPU paths; no full streaming-first latency suite published | ✅ likely fits as non-pt-PT option |

OSS quick links:

- [Nari Qwen3-TTS repository](https://github.com/nari-labs/nari-qwen3-tts)
- [Coqui XTTS model docs](https://github.com/coqui-ai/TTS/blob/dev/docs/source/models/xtts.md)
- [Piper voice catalog (`pt_BR`, `pt_PT`)](https://github.com/rhasspy/piper/blob/master/VOICES.md)
- [Kokoro-ONNX README](https://github.com/thewh1teagle/kokoro-onnx/blob/main/README.md)
- [Kokoro language/voice prefixes](https://github.com/pguso/kokoro/blob/main/README.md)
- [ONNX benchmark set (Piper/Kokoro/Supertonic/Pocket)](https://github.com/omrylcn/voice-edge-benches)
- [Piper benchmark discussion (`~4.5s` model-load overhead)](https://github.com/stradichenko/audiobook.koplugin/blob/master/dev/benchmark/RESULTS.md)
- [Coqui XTTS-v2 model size (~2.09 GB)](https://huggingface.co/coqui/XTTS-v2/tree/v2.0.3)
- [Nari Qwen3-TTS GGUF size (3.6 GB)](https://huggingface.co/vokra/qwen3-tts-12hz-1.7b-customvoice)
- [Kokoro model + voices sizes (~300 MB / ~80 MB)](https://huggingface.co/spaces/kinabraytan/kokoro-tts-server/blob/main/DEPLOYMENT.md)
- [tts-eu-pt (European Portuguese Kokoro package)](https://pypi.org/project/tts-eu-pt/)
- [eSpeak NG languages support](https://github.com/espeak-ng/espeak-ng/blob/master/docs/languages.md)
- [espeak-ng-data Debian package size](https://packages.debian.org/trixie/espeak-ng-data)
- [Kokoro pt-BR release bundle (~329 MB)](https://huggingface.co/cristianoaredes/kokoro-pt-br)

### `tts_eu_pt` in-app pilot plan (no sidecar service)

Goal: evaluate `tts_eu_pt` as a `pt-PT` OSS fallback without introducing a separate API service.

- Scope:
  - Keep one shared speech plan (`SpeechPlan`) and convert it in each platform adapter.
  - Use `tts_eu_pt` only as an internal in-process optional engine.
  - Avoid any HTTP/WS service bridge or local background daemon.
- Implementation path (docs-only planning first):
  1. Add a dedicated `pt-PT` OSS engine adapter and treat it as a build/runtime feature flag, parallel to current cloud engines.
  2. Package the model artifacts in the app-install bundle (or first-run cache inside app storage), with no external runtime endpoints.
  3. Wire player loop to existing `BookstrSpeech.buildPlan` chunks so `tts_eu_pt` uses the same pause/emphasis/offset contract as Azure/ElevenLabs/OpenAI.
  4. Add runtime selection fallback:
     - `tts_eu_pt` when locale is `pt-PT` and user enables local OSS voice.
     - current cloud/local system fallback when the OSS adapter is not enabled or fails.
  5. Add startup and first-audio metrics in-app:
     - first-run model load time
     - first chunk latency
     - steady-state chunk latency
     - memory delta
  6. Add guardrails:
     - if startup or per-chunk latency regresses beyond threshold, auto-disable OSS adapter and keep UX continuity with existing primary engine.
- Mobile staging:
  - For `iOS`/`Android`, confirm whether embedding `tts_eu_pt` runtime is supported in-platform (without sidecar) before enabling by default; if not, keep it disabled while preserving all UX paths and the exact same shared `SpeechPlan`.

### English preprocessing notes (Kokoro quality hardening)

Current English quality issues with Kokoro should be treated as front-end/TTS preprocessing debt first.

Immediate actions (from the earlier stack recommendation): implement items **1** and **2** now.

| Step | Why it matters | Suggested implementation |
|---|---|---|
| 1) Shared sentence chunking + punctuation cleanup | Bad boundaries and weak punctuation shaping degrade rhythm and make Kokoro sound flat | In the shared speech preprocessor, use `spaCy` (or a lighter language splitter if needed) to standardize sentence boundaries, normalize ellipsis/dash/repeated punctuation, and preserve paragraph markers consistently for chunking. |
| 2) Full English text normalization | Numbers, acronyms, dates, and symbols are often parsed inconsistently by TTS front-ends | Add a normalizer in the shared English path using `nemo_text_processing` first, with `gruut` as fallback if runtime size becomes a constraint. Expand at least: numbers/dates, percentages/money/ordinals, common acronyms (`API`, `HTTP`, `AI`, etc.), and timezone/unit abbreviations. |

Notes for implementation:

- Keep these transforms in the shared `SpeechPlan` path, then keep provider adapters untouched as much as possible.
- Add telemetry for preprocessor latency per chunk, first chunk duration, and normalized-token count by category.
- If a platform cannot include `nemo_text_processing`, use `gruut` while preserving the same chunk contract.

Temporary test pass:

- Pick one 2-minute chapter excerpt with numbers, abbreviations, and dialogue.
- Compare old vs new output in the same Kokoro voice with only preprocessing differences.
- Keep the new path if alignment and pronunciation complaints improve in at least 2 of 3 blind checks.

## Sources

- [Azure `pt-PT` voice support](https://learn.microsoft.com/en-us/azure/ai-services/Speech-Service/language-support)
- [Azure SSML capabilities](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup)
- [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/)
- [ElevenLabs voice language guidance](https://elevenlabs.io/docs/help-center/product/speech-synthesis/text-to-speech/what-languages-can-the-ai-speak)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [Amazon Polly voice availability](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html)
- [Amazon Polly pricing](https://aws.amazon.com/polly/pricing/)
- [OpenAI `gpt-4o-mini-tts` model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
- [Deepgram TTS models and languages](https://developers.deepgram.com/docs/tts-models-languages-overview)
- [Deepgram TTS streaming API](https://developers.deepgram.com/reference/text-to-speech/speak-streaming)
- [Deepgram pricing](https://deepgram.com/pricing)
