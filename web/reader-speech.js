(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BookstrSpeech = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  const DEFAULT_SOFT_LIMIT = 180;
  const DEFAULT_HARD_LIMIT = 240;
  const DEFAULT_MAX_CHARACTERS = 100000;
  const CONTINUATION_PAUSE_MS = 35;
  const SENTENCE_PAUSE_MS = 180;
  const CLAUSE_PAUSE_MS = 250;
  const ELLIPSIS_PAUSE_MS = 280;
  const EMPHATIC_PAUSE_MS = 320;
  const PARAGRAPH_PAUSE_MS = 400;

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "")
      .replace(/\r/g, " ")
      .replace(/\s+/g, " ")
      .replace(/(\.\.\.|[.,;:!?…])\s*/g, "$1 ")
      .trim();
  }

  function normalizeLocale(language) {
    const normalized = String(language || "").trim().replace(/_/g, "-").toLowerCase();
    if (!normalized) return "en";
    if (normalized === "pt") return "pt-PT";
    return normalized.split("-").map(function(part, index) {
      return index === 0 ? part : part.length === 2 ? part.toUpperCase() : part;
    }).join("-");
  }

  function voiceIdentity(voice) {
    return [voice && voice.voiceURI, voice && voice.name]
      .map(function(value) { return String(value || "").trim().toLowerCase(); })
      .filter(Boolean)
      .join(" ");
  }

  function selectVoice(voices, language, identifier) {
    const requested = String(identifier || "").trim().toLowerCase();
    if (!requested) return null;
    const available = Array.isArray(voices) ? voices : [];
    const requestedLanguage = normalizeLocale(language).toLowerCase();
    const languagePrefix = requestedLanguage.split("-")[0];
    const matchesLanguage = function(voice) {
      const voiceLanguage = normalizeLocale(voice && voice.lang).toLowerCase();
      return voiceLanguage === requestedLanguage || voiceLanguage.split("-")[0] === languagePrefix;
    };
    const exact = available.find(function(voice) {
      return matchesLanguage(voice) && (
        String(voice && voice.voiceURI || "").trim().toLowerCase() === requested
        || String(voice && voice.name || "").trim().toLowerCase() === requested
      );
    });
    if (exact) return exact;
    return available.find(function(voice) {
      return voiceIdentity(voice).includes(requested) && matchesLanguage(voice);
    }) || null;
  }

  function normalizedParagraphs(values, maximumCharacters) {
    const source = Array.isArray(values) ? values : [values];
    const paragraphs = [];
    let used = 0;
    for (const value of source) {
      let paragraph = normalizeText(value);
      if (!paragraph) continue;
      const separatorLength = paragraphs.length ? 1 : 0;
      const available = maximumCharacters - used - separatorLength;
      if (available <= 0) break;
      if (paragraph.length > available) {
        let shortened = paragraph.slice(0, available);
        if (available < paragraph.length && /\S/.test(paragraph.charAt(available - 1)) && /\S/.test(paragraph.charAt(available))) {
          const boundary = shortened.lastIndexOf(" ");
          if (boundary > 0) shortened = shortened.slice(0, boundary);
        }
        paragraph = shortened.trim();
      }
      if (paragraph) {
        paragraphs.push(paragraph);
        used += separatorLength + paragraph.length;
      }
      if (used >= maximumCharacters || paragraph.length < normalizeText(value).length) break;
    }
    return paragraphs;
  }

  function splitSentences(text, segmenterFactory) {
    const Segmenter = segmenterFactory === undefined
      ? (typeof Intl !== "undefined" ? Intl.Segmenter : null)
      : segmenterFactory;
    if (Segmenter) {
      try {
        const segmenter = typeof Segmenter === "function"
          ? new Segmenter(undefined, { granularity: "sentence" })
          : Segmenter;
        const sentences = [];
        for (const entry of segmenter.segment(text)) {
          const sentence = normalizeText(entry.segment);
          if (sentence) sentences.push(sentence);
        }
        if (sentences.length) return sentences;
      } catch (_) {
        // The deterministic fallback below is used when a platform segmenter fails.
      }
    }
    const fallback = text.match(/[^.!?…]+(?:\.\.\.|[.!?…]+)(?:\s+|$)|[^.!?…]+$/g) || [];
    return fallback.map(normalizeText).filter(Boolean);
  }

  function wordCount(text) {
    const clean = String(text || "").trim();
    return clean ? clean.split(/\s+/).length : 0;
  }

  function boundaryAfterPunctuation(text, index) {
    const character = text.charAt(index);
    if (!/[,;:—–]/.test(character)) return false;
    return index + 1 >= text.length || /\s/.test(text.charAt(index + 1));
  }

  function findBoundary(text, cursor, softLimit, hardLimit) {
    const hardEnd = Math.min(cursor + hardLimit, text.length);
    if (hardEnd >= text.length) return text.length;
    const softEnd = Math.min(cursor + softLimit, hardEnd);
    const preferredStart = cursor + Math.floor(softLimit * 0.55);

    for (let index = softEnd; index >= preferredStart; index -= 1) {
      if (boundaryAfterPunctuation(text, index)) return index + 1;
    }
    for (let index = softEnd + 1; index < hardEnd; index += 1) {
      if (boundaryAfterPunctuation(text, index)) return index + 1;
    }
    for (let index = softEnd; index >= preferredStart; index -= 1) {
      if (/\s/.test(text.charAt(index))) return index;
    }
    for (let index = softEnd + 1; index < hardEnd; index += 1) {
      if (/\s/.test(text.charAt(index))) return index;
    }
    return hardEnd;
  }

  function trimRange(text, start, end) {
    let cleanStart = start;
    let cleanEnd = end;
    while (cleanStart < cleanEnd && /\s/.test(text.charAt(cleanStart))) cleanStart += 1;
    while (cleanEnd > cleanStart && /\s/.test(text.charAt(cleanEnd - 1))) cleanEnd -= 1;
    return { start: cleanStart, end: cleanEnd };
  }

  function rebalanceFinalRange(text, ranges, hardLimit) {
    if (ranges.length < 2) return ranges;
    const last = ranges[ranges.length - 1];
    if (wordCount(text.slice(last.start, last.end)) !== 1) return ranges;
    const previous = ranges[ranges.length - 2];
    const previousText = text.slice(previous.start, previous.end);
    const moveBoundary = previousText.lastIndexOf(" ");
    if (moveBoundary <= 0) return ranges;
    const nextPrevious = trimRange(text, previous.start, previous.start + moveBoundary);
    const nextLast = trimRange(text, previous.start + moveBoundary + 1, last.end);
    if (nextPrevious.end > nextPrevious.start && nextLast.end - nextLast.start <= hardLimit) {
      ranges.splice(ranges.length - 2, 2, nextPrevious, nextLast);
    }
    return ranges;
  }

  function splitLongSentence(text, softLimit, hardLimit) {
    const ranges = [];
    let cursor = 0;
    while (cursor < text.length) {
      const remaining = text.length - cursor;
      if (remaining <= hardLimit) {
        ranges.push(trimRange(text, cursor, text.length));
        break;
      }
      const boundary = findBoundary(text, cursor, softLimit, hardLimit);
      const piece = trimRange(text, cursor, boundary);
      if (piece.end > piece.start) ranges.push(piece);
      cursor = Math.max(boundary, cursor + 1);
      while (cursor < text.length && /\s/.test(text.charAt(cursor))) cursor += 1;
    }
    return rebalanceFinalRange(text, ranges, hardLimit);
  }

  function chunkParagraph(paragraph, softLimit, hardLimit, segmenterFactory) {
    const sentences = splitSentences(paragraph, segmenterFactory);
    const chunks = [];
    let searchFrom = 0;
    let active = null;

    function flushActive() {
      if (active) chunks.push(active);
      active = null;
    }

    for (const sentenceText of sentences) {
      const sentenceStart = paragraph.indexOf(sentenceText, searchFrom);
      if (sentenceStart < 0) continue;
      const sentenceEnd = sentenceStart + sentenceText.length;
      searchFrom = sentenceEnd;
      if (sentenceText.length > hardLimit) {
        flushActive();
        for (const range of splitLongSentence(sentenceText, softLimit, hardLimit)) {
          chunks.push({ start: sentenceStart + range.start, end: sentenceStart + range.end });
        }
        continue;
      }

      if (!active) {
        active = { start: sentenceStart, end: sentenceEnd };
        continue;
      }
      const joinedLength = sentenceEnd - active.start;
      if (joinedLength <= softLimit || (wordCount(sentenceText) === 1 && joinedLength <= hardLimit)) {
        active.end = sentenceEnd;
      } else {
        flushActive();
        active = { start: sentenceStart, end: sentenceEnd };
      }
    }
    flushActive();
    if (!chunks.length && paragraph) chunks.push({ start: 0, end: paragraph.length });
    return rebalanceFinalRange(paragraph, chunks, hardLimit);
  }

  function pauseAfter(text) {
    const clean = String(text || "").trim();
    if (!clean) return CONTINUATION_PAUSE_MS;
    if (/\.\.\.$/.test(clean)) return ELLIPSIS_PAUSE_MS;
    if (/[!?…]$/.test(clean)) return EMPHATIC_PAUSE_MS;
    if (/[,;:—–]$/.test(clean)) return CLAUSE_PAUSE_MS;
    if (/\.$/.test(clean)) return SENTENCE_PAUSE_MS;
    return CONTINUATION_PAUSE_MS;
  }

  function buildPlan(values, options) {
    const settings = options || {};
    const softLimit = Math.max(1, Number(settings.softLimit) || DEFAULT_SOFT_LIMIT);
    const hardLimit = Math.max(softLimit, Number(settings.hardLimit) || DEFAULT_HARD_LIMIT);
    const maximumCharacters = Math.max(1, Number(settings.maximumCharacters) || DEFAULT_MAX_CHARACTERS);
    const paragraphs = normalizedParagraphs(values, maximumCharacters);
    const text = paragraphs.join(" ");
    const chunks = [];
    let paragraphStart = 0;
    let previous = null;

    paragraphs.forEach(function(paragraph, paragraphIndex) {
      const ranges = chunkParagraph(paragraph, softLimit, hardLimit, settings.segmenterFactory);
      ranges.forEach(function(range, rangeIndex) {
        const chunkText = paragraph.slice(range.start, range.end);
        let pauseMs = 0;
        if (chunks.length) {
          pauseMs = rangeIndex === 0 && paragraphIndex > 0
            ? PARAGRAPH_PAUSE_MS
            : pauseAfter(previous.text);
        }
        const chunk = {
          text: chunkText,
          start: paragraphStart + range.start,
          pauseMs,
        };
        chunks.push(chunk);
        previous = chunk;
      });
      paragraphStart += paragraph.length + 1;
    });
    return { text, chunks };
  }

  function createPlayer(configuration) {
    const config = configuration || {};
    const synthesis = config.speechSynthesis;
    const Utterance = config.Utterance;
    const scheduleTimer = config.setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
    const cancelTimer = config.clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : null);
    const now = config.now || Date.now;
    const onStateChange = config.onStateChange || function() {};
    let state = "stopped";
    let generation = 0;
    let chunks = [];
    let index = 0;
    let language = "en";
    let rate = 1;
    let voiceIdentifier = "";
    let utterance = null;
    let timer = null;
    let timerDeadline = 0;
    let remainingDelay = 0;
    let phase = "idle";

    function publish(nextState) {
      if (state === nextState) return;
      state = nextState;
      onStateChange(state);
    }

    function clearPendingTimer() {
      if (timer !== null && cancelTimer) cancelTimer(timer);
      timer = null;
      timerDeadline = 0;
    }

    function reset(cancelSpeech) {
      generation += 1;
      clearPendingTimer();
      if (cancelSpeech && synthesis && typeof synthesis.cancel === "function") synthesis.cancel();
      chunks = [];
      index = 0;
      utterance = null;
      remainingDelay = 0;
      phase = "idle";
    }

    function finish(activeGeneration) {
      if (activeGeneration !== generation) return;
      clearPendingTimer();
      chunks = [];
      utterance = null;
      remainingDelay = 0;
      phase = "idle";
      publish("stopped");
    }

    function speak(activeGeneration) {
      if (activeGeneration !== generation || state !== "playing") return;
      const chunk = chunks[index];
      remainingDelay = 0;
      phase = "speaking";
      const nextUtterance = new Utterance(chunk.text);
      nextUtterance.lang = language;
      nextUtterance.rate = rate;
      const voices = synthesis && typeof synthesis.getVoices === "function" ? synthesis.getVoices() : [];
      const selectedVoice = selectVoice(voices, language, voiceIdentifier);
      if (selectedVoice) nextUtterance.voice = selectedVoice;
      nextUtterance.onend = function() {
        if (activeGeneration !== generation || nextUtterance !== utterance) return;
        utterance = null;
        index += 1;
        if (index >= chunks.length) {
          finish(activeGeneration);
          return;
        }
        waitThenSpeak(activeGeneration, Math.max(0, Number(chunks[index].pauseMs) || 0));
      };
      nextUtterance.onerror = function() {
        if (activeGeneration === generation && nextUtterance === utterance) finish(activeGeneration);
      };
      utterance = nextUtterance;
      synthesis.speak(nextUtterance);
    }

    function waitThenSpeak(activeGeneration, delay) {
      if (activeGeneration !== generation) return;
      phase = "waiting";
      remainingDelay = delay;
      if (state !== "playing") return;
      if (delay <= 0 || !scheduleTimer) {
        speak(activeGeneration);
        return;
      }
      timerDeadline = now() + delay;
      timer = scheduleTimer(function() {
        timer = null;
        timerDeadline = 0;
        speak(activeGeneration);
      }, delay);
    }

    return {
      get state() { return state; },
      get supported() {
        return Boolean(synthesis && typeof synthesis.speak === "function" && typeof Utterance === "function");
      },
      start: function(plan, options) {
        reset(true);
        const nextChunks = plan && Array.isArray(plan.chunks) ? plan.chunks.filter(function(chunk) {
          return chunk && String(chunk.text || "").trim();
        }) : [];
        if (!nextChunks.length || !this.supported) {
          publish("stopped");
          return false;
        }
        chunks = nextChunks;
        index = 0;
        language = normalizeLocale(options && options.language);
        rate = Math.max(0.1, Math.min(10, Number(options && options.rate) || 1));
        voiceIdentifier = String(options && options.voiceIdentifier || "").trim();
        const activeGeneration = generation;
        publish("playing");
        speak(activeGeneration);
        return true;
      },
      pause: function() {
        if (state !== "playing") return false;
        if (phase === "waiting") {
          remainingDelay = Math.max(0, timerDeadline - now());
          clearPendingTimer();
        } else if (phase === "speaking" && synthesis && typeof synthesis.pause === "function") {
          synthesis.pause();
        }
        publish("paused");
        return true;
      },
      resume: function() {
        if (state !== "paused") return false;
        publish("playing");
        if (phase === "waiting") {
          waitThenSpeak(generation, remainingDelay);
        } else if (phase === "speaking" && synthesis && typeof synthesis.resume === "function") {
          synthesis.resume();
        }
        return true;
      },
      stop: function() {
        const wasActive = state !== "stopped" || phase !== "idle";
        reset(wasActive);
        publish("stopped");
        return wasActive;
      },
    };
  }

  return {
    buildPlan,
    createPlayer,
    normalizeLocale,
    selectVoice,
    normalizeText,
    defaults: Object.freeze({
      softLimit: DEFAULT_SOFT_LIMIT,
      hardLimit: DEFAULT_HARD_LIMIT,
      maximumCharacters: DEFAULT_MAX_CHARACTERS,
      continuationPauseMs: CONTINUATION_PAUSE_MS,
      sentencePauseMs: SENTENCE_PAUSE_MS,
      clausePauseMs: CLAUSE_PAUSE_MS,
      ellipsisPauseMs: ELLIPSIS_PAUSE_MS,
      emphaticPauseMs: EMPHATIC_PAUSE_MS,
      paragraphPauseMs: PARAGRAPH_PAUSE_MS,
    }),
  };
});
