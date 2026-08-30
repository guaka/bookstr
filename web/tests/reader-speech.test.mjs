import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const BookstrSpeech = require('../reader-speech.js');

function assertPlanIntegrity(plan) {
  let previousEnd = 0;
  for (const chunk of plan.chunks) {
    assert.ok(chunk.text);
    assert.ok(chunk.start >= previousEnd);
    assert.equal(plan.text.slice(chunk.start, chunk.start + chunk.text.length), chunk.text);
    previousEnd = chunk.start + chunk.text.length;
  }
}

test('speech planner keeps the reported final word with its sentence', () => {
  const text = Array.from({ length: 28 }, (_, index) => `word${index}`).join(' ') + '.';
  assert.equal(text.length, 186);

  const plan = BookstrSpeech.buildPlan([text]);

  assert.deepEqual(plan.chunks.map(chunk => chunk.text), [text]);
  assertPlanIntegrity(plan);
});

test('speech planner preserves repeated text, exact offsets, and natural limits', () => {
  const paragraph = [
    'Again and again, the same repeated phrase returns to make offset searches ambiguous;',
    'then a deliberately long continuation keeps adding ordinary complete words until the planner must create another speech chunk without losing anything at all.',
  ].join(' ');

  const plan = BookstrSpeech.buildPlan([paragraph]);

  assert.equal(plan.text, paragraph);
  assert.ok(plan.chunks.length > 1);
  assert.ok(plan.chunks.every(chunk => chunk.text.length <= 240));
  assert.ok(plan.chunks.every(chunk => !/^\s|\s$/.test(chunk.text)));
  assert.notEqual(plan.chunks.at(-1).text.split(/\s+/).length, 1);
  assertPlanIntegrity(plan);
});

test('speech planner uses short continuation, sentence, and paragraph pauses', () => {
  const longSentence = Array.from({ length: 60 }, (_, index) => `part${index}`).join(' ') + '.';
  const plan = BookstrSpeech.buildPlan([
    longSentence + ' A following sentence remains separate because the first sentence is already long.',
    'A new paragraph begins here!',
  ]);
  const pauses = BookstrSpeech.defaults;

  assert.equal(plan.chunks[0].pauseMs, 0);
  assert.ok(plan.chunks.some((chunk, index) => index > 0 && chunk.pauseMs === pauses.continuationPauseMs));
  assert.ok(plan.chunks.some((chunk, index) => index > 0 && chunk.pauseMs === pauses.sentencePauseMs));
  const paragraphStart = plan.text.indexOf('A new paragraph');
  assert.equal(plan.chunks.find(chunk => chunk.start === paragraphStart)?.pauseMs, pauses.paragraphPauseMs);
  assertPlanIntegrity(plan);
});

test('speech planner fallback segmentation keeps punctuation pauses deterministic', () => {
  const plan = BookstrSpeech.buildPlan([
    'A question? An exclamation! A clause; Another thought... The end.',
  ], {
    softLimit: 14,
    hardLimit: 24,
    segmenterFactory: null,
  });

  assert.deepEqual(plan.chunks.map(chunk => chunk.pauseMs), [
    0,
    BookstrSpeech.defaults.emphaticPauseMs,
    BookstrSpeech.defaults.emphaticPauseMs,
    BookstrSpeech.defaults.clausePauseMs,
    BookstrSpeech.defaults.ellipsisPauseMs,
  ]);
  assertPlanIntegrity(plan);
});

test('speech planner chunks clauses on commas, dashes, and parentheses', () => {
  const pauses = BookstrSpeech.defaults;
  const plan = BookstrSpeech.buildPlan([
    'After walking for hours through rain, we reached the old mill by the river -- then the door opened (or so it seemed) without a sound.',
  ]);

  assert.deepEqual(plan.chunks.map(chunk => chunk.text), [
    'After walking for hours through rain,',
    'we reached the old mill by the river --',
    'then the door opened',
    '(or so it seemed)',
    'without a sound.',
  ]);
  assert.deepEqual(plan.chunks.map(chunk => chunk.pauseMs), [
    0,
    pauses.commaPauseMs,
    pauses.dashPauseMs,
    pauses.continuationPauseMs,
    pauses.parenPauseMs,
  ]);
  assertPlanIntegrity(plan);

  const list = BookstrSpeech.buildPlan(['Red, white, and blue flags waved.']);
  assert.deepEqual(list.chunks.map(chunk => chunk.text), ['Red, white, and blue flags waved.']);

  const longLeft = `${'x'.repeat(72)}, then four more spoken words.`;
  const longComma = BookstrSpeech.buildPlan([longLeft]);
  assert.equal(longComma.chunks[0].text.endsWith(','), true);
  assert.equal(longComma.chunks[1].text, 'then four more spoken words.');

  const unmatched = BookstrSpeech.buildPlan(['Wait (this never closes and the rest continues.']);
  assert.equal(unmatched.chunks.length, 1);

  const emDash = BookstrSpeech.buildPlan([
    'Several spoken words on the left—several spoken words on the right.',
  ]);
  assert.deepEqual(emDash.chunks.map(chunk => chunk.text), [
    'Several spoken words on the left—',
    'several spoken words on the right.',
  ]);
  assert.equal(emDash.chunks[1].pauseMs, BookstrSpeech.defaults.dashPauseMs);
});

test('speech planner speaks grouped thousands without comma pauses', () => {
  assert.equal(BookstrSpeech.spokenText('100,000'), '100000');
  assert.equal(BookstrSpeech.spokenText('There were 1,000,000.5 people.'), 'There were 1000000.5 people.');
  assert.equal(BookstrSpeech.spokenText('Wait, then go.'), 'Wait, then go.');
  assert.equal(BookstrSpeech.spokenText('100\u00A0000'), '100000');
  assert.equal(BookstrSpeech.spokenText('100\u202F000'), '100000');
  assert.equal(BookstrSpeech.normalizeText('There were 1,000,000 people.'), 'There were 1,000,000 people.');
  assert.equal(BookstrSpeech.normalizeText('Wait, then go.'), 'Wait, then go.');

  const plan = BookstrSpeech.buildPlan(['There were 100,000 people.']);
  assert.equal(plan.chunks.length, 1);
  assert.equal(plan.chunks[0].text, 'There were 100,000 people.');
  assert.equal(plan.chunks[0].spoken, 'There were 100000 people.');
  assertPlanIntegrity(plan);

  const clause = BookstrSpeech.buildPlan([
    'After collecting 100,000 samples, we left the old mill by the river.',
  ]);
  assert.equal(clause.chunks[0].text, 'After collecting 100,000 samples,');
  assert.equal(clause.chunks[0].spoken, 'After collecting 100000 samples,');

  const hyphenated = BookstrSpeech.buildPlan(['A well-known fact remains well-known.']);
  assert.equal(hyphenated.chunks[0].text, 'A well-known fact remains well-known.');

  const thousandsBoundary = BookstrSpeech.buildPlan([
    `${'word '.repeat(22)}counted 1,000 extra ${'word '.repeat(22)}.`,
  ], { softLimit: 80, hardLimit: 120, segmenterFactory: null });
  assert.ok(thousandsBoundary.chunks.some(chunk => chunk.text.includes('1,000')));
  assertPlanIntegrity(thousandsBoundary);

  const closingParen = BookstrSpeech.buildPlan([
    `${'w'.repeat(70)}) ${'x'.repeat(180)}`,
  ], { softLimit: 80, hardLimit: 120, segmenterFactory: null });
  assert.ok(closingParen.chunks.some(chunk => chunk.text.includes(')')));
  assertPlanIntegrity(closingParen);
});

test('speech planner omits footnote markers from spoken text', () => {
  assert.equal(BookstrSpeech.spokenText('He left[1] at dawn.'), 'He left at dawn.');
  assert.equal(BookstrSpeech.spokenText('He left\u00B9 at dawn.'), 'He left at dawn.');
  assert.equal(BookstrSpeech.spokenText('See chapter 12.'), 'See chapter 12.');
  assert.equal(BookstrSpeech.spokenText('word(1) next'), 'word next');
  assert.equal(BookstrSpeech.spokenText('(1) First item'), '(1) First item');
  assert.equal(BookstrSpeech.spokenText(''), '');
  assert.equal(BookstrSpeech.visibleText(null), '');
  assert.equal(BookstrSpeech.isSilentSpeechParent(null), false);
  assert.equal(BookstrSpeech.isSilentSpeechParent({
    closest() { return null; },
    getAttribute() { return ''; },
    className: '',
  }), false);
  assert.equal(BookstrSpeech.isSilentSpeechParent({
    closest(selector) { return String(selector).includes('sup') ? this : null; },
    getAttribute() { return ''; },
    className: '',
  }), true);
  assert.equal(BookstrSpeech.isSilentSpeechParent({
    closest(selector) { return selector === 'a' ? this : null; },
    getAttribute(name) { return name === 'epub:type' ? 'noteref' : ''; },
    className: '',
  }), true);
  assert.equal(BookstrSpeech.isSilentSpeechParent({
    closest(selector) { return selector === 'a' ? this : null; },
    getAttribute() { return ''; },
    className: 'footnote-ref',
  }), true);
  assert.equal(BookstrSpeech.isSilentSpeechParent({
    closest(selector) { return selector === 'a' ? this : null; },
    getAttribute() { return ''; },
    className: 'regular-link',
  }), false);
  assert.equal(BookstrSpeech.visibleText({ ownerDocument: {} }), '');
  const document = {
    createTreeWalker() {
      const nodes = [
        { parentElement: { closest() { return null; }, getAttribute() { return ''; }, className: '' }, nodeValue: 'Hello ' },
        { parentElement: { closest(selector) { return String(selector).includes('sup') ? this : null; }, getAttribute() { return ''; }, className: '' }, nodeValue: '1' },
        { parentElement: { closest() { return null; }, getAttribute() { return ''; }, className: '' }, nodeValue: 'world' },
      ];
      let index = 0;
      return {
        nextNode() { return index < nodes.length ? nodes[index++] : null; },
      };
    },
  };
  assert.equal(BookstrSpeech.visibleText({ ownerDocument: document }), 'Hello world');
});

test('relocation progression prefers generated locations over a stale viewport', () => {
  assert.equal(BookstrSpeech.relocationProgression(0.42, 0.1), 0.42);
  assert.equal(BookstrSpeech.relocationProgression(1.4, 0.1), 1);
  assert.equal(BookstrSpeech.relocationProgression(Number.NaN, 0.25), 0.25);
  assert.equal(BookstrSpeech.relocationProgression(undefined, Number.NaN), null);
  assert.equal(BookstrSpeech.relocationProgression(0, 0.9), 0);
});

test('selection kind matches copy, word, and mark actions', () => {
  assert.equal(BookstrSpeech.selectionKind('   '), 'empty');
  assert.equal(BookstrSpeech.selectionKind('hello'), 'words');
  assert.equal(BookstrSpeech.selectionKind("don't worry"), 'words');
  assert.equal(BookstrSpeech.selectionKind('one two three'), 'mark');
  assert.equal(BookstrSpeech.selectionKind('hello 123'), 'mark');
});

test('speech locators skip completed blocks and resume inside the current one', () => {
  const order = { a: 1, b: 2, c: 3 };
  const compare = (left, right) => order[left] - order[right];
  assert.equal(BookstrSpeech.locatorSkipDecision('a', 'a', '', compare), 'include');
  assert.equal(BookstrSpeech.locatorSkipDecision('a', 'a', 'b', compare), 'skip');
  assert.equal(BookstrSpeech.locatorSkipDecision('b', 'c', 'b', compare), 'include');
  assert.equal(BookstrSpeech.locatorSkipDecision('a', 'c', 'b', compare), 'resume');
  assert.equal(BookstrSpeech.locatorSkipDecision('', '', 'z', compare), 'include');
  assert.equal(BookstrSpeech.compareLocators('', '', compare), 0);
  assert.equal(BookstrSpeech.compareLocators('b', 'a', compare), 1);
  assert.equal(BookstrSpeech.compareLocators('', 'a', compare), -1);
  assert.equal(BookstrSpeech.compareLocators('a', '', compare), 1);
  assert.equal(BookstrSpeech.compareLocators('same', 'same'), 0);
  assert.equal(BookstrSpeech.compareLocators('m', 'z', () => Number.NaN), -1);
  assert.equal(BookstrSpeech.compareLocators('z', 'm', () => Number.NaN), 1);
  const node = { id: 'n' };
  const other = { id: 'o' };
  const positions = [
    { node, start: 0, end: 1 },
    { node, start: 1, end: 2 },
    { node, start: 2, end: 3 },
  ];
  assert.equal(BookstrSpeech.mappedIndexAtPoint(positions, node, 0), 0);
  assert.equal(BookstrSpeech.mappedIndexAtPoint(positions, node, 2), 2);
  assert.equal(BookstrSpeech.mappedIndexAtPoint(positions, node, 3), 3);
  assert.equal(BookstrSpeech.mappedIndexAtPoint(positions, node, 1), 1);
  assert.equal(BookstrSpeech.mappedIndexAtPoint([{ node, start: 2, end: 5 }], node, 4), 0);
  assert.equal(BookstrSpeech.mappedIndexAtPoint(positions, other, 1), 0);
  assert.equal(BookstrSpeech.mappedIndexAtPoint([], node, 0), 0);
});

test('speech planner recovers from a failing platform segmenter', () => {
  class FailingSegmenter {
    constructor() { throw new Error('segmenter unavailable'); }
  }
  const plan = BookstrSpeech.buildPlan(['Fallback one. Fallback two!'], {
    softLimit: 12,
    hardLimit: 20,
    segmenterFactory: FailingSegmenter,
  });

  assert.deepEqual(plan.chunks.map(chunk => chunk.text), ['Fallback one.', 'Fallback two!']);
  assertPlanIntegrity(plan);
});

test('speech planner joins short sentences and rebalances a one-word tail', () => {
  assert.deepEqual(
    BookstrSpeech.buildPlan(['One. Two.']).chunks.map(chunk => chunk.text),
    ['One. Two.'],
  );

  const rebalanced = BookstrSpeech.buildPlan(['aaaaa bbbbb ccccc ddddd'], {
    softLimit: 18,
    hardLimit: 20,
    segmenterFactory: null,
  });
  assert.deepEqual(rebalanced.chunks.map(chunk => chunk.text), [
    'aaaaa bbbbb',
    'ccccc ddddd',
  ]);
  assertPlanIntegrity(rebalanced);

  const sentenceTail = `word `.repeat(47) + 'end. Tail.';
  const sentencePlan = BookstrSpeech.buildPlan([sentenceTail]);
  assert.equal(sentencePlan.chunks.at(-1).text, 'end. Tail.');
  assert.notEqual(sentencePlan.chunks.at(-1).text.split(/\s+/).length, 1);
  assertPlanIntegrity(sentencePlan);
});

test('speech planner hard-splits only an overlong unbroken token', () => {
  const text = 'x'.repeat(501);
  const plan = BookstrSpeech.buildPlan([text]);

  assert.equal(plan.text, text);
  assert.deepEqual(plan.chunks.map(chunk => chunk.text.length), [240, 240, 21]);
  assert.ok(plan.chunks.every(chunk => chunk.text.length <= 240));
  assertPlanIntegrity(plan);
});

test('speech planner caps input at a whole-word boundary and normalizes locales', () => {
  const plan = BookstrSpeech.buildPlan(['one two three four'], { maximumCharacters: 12 });

  assert.equal(plan.text, 'one two');
  assert.equal(BookstrSpeech.normalizeLocale('pt'), 'pt-PT');
  assert.equal(BookstrSpeech.normalizeLocale(' PT_br '), 'pt-BR');
  assert.equal(BookstrSpeech.normalizeLocale(''), 'en');
});

test('speech voice selection only uses an explicitly chosen installed voice', () => {
  const voices = [
    { name: 'Kokoro Heart', voiceURI: 'com.example.kokoro.heart', lang: 'en-US', localService: true },
    { name: 'Tugão', voiceURI: 'org.piper.pt-PT-tugao', lang: 'pt-PT', localService: true },
  ];

  assert.equal(BookstrSpeech.selectVoice(voices, 'en', ''), null);
  assert.equal(BookstrSpeech.selectVoice(voices, 'en', 'com.example.kokoro.heart'), voices[0]);
  assert.equal(BookstrSpeech.selectVoice(voices, 'pt', 'tugão'), voices[1]);
  assert.equal(BookstrSpeech.selectVoice(voices, 'en', 'tugão'), null);
  assert.equal(BookstrSpeech.selectVoice(voices, 'pt', 'missing voice'), null);
});

function playerHarness({ voices = [] } = {}) {
  let clock = 1000;
  let nextTimerID = 1;
  const timers = new Map();
  const states = [];
  const spoken = [];
  const synthesis = {
    cancelCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    speak(utterance) { spoken.push(utterance); },
    cancel() { this.cancelCalls += 1; },
    pause() { this.pauseCalls += 1; },
    resume() { this.resumeCalls += 1; },
    getVoices() { return voices; },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
      this.rate = 0;
      this.onend = null;
      this.onerror = null;
    }
  }
  const player = BookstrSpeech.createPlayer({
    speechSynthesis: synthesis,
    Utterance,
    now: () => clock,
    setTimeout(callback, delay) {
      const id = nextTimerID++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    onStateChange(state) { states.push(state); },
  });
  return {
    player,
    synthesis,
    spoken,
    states,
    timers,
    advance(milliseconds) { clock += milliseconds; },
    runTimer() {
      const [id, timer] = timers.entries().next().value || [];
      assert.ok(timer, 'Expected a pending speech timer');
      timers.delete(id);
      clock += timer.delay;
      timer.callback();
    },
  };
}

test('speech player speaks sequential chunks with language and timed pauses', () => {
  const kokoro = { name: 'Kokoro Heart', voiceURI: 'kokoro-heart', lang: 'en-US' };
  const harness = playerHarness({ voices: [kokoro] });
  const plan = {
    chunks: [
      { text: 'First.', start: 0, pauseMs: 0 },
      { text: 'Second.', start: 7, pauseMs: 400 },
      { text: 'Third.', start: 15, pauseMs: 35 },
    ],
  };

  assert.equal(harness.player.start(plan, { language: 'pt', rate: 1, voiceIdentifier: 'kokoro-heart' }), true);
  assert.equal(harness.player.state, 'playing');
  assert.equal(harness.spoken[0].text, 'First.');
  assert.equal(harness.spoken[0].lang, 'pt-PT');
  assert.equal(harness.spoken[0].rate, 1);
  assert.equal(harness.spoken[0].voice, undefined, 'a mismatched English voice is not used for Portuguese');

  harness.spoken[0].onend();
  assert.equal(harness.spoken.length, 1);
  assert.equal([...harness.timers.values()][0].delay, 400);
  harness.runTimer();
  assert.equal(harness.spoken[1].text, 'Second.');
  harness.spoken[1].onend();
  assert.equal([...harness.timers.values()][0].delay, 35);
  harness.runTimer();
  harness.spoken[2].onend();

  assert.equal(harness.player.state, 'stopped');
  assert.deepEqual(harness.states, ['playing', 'stopped']);
});

test('speech player speaks grouped thousands from the spoken field', () => {
  const harness = playerHarness();
  assert.equal(harness.player.start({
    chunks: [{ text: '100,000', spoken: '100000', pauseMs: 0 }],
  }), true);
  assert.equal(harness.spoken[0].text, '100000');
});

test('speech player pauses and resumes both utterances and pending delays', () => {
  const harness = playerHarness();
  harness.player.start({ chunks: [
    { text: 'First.', pauseMs: 0 },
    { text: 'Second.', pauseMs: 400 },
  ] });

  assert.equal(harness.player.pause(), true);
  assert.equal(harness.synthesis.pauseCalls, 1);
  assert.equal(harness.player.resume(), true);
  assert.equal(harness.synthesis.resumeCalls, 1);

  harness.spoken[0].onend();
  harness.advance(125);
  assert.equal(harness.player.pause(), true);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.player.resume(), true);
  assert.equal([...harness.timers.values()][0].delay, 275);
  harness.runTimer();
  assert.equal(harness.spoken[1].text, 'Second.');
});

test('speech player advances immediately for a zero delay', () => {
  const harness = playerHarness();
  harness.player.start({ chunks: [
    { text: 'First.', pauseMs: 0 },
    { text: 'Second.', pauseMs: 0 },
  ] });
  harness.spoken[0].onend();
  assert.equal(harness.spoken[1].text, 'Second.');
});

test('speech player stop and errors reject stale callbacks without duplicating speech', () => {
  const harness = playerHarness();
  harness.player.start({ chunks: [
    { text: 'Old.', pauseMs: 0 },
    { text: 'Never.', pauseMs: 10 },
  ] });
  const stale = harness.spoken[0];
  assert.equal(harness.player.stop(), true);
  stale.onend();
  assert.equal(harness.spoken.length, 1);

  harness.player.start({ chunks: [{ text: 'Current.', pauseMs: 0 }] }, { language: 'fr-fr' });
  const current = harness.spoken[1];
  assert.equal(current.lang, 'fr-FR');
  current.onerror();
  assert.equal(harness.player.state, 'stopped');
  assert.equal(harness.player.pause(), false);
  assert.equal(harness.player.resume(), false);
});

test('speech player reports unsupported or empty plans without starting', () => {
  const unsupported = BookstrSpeech.createPlayer({});
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.start({ chunks: [{ text: 'No voice.' }] }), false);

  const harness = playerHarness();
  assert.equal(harness.player.start({ chunks: [] }), false);
  assert.equal(harness.spoken.length, 0);
});

test('speech planner and player cover defensive platform fallbacks', () => {
  assert.equal(BookstrSpeech.buildPlan('single value').text, 'single value');
  assert.equal(BookstrSpeech.buildPlan(['', 'kept'], { maximumCharacters: 4 }).text, 'kept');
  assert.equal(BookstrSpeech.normalizeLocale('zh-hant'), 'zh-hant');
  assert.equal(BookstrSpeech.selectVoice('not an array', 'en', 'voice'), null);
  assert.equal(BookstrSpeech.selectVoice([{ lang: 'en-US' }], 'en', 'voice'), null);

  const objectSegmenter = {
    segment() {
      return [{ segment: 'Object sentence.' }, { segment: '   ' }];
    },
  };
  assert.deepEqual(
    BookstrSpeech.buildPlan(['Object sentence.'], { segmenterFactory: objectSegmenter }).chunks.map(chunk => chunk.text),
    ['Object sentence.'],
  );
  const emptySegmenter = { segment() { return []; } };
  assert.equal(BookstrSpeech.buildPlan(['Fallback text'], { segmenterFactory: emptySegmenter }).chunks[0].text, 'Fallback text');

  const spoken = [];
  const synthesis = {
    speak(utterance) { spoken.push(utterance); },
    cancel() {},
    getVoices() { return [{ name: 'English voice', voiceURI: 'voice', lang: 'en-US' }]; },
  };
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const player = BookstrSpeech.createPlayer({
    speechSynthesis: synthesis,
    Utterance,
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  });
  assert.equal(player.stop(), false);
  assert.equal(player.start({ chunks: [null, { text: ' ' }, { text: 'Current.' }] }, {
    language: 'en-US', rate: 20, voiceIdentifier: 'voice',
  }), true);
  assert.equal(spoken[0].rate, 10);
  assert.deepEqual(spoken[0].voice, synthesis.getVoices()[0]);
  spoken[0].onerror();
  assert.equal(player.state, 'stopped');
});

test('speech planner covers empty, truncated, punctuation, and segmenter-mismatch inputs', () => {
  assert.deepEqual(BookstrSpeech.buildPlan([]), { text: '', chunks: [] });
  assert.equal(BookstrSpeech.buildPlan(['one', 'two'], { maximumCharacters: 1 }).text, 'o');
  assert.equal(BookstrSpeech.buildPlan(['a', 'b'], { maximumCharacters: 2 }).text, 'a');
  assert.deepEqual(BookstrSpeech.buildPlan(['---']).chunks, []);
  assert.equal(
    BookstrSpeech.buildPlan(['Actual text.'], {
      segmenterFactory: { segment() { return [{ segment: 'Different text.' }]; } },
    }).chunks[0].text,
    'Actual text.',
  );
  const punctuationPlan = BookstrSpeech.buildPlan(['left --- right, then continue; here it ends.'], {
    softLimit: 10,
    hardLimit: 18,
    segmenterFactory: null,
  });
  assert.ok(punctuationPlan.chunks.length > 1);
  assertPlanIntegrity(punctuationPlan);
});

test('speech player tolerates missing optional synthesis APIs and stale timers', () => {
  const spoken = [];
  const timers = [];
  const synthesis = {
    speak(utterance) { spoken.push(utterance); },
    cancel() {},
  };
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const player = BookstrSpeech.createPlayer({
    speechSynthesis: synthesis,
    Utterance,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
  });

  assert.equal(player.start({ chunks: [
    { text: 'First.', pauseMs: 0 },
    { text: 'Second.', pauseMs: 25 },
  ] }), true);
  assert.equal(player.pause(), true);
  assert.equal(player.resume(), true);
  spoken[0].onend();
  const pending = timers.at(-1);
  assert.equal(player.stop(), true);
  pending.callback();
  assert.equal(spoken.length, 1);
  assert.equal(player.stop(), false);
});

test('speech module works without CommonJS, Intl, or host timers', async () => {
  const source = await readFile(new URL('../reader-speech.js', import.meta.url), 'utf8');
  const context = { Intl: undefined };
  vm.runInNewContext(source, context);
  const api = context.BookstrSpeech;
  assert.equal(typeof api.buildPlan, 'function');
  assert.equal(api.buildPlan(['Fallback sentence.']).chunks[0].text, 'Fallback sentence.');

  class Utterance {
    constructor(text) { this.text = text; }
  }
  const spoken = [];
  const player = api.createPlayer({
    speechSynthesis: { speak(utterance) { spoken.push(utterance); } },
    Utterance,
  });
  assert.equal(player.start({ chunks: [
    { text: 'First.', pauseMs: 0 },
    { text: 'Second.', pauseMs: 10 },
  ] }), true);
  assert.equal(spoken.length, 1);
  spoken[0].onend();
  assert.equal(spoken.length, 2);

  const noRoot = { globalThis: undefined };
  vm.runInNewContext(`(function() { "use strict"; ${source} }).call(null)`, noRoot);
  new Function('globalThis', `"use strict"; ${source}`)(undefined);
});

test('speech player accepts an omitted configuration object', () => {
  const player = BookstrSpeech.createPlayer();
  assert.equal(player.supported, false);
  assert.equal(player.start(null), false);
  assert.equal(player.stop(), false);
});

test('speech planner handles punctuation after parenthetical phrases and empty DOM text nodes', () => {
  for (const suffix of ['"...', '!']) {
    const plan = BookstrSpeech.buildPlan([`Before (inside)${suffix} after.`]);
    assert.ok(plan.chunks.length > 1);
    assertPlanIntegrity(plan);
  }
  const document = {
    createTreeWalker() {
      let index = 0;
      const nodes = [
        { parentElement: { closest() { return null; } }, nodeValue: null },
        { parentElement: { closest() { return null; } }, nodeValue: 'visible' },
      ];
      return { nextNode() { return index < nodes.length ? nodes[index++] : null; } };
    },
  };
  assert.equal(BookstrSpeech.visibleText({ ownerDocument: document }), 'visible');

  assert.equal(BookstrSpeech.isSilentSpeechParent({
    closest(selector) { return selector === 'a' ? this : null; },
    getAttribute(name) { return name === 'role' ? 'footnote' : ''; },
    className: '',
  }), true);
  for (const text of [
    'abcdefghij,word with no comma boundary and enough words to split later.',
    'abcdefghij;word with no clause boundary and enough words to split later.',
    'abcdefghij:word with no colon boundary and enough words to split later.',
    'one --- two three four five six seven eight nine ten.',
    'one - two three four five six seven eight nine ten.',
  ]) {
    assertPlanIntegrity(BookstrSpeech.buildPlan([text], { softLimit: 10, hardLimit: 20, segmenterFactory: null }));
  }
});
