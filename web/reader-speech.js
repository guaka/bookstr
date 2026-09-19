(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BookstrSpeech = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  const DEFAULT_SOFT_LIMIT = 180;
  const DEFAULT_HARD_LIMIT = 240;
  const DEFAULT_MAX_CHARACTERS = 100000;
  const CONTINUATION_PAUSE_MS = 40;
  const SENTENCE_PAUSE_MS = 220;
  const COMMA_PAUSE_MS = 340;
  const CLAUSE_PAUSE_MS = 300;
  const PAREN_PAUSE_MS = 380;
  const DASH_PAUSE_MS = 520;
  const ELLIPSIS_PAUSE_MS = 360;
  const EMPHATIC_PAUSE_MS = 380;
  const PARAGRAPH_PAUSE_MS = 750;
  const ENGLISH_ACRONYM_MAP = {
    AI: "A I",
    API: "A P I",
    CPU: "C P U",
    GPU: "G P U",
    HTML: "H T M L",
    HTTPS: "H T T P S",
    HTTP: "H T T P",
    JSON: "J S O N",
    NLP: "N L P",
    URL: "U R L",
    USA: "U S A",
    UK: "U K",
  };

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "")
      .replace(/\r/g, " ")
      .replace(/\s+/g, " ")
      .replace(/(\.\.\.|[.,;:!?…])(?!["”’'])\s*/g, "$1 ")
      .replace(/(\d{1,3}(?:, \d{3})+)/g, function(match) {
        return match.replace(/, /g, ",");
      })
      .trim();
  }

  function isEnglishLocale(language) {
    const normalized = normalizeLocale(language).toLowerCase();
    return /^en(?:-|$)/.test(normalized);
  }

  function normalizeEnglishPunctuation(value) {
    return String(value || "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, "\"")
      .replace(/…/g, "...")
      .replace(/\.\.\.{4,}/g, "...")
      .replace(/\s*(?:—|–|--+)\s*/g, " -- ")
      .replace(/\s+-\s+/g, " -- ")
      .replace(/\(\s*/g, "(")
      .replace(/\s*\)/g, ")")
      .replace(/\s+([,;:!?])\s*/g, "$1 ")
      .replace(/([,;:!?])([^\s\]\)"'’])/g, "$1 $2")
      .replace(/\s{2,}/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function normalizeEnglishAcronyms(value) {
    return String(value || "").replace(/\b(?:AI|API|CPU|GPU|HTML|HTTPS|HTTP|JSON|NLP|URL|USA|UK)\b/gi, function(match) {
      return ENGLISH_ACRONYM_MAP[String(match || "").toUpperCase()] || match;
    });
  }

  function normalizeEnglishSpokenText(value) {
    let output = String(value || "");
    output = normalizeEnglishAcronyms(output);
    output = output
      .replace(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})\b/g, "$1 slash $2 slash $3")
      .replace(/\b(\d{1,2}):(\d{2})\b/g, "$1 $2")
      .replace(/\$ ?(\d+(?:\.\d{1,2})?)/g, "$1 dollars")
      .replace(/\b(\d+)%/g, "$1 percent");
    return output;
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

  function splitSentences(text, segmenterFactory, language) {
    const Segmenter = segmenterFactory === undefined
      ? (typeof Intl !== "undefined" ? Intl.Segmenter : null)
      : segmenterFactory;
    const normalized = String(text || "");
    if (Segmenter) {
      try {
        const segmenter = typeof Segmenter === "function"
          ? new Segmenter(isEnglishLocale(language) ? "en" : normalizeLocale(language), { granularity: "sentence" })
          : Segmenter;
        const sentences = [];
        for (const entry of segmenter.segment(normalized)) {
          const sentence = normalizeText(entry.segment);
          if (sentence) sentences.push(sentence);
        }
        if (sentences.length) return sentences;
      } catch (_) {
        // The deterministic fallback below is used when a platform segmenter fails.
      }
    }
    const fallback = normalized.match(/[^.!?…]+(?:\.\.\.|[.!?…]+)["”’']*(?:\s+|$)|[^.!?…]+$/g) || [];
    return fallback.map(normalizeText).filter(Boolean);
  }

  function spokenText(text) {
    return String(text || "")
      .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, function(match) {
        return match.replace(/,/g, "");
      })
      .replace(/\d{1,3}(?:[\u00A0\u202F ]\d{3})+(?:[.,]\d+)?/g, function(match) {
        return match.replace(/[\u00A0\u202F ]/g, "");
      })
      .replace(/\[\d{1,3}\]/g, "")
      .replace(/[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]+/g, "")
      .replace(/(?<=\S)\(\d{1,3}\)/g, "")
      .replace(/[“”«»„"]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ ]{2,}/g, " ")
      .replace(/ ([,.;:!?])/g, "$1")
      .trim();
  }

  function spokenTextWithLocale(text, language, includeEnglishPreprocessing) {
    const base = spokenText(text);
    if (!includeEnglishPreprocessing || !isEnglishLocale(language)) return base;
    return normalizeEnglishSpokenText(normalizeEnglishPunctuation(base));
  }

  function compareLocators(left, right, compare) {
    const a = String(left || "").trim();
    const b = String(right || "").trim();
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    if (typeof compare === "function") {
      const result = compare(a, b);
      if (Number.isFinite(result)) return result;
    }
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function relocationProgression(locationsPercentage, viewportPercentage) {
    if (Number.isFinite(locationsPercentage)) {
      return Math.max(0, Math.min(1, locationsPercentage));
    }
    if (Number.isFinite(viewportPercentage)) {
      return Math.max(0, Math.min(1, viewportPercentage));
    }
    return null;
  }

  function selectionKind(selection) {
    const text = String(selection || "").replace(/\s+/g, " ").trim();
    if (!text) return "empty";
    const tokens = text.split(" ");
    if (tokens.length > 2) return "mark";
    const wordToken = /^\p{L}+(?:['’\-]\p{L}+)*$/u;
    return tokens.every(function(token) { return wordToken.test(token); }) ? "words" : "mark";
  }

  function locatorSkipDecision(blockStart, blockEnd, resume, compare) {
    const at = String(resume || "").trim();
    if (!at) return "include";
    const start = String(blockStart || "").trim();
    const end = String(blockEnd || "").trim();
    if (end && compareLocators(end, at, compare) <= 0) return "skip";
    if (start && compareLocators(start, at, compare) < 0) return "resume";
    return "include";
  }

  function mappedIndexAtPoint(positions, node, offset) {
    if (!positions || !positions.length) return 0;
    for (let index = 0; index < positions.length; index += 1) {
      const pos = positions[index];
      if (pos.node !== node) continue;
      if (offset <= pos.start) return index;
      if (offset < pos.end) return index;
      if (offset === pos.end) return Math.min(index + 1, positions.length);
    }
    return 0;
  }

  function isSilentSpeechParent(element) {
    if (!element || typeof element.closest !== "function") return false;
    if (element.closest("script, style, noscript, sup, sub, small")) return true;
    const link = element.closest("a");
    if (!link) return false;
    const type = String(link.getAttribute("epub:type") || link.getAttribute("role") || "").toLowerCase();
    if (/\b(noteref|footnote|endnote|rearnote)\b/.test(type)) return true;
    return /\b(noteref|footnote-ref|endnote-ref)\b/.test(String(link.className || "").toLowerCase());
  }

  function visibleText(element) {
    if (!element || !element.ownerDocument || typeof element.ownerDocument.createTreeWalker !== "function") {
      return "";
    }
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      if (isSilentSpeechParent(node.parentElement)) continue;
      parts.push(node.nodeValue || "");
    }
    return parts.join("");
  }

  const SPEAKABLE_PRIMARY_SELECTOR =
    "h1, h2, h3, h4, h5, h6, p, blockquote, pre, figcaption, dt, dd, li";
  const SPEAKABLE_CONTAINER_SELECTOR = "div, section, article";

  function speakableBlocks(document) {
    if (!document || typeof document.querySelectorAll !== "function") return [];
    const primaryNodes = Array.from(document.querySelectorAll(SPEAKABLE_PRIMARY_SELECTOR));
    const primarySet = new Set(primaryNodes);
    const candidates = Array.from(document.querySelectorAll(
      SPEAKABLE_PRIMARY_SELECTOR + ", " + SPEAKABLE_CONTAINER_SELECTOR
    ));
    const blocks = [];
    candidates.forEach(function(element) {
      if (primarySet.has(element)) {
        // Nested primaries (e.g. li inside a heading) are spoken via the ancestor.
        const parent = element.parentElement;
        if (parent && typeof parent.closest === "function" && parent.closest(SPEAKABLE_PRIMARY_SELECTOR)) {
          return;
        }
        if (normalizeText(visibleText(element))) blocks.push(element);
        return;
      }
      // Nested wrappers inside headings/paragraphs must not re-speak the same text.
      if (typeof element.closest === "function" && element.closest(SPEAKABLE_PRIMARY_SELECTOR)) {
        return;
      }
      if (typeof element.querySelector === "function" && element.querySelector(SPEAKABLE_PRIMARY_SELECTOR)) {
        return;
      }
      const nested = typeof element.querySelectorAll === "function"
        ? Array.from(element.querySelectorAll(SPEAKABLE_CONTAINER_SELECTOR))
        : [];
      for (let index = 0; index < nested.length; index += 1) {
        if (normalizeText(visibleText(nested[index]))) return;
      }
      if (!normalizeText(visibleText(element))) return;
      blocks.push(element);
    });
    if (!blocks.length && document.body && normalizeText(visibleText(document.body))) {
      return [document.body];
    }
    return blocks;
  }

  function isGroupedThousandsComma(text, commaIndex) {
    if (commaIndex < 1 || !/\d/.test(text.charAt(commaIndex - 1))) return false;
    return /^\d{3}(?:,\d{3})*(?:\.\d+)?(?:\D|$)/.test(text.slice(commaIndex + 1));
  }

  function wordCount(text) {
    const clean = String(text || "").trim();
    return clean ? clean.split(/\s+/).length : 0;
  }

  function dashRunEnd(text, index) {
    const character = text.charAt(index);
    if (character === "—" || character === "–") return index + 1;
    if (character !== "-") return 0;
    if (text.charAt(index + 1) === "-") {
      let end = index + 2;
      while (text.charAt(end) === "-") end += 1;
      return end;
    }
    if (index > 0 && text.charAt(index - 1) === "-") return index + 1;
    return 0;
  }

  function matchingParenClose(text, openIndex) {
    let depth = 0;
    for (let index = openIndex; index < text.length; index += 1) {
      const character = text.charAt(index);
      if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  function absorbTrailingPunctuation(text, end) {
    let index = end;
    while (index < text.length && /[)"'”’\]»]/.test(text.charAt(index))) index += 1;
    if (text.slice(index, index + 3) === "...") return index + 3;
    if (/[.!?…]/.test(text.charAt(index))) return index + 1;
    return end;
  }

  function boundaryAfterPunctuation(text, index) {
    const dashEnd = dashRunEnd(text, index);
    if (dashEnd) return dashEnd;
    const character = text.charAt(index);
    if (character === ")") {
      return absorbTrailingPunctuation(text, index + 1);
    }
    if (!/[,;:]/.test(character)) return false;
    if (character === "," && isGroupedThousandsComma(text, index)) return false;
    return index + 1 >= text.length || /\s/.test(text.charAt(index + 1)) ? index + 1 : 0;
  }

  function shouldSplitComma(text, start, commaIndex) {
    const left = text.slice(start, commaIndex);
    const right = text.slice(commaIndex + 1);
    const leftWords = wordCount(left);
    const rightWords = wordCount(right);
    if (leftWords >= 4 && rightWords >= 2) return true;
    if (leftWords >= 3 && rightWords >= 4) return true;
    return left.length >= 72 && rightWords >= 2;
  }

  function splitSentenceAtPhrases(text) {
    const ranges = [];
    let start = 0;
    let index = 0;
    while (index < text.length) {
      if (text.charAt(index) === "(") {
        const close = matchingParenClose(text, index);
        if (close > index) {
          if (index > start) {
            const before = trimRange(text, start, index);
            if (before.end > before.start) ranges.push(before);
          }
          const afterParen = absorbTrailingPunctuation(text, close + 1);
          const inner = trimRange(text, index, afterParen);
          if (inner.end > inner.start) ranges.push(inner);
          start = afterParen;
          index = afterParen;
          continue;
        }
      }

      const dashEnd = dashRunEnd(text, index);
      if (dashEnd && wordCount(text.slice(start, dashEnd)) >= 1 && wordCount(text.slice(dashEnd)) >= 1) {
        const piece = trimRange(text, start, dashEnd);
        if (piece.end > piece.start) ranges.push(piece);
        start = dashEnd;
        index = dashEnd;
        continue;
      }

      if (text.charAt(index) === "," && (index + 1 >= text.length || /\s/.test(text.charAt(index + 1)))) {
        if (!isGroupedThousandsComma(text, index) && shouldSplitComma(text, start, index)) {
          const piece = trimRange(text, start, index + 1);
          if (piece.end > piece.start) ranges.push(piece);
          start = index + 1;
          index += 1;
          continue;
        }
      }

      if (text.charAt(index) === ";" && (index + 1 >= text.length || /\s/.test(text.charAt(index + 1)))) {
        const piece = trimRange(text, start, index + 1);
        if (piece.end > piece.start) ranges.push(piece);
        start = index + 1;
        index += 1;
        continue;
      }

      index += 1;
    }
    const tail = trimRange(text, start, text.length);
    if (tail.end > tail.start) ranges.push(tail);
    return ranges;
  }

  function isSentenceFinal(text) {
    return /(?:\.\.\.|[.!?…])["'”’)\]]*$/.test(String(text || "").trim());
  }

  function findBoundary(text, cursor, softLimit, hardLimit) {
    const hardEnd = Math.min(cursor + hardLimit, text.length);
    if (hardEnd >= text.length) return text.length;
    const softEnd = Math.min(cursor + softLimit, hardEnd);
    const preferredStart = cursor + Math.floor(softLimit * 0.55);

    for (let index = softEnd; index >= preferredStart; index -= 1) {
      const boundary = boundaryAfterPunctuation(text, index);
      if (boundary) return boundary;
    }
    for (let index = softEnd + 1; index < hardEnd; index += 1) {
      const boundary = boundaryAfterPunctuation(text, index);
      if (boundary) return boundary;
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

  function chunkParagraph(paragraph, softLimit, hardLimit, segmenterFactory, language) {
    const sentences = splitSentences(paragraph, segmenterFactory, language);
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
      const phraseRanges = [];
      for (const phrase of splitSentenceAtPhrases(sentenceText)) {
        const piece = sentenceText.slice(phrase.start, phrase.end);
        if (piece.length > hardLimit) {
          for (const range of splitLongSentence(piece, softLimit, hardLimit)) {
            phraseRanges.push({
              start: sentenceStart + phrase.start + range.start,
              end: sentenceStart + phrase.start + range.end,
            });
          }
        } else {
          phraseRanges.push({
            start: sentenceStart + phrase.start,
            end: sentenceStart + phrase.end,
          });
        }
      }

      for (const range of phraseRanges) {
        if (!active) {
          active = { start: range.start, end: range.end };
          continue;
        }
        const activeText = paragraph.slice(active.start, active.end);
        const nextText = paragraph.slice(range.start, range.end);
        const joinedLength = range.end - active.start;
        const canJoinSentences = isSentenceFinal(activeText)
          && isSentenceFinal(nextText)
          && (joinedLength <= softLimit || (wordCount(nextText) === 1 && joinedLength <= hardLimit));
        if (canJoinSentences) {
          active.end = range.end;
        } else {
          flushActive();
          active = { start: range.start, end: range.end };
        }
      }
    }
    flushActive();
    if (!chunks.length && paragraph) chunks.push({ start: 0, end: paragraph.length });
    return rebalanceFinalRange(paragraph, chunks, hardLimit);
  }

  function pauseAfter(text) {
    const clean = String(text || "").trim();
    if (!clean) return CONTINUATION_PAUSE_MS;
    if (/\.\.\.["'”’)\]]*$/.test(clean)) return ELLIPSIS_PAUSE_MS;
    if (/[!?…]["'”’)\]]*$/.test(clean)) return EMPHATIC_PAUSE_MS;
    if (/(?:--|[—–])$/.test(clean)) return DASH_PAUSE_MS;
    if (/^\(/.test(clean) || /\)[.!?…"”’']*$/.test(clean)) return PAREN_PAUSE_MS;
    if (/,$/.test(clean)) return COMMA_PAUSE_MS;
    if (/[;:]$/.test(clean)) return CLAUSE_PAUSE_MS;
    if (/\.["'”’)\]]*$/.test(clean)) return SENTENCE_PAUSE_MS;
    return CONTINUATION_PAUSE_MS;
  }

  function buildPlan(values, options) {
    const settings = options || {};
    const softLimit = Math.max(1, Number(settings.softLimit) || DEFAULT_SOFT_LIMIT);
    const hardLimit = Math.max(softLimit, Number(settings.hardLimit) || DEFAULT_HARD_LIMIT);
    const maximumCharacters = Math.max(1, Number(settings.maximumCharacters) || DEFAULT_MAX_CHARACTERS);
    const language = normalizeLocale(settings.language);
    const includeEnglishPreprocessing = Boolean(settings.normalizeEnglish) && isEnglishLocale(language);
    const paragraphs = normalizedParagraphs(values, maximumCharacters);
    const text = paragraphs.join(" ");
    const chunks = [];
    let paragraphStart = 0;
    let previous = null;

    paragraphs.forEach(function(paragraph, paragraphIndex) {
      const ranges = chunkParagraph(
        paragraph,
        softLimit,
        hardLimit,
        settings.segmenterFactory,
        language,
      );
      ranges.forEach(function(range, rangeIndex) {
        const chunkText = paragraph.slice(range.start, range.end);
        const spoken = spokenTextWithLocale(chunkText, language, includeEnglishPreprocessing);
        if (!/[\p{L}\p{N}]/u.test(spoken)) return;
        let pauseMs = 0;
        if (chunks.length) {
          pauseMs = rangeIndex === 0 && paragraphIndex > 0
            ? PARAGRAPH_PAUSE_MS
            : pauseAfter(previous.text);
        }
        const chunk = {
          text: chunkText,
          spoken,
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
      const nextUtterance = new Utterance(chunk.spoken || chunk.text);
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
    compareLocators,
    selectionKind,
    relocationProgression,
    locatorSkipDecision,
    mappedIndexAtPoint,
    isSilentSpeechParent,
    visibleText,
    speakableBlocks,
    speakablePrimarySelector: SPEAKABLE_PRIMARY_SELECTOR,
    speakableContainerSelector: SPEAKABLE_CONTAINER_SELECTOR,
    normalizeLocale,
    selectVoice,
    normalizeText,
    spokenText,
    defaults: Object.freeze({
      softLimit: DEFAULT_SOFT_LIMIT,
      hardLimit: DEFAULT_HARD_LIMIT,
      maximumCharacters: DEFAULT_MAX_CHARACTERS,
      continuationPauseMs: CONTINUATION_PAUSE_MS,
      sentencePauseMs: SENTENCE_PAUSE_MS,
      commaPauseMs: COMMA_PAUSE_MS,
      clausePauseMs: CLAUSE_PAUSE_MS,
      parenPauseMs: PAREN_PAUSE_MS,
      dashPauseMs: DASH_PAUSE_MS,
      ellipsisPauseMs: ELLIPSIS_PAUSE_MS,
      emphaticPauseMs: EMPHATIC_PAUSE_MS,
      paragraphPauseMs: PARAGRAPH_PAUSE_MS,
    }),
  };
});
