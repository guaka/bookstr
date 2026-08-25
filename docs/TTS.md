# Text-to-Speech Direction

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
