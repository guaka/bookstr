import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
import type { SpeechApi, SpeechBuildOptions, SpeechPlan, SpeechPlayerConfiguration } from '../src/reader-speech.js';
const BookstrSpeech = require('../reader-speech.js') as SpeechApi;

/** Keep deliberately incomplete DOM and VM doubles at the test boundary. */
function fixture<T>(value: unknown): T {
  return value as T;
}

function speechPlan(value: unknown): SpeechPlan {
  return fixture<SpeechPlan>(value);
}

function pause(name: string): number {
  const value = BookstrSpeech.defaults[name];
  assert.notEqual(value, undefined, `Expected speech pause ${name}`);
  return value!;
}

function navigationBlock(value: unknown): boolean {
  return BookstrSpeech.isNavigationSpeechBlock(fixture<Element>(value));
}

function silentParent(value: unknown): boolean {
  return BookstrSpeech.isSilentSpeechParent(fixture<Element>(value));
}

function visibleText(value: unknown): string {
  return BookstrSpeech.visibleText(fixture<Element>(value));
}

function speakableBlocks(value: unknown): Element[] {
  return BookstrSpeech.speakableBlocks(fixture<Document>(value));
}

function openingNavigation(value: unknown, earlySection: boolean): boolean {
  return BookstrSpeech.isOpeningNavigationDocument(fixture<Document>(value), earlySection);
}

function buildPlan(values: unknown, options?: unknown): SpeechPlan {
  return BookstrSpeech.buildPlan(values, fixture<SpeechBuildOptions | undefined>(options));
}

function selectVoice(voices: unknown, language: unknown, identifier: unknown): SpeechSynthesisVoice | null {
  return BookstrSpeech.selectVoice(fixture<readonly SpeechSynthesisVoice[] | null>(voices), language, identifier);
}

class SpeechUtteranceFixture {
  text: string;
  lang = '';
  rate = 0;
  onend: () => void = () => {};
  onerror: () => void = () => {};
  voice?: SpeechSynthesisVoice;

  constructor(text = '') { this.text = text; }
}

function createPlayer(configuration?: unknown, api: SpeechApi = BookstrSpeech) {
  const player = api.createPlayer(fixture<SpeechPlayerConfiguration | undefined>(configuration));
  return {
    get state() { return player.state; },
    get supported() { return player.supported; },
    start(plan: unknown, options?: { language?: string; rate?: number; voiceIdentifier?: string }) {
      return player.start(speechPlan(plan), options);
    },
    pause: () => player.pause(),
    resume: () => player.resume(),
    stop: () => player.stop(),
  };
}

test('navigation detection tolerates partial DOM nodes without attribute access', () => {
  assert.equal(navigationBlock(fixture<Element>({ localName: 'p', parentElement: null })), false);
  assert.equal(navigationBlock(fixture<Element>({ localName: 'p', parentElement: { localName: 'nav' } })), true);
});

function assertPlanIntegrity(plan: SpeechPlan): void {
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

  const plan = buildPlan([text]);

  assert.deepEqual(plan.chunks.map(chunk => chunk.text), [text]);
  assertPlanIntegrity(plan);
});

test('speech planner preserves repeated text, exact offsets, and natural limits', () => {
  const paragraph = [
    'Again and again, the same repeated phrase returns to make offset searches ambiguous;',
    'then a deliberately long continuation keeps adding ordinary complete words until the planner must create another speech chunk without losing anything at all.',
  ].join(' ');

  const plan = buildPlan([paragraph]);

  assert.equal(plan.text, paragraph);
  assert.ok(plan.chunks.length > 1);
  assert.ok(plan.chunks.every(chunk => chunk.text.length <= 240));
  assert.ok(plan.chunks.every(chunk => !/^\s|\s$/.test(chunk.text)));
  assert.notEqual(plan.chunks.at(-1)!.text.split(/\s+/).length, 1);
  assertPlanIntegrity(plan);
});

test('speech planner uses short continuation, sentence, and paragraph pauses', () => {
  const longSentence = Array.from({ length: 60 }, (_, index) => `part${index}`).join(' ') + '.';
  const plan = buildPlan([
    longSentence + ' A following sentence remains separate because the first sentence is already long.',
    'A new paragraph begins here!',
  ]);
  const pauses = BookstrSpeech.defaults;

  assert.equal(plan.chunks[0]!.pauseMs, 0);
  assert.ok(plan.chunks.some((chunk, index) => index > 0 && chunk.pauseMs === pauses.continuationPauseMs));
  assert.ok(plan.chunks.some((chunk, index) => index > 0 && chunk.pauseMs === pauses.sentencePauseMs));
  const paragraphStart = plan.text.indexOf('A new paragraph');
  assert.equal(plan.chunks.find(chunk => chunk.start === paragraphStart)?.pauseMs, pauses.paragraphPauseMs);
  assertPlanIntegrity(plan);
});

test('speech planner fallback segmentation keeps punctuation pauses deterministic', () => {
  const plan = buildPlan([
    'A question? An exclamation! A clause; Another thought... The end.',
  ], {
    softLimit: 14,
    hardLimit: 24,
    segmenterFactory: null,
  });

  assert.deepEqual(plan.chunks.map(chunk => chunk.pauseMs), [
    0,
    pause('emphaticPauseMs'),
    pause('emphaticPauseMs'),
    pause('clausePauseMs'),
    pause('ellipsisPauseMs'),
  ]);
  assertPlanIntegrity(plan);
});

test('speech planner chunks clauses on commas, dashes, and parentheses', () => {
  const pauses = BookstrSpeech.defaults;
  const plan = buildPlan([
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

  const list = buildPlan(['Red, white, and blue flags waved.']);
  assert.deepEqual(list.chunks.map(chunk => chunk.text), ['Red, white, and blue flags waved.']);

  const longLeft = `${'x'.repeat(72)}, then four more spoken words.`;
  const longComma = buildPlan([longLeft]);
  assert.equal(longComma.chunks[0]!.text.endsWith(','), true);
  assert.equal(longComma.chunks[1]!.text, 'then four more spoken words.');

  const unmatched = buildPlan(['Wait (this never closes and the rest continues.']);
  assert.equal(unmatched.chunks.length, 1);

  const emDash = buildPlan([
    'Several spoken words on the left—several spoken words on the right.',
  ]);
  assert.deepEqual(emDash.chunks.map(chunk => chunk.text), [
    'Several spoken words on the left—',
    'several spoken words on the right.',
  ]);
  assert.equal(emDash.chunks[1]!.pauseMs, pause('dashPauseMs'));
});

test('speech planner speaks grouped thousands without comma pauses', () => {
  assert.equal(BookstrSpeech.spokenText('100,000'), '100000');
  assert.equal(BookstrSpeech.spokenText('There were 1,000,000.5 people.'), 'There were 1000000.5 people.');
  assert.equal(BookstrSpeech.spokenText('Wait, then go.'), 'Wait, then go.');
  assert.equal(BookstrSpeech.spokenText('100\u00A0000'), '100000');
  assert.equal(BookstrSpeech.spokenText('100\u202F000'), '100000');
  assert.equal(BookstrSpeech.normalizeText('There were 1,000,000 people.'), 'There were 1,000,000 people.');
  assert.equal(BookstrSpeech.normalizeText('Wait, then go.'), 'Wait, then go.');
  assert.equal(BookstrSpeech.normalizeText('October 9, 1983'), 'October 9, 1983');
  assert.equal(BookstrSpeech.normalizeText('1983, 1990'), '1983, 1990');
  assert.equal(BookstrSpeech.spokenText('October 9, 1983'), 'October 9, 1983');
  assert.equal(BookstrSpeech.spokenText('1983, 1990'), '1983, 1990');

  const plan = buildPlan(['There were 100,000 people.']);
  assert.equal(plan.chunks.length, 1);
  assert.equal(plan.chunks[0]!.text, 'There were 100,000 people.');
  assert.equal(plan.chunks[0]!.spoken, 'There were 100000 people.');
  assertPlanIntegrity(plan);

  const clause = buildPlan([
    'After collecting 100,000 samples, we left the old mill by the river.',
  ]);
  assert.equal(clause.chunks[0]!.text, 'After collecting 100,000 samples,');
  assert.equal(clause.chunks[0]!.spoken, 'After collecting 100000 samples,');

  const hyphenated = buildPlan(['A well-known fact remains well-known.']);
  assert.equal(hyphenated.chunks[0]!.text, 'A well-known fact remains well-known.');

  const thousandsBoundary = buildPlan([
    `${'word '.repeat(22)}counted 1,000 extra ${'word '.repeat(22)}.`,
  ], { softLimit: 80, hardLimit: 120, segmenterFactory: null });
  assert.ok(thousandsBoundary.chunks.some(chunk => chunk.text.includes('1,000')));
  assertPlanIntegrity(thousandsBoundary);

  const closingParen = buildPlan([
    `${'w'.repeat(70)}) ${'x'.repeat(180)}`,
  ], { softLimit: 80, hardLimit: 120, segmenterFactory: null });
  assert.ok(closingParen.chunks.some(chunk => chunk.text.includes(')')));
  assertPlanIntegrity(closingParen);
});

test('speech planner keeps date and number-list commas distinct for English TTS', () => {
  const pauses = BookstrSpeech.defaults;
  const date = buildPlan(['October 9, 1983'], {
    language: 'en-US',
    normalizeEnglish: true,
    segmenterFactory: null,
  });
  assert.deepEqual(date.chunks.map(chunk => chunk.text), ['October 9,', '1983']);
  assert.deepEqual(date.chunks.map(chunk => chunk.spoken), ['October 9,', 'nineteen eighty-three']);
  assert.equal(date.chunks[1]!.pauseMs, pauses.commaPauseMs);
  assertPlanIntegrity(date);

  const years = buildPlan(['1983, 1990'], {
    language: 'en-US',
    normalizeEnglish: true,
    segmenterFactory: null,
  });
  assert.deepEqual(years.chunks.map(chunk => chunk.text), ['1983,', '1990']);
  assert.deepEqual(years.chunks.map(chunk => chunk.spoken), [
    'nineteen eighty-three,',
    'nineteen ninety',
  ]);
  assert.equal(years.chunks[1]!.pauseMs, pauses.commaPauseMs);
  assertPlanIntegrity(years);

  const century = buildPlan(['In 1900 the city grew.'], {
    language: 'en-US',
    normalizeEnglish: true,
    segmenterFactory: null,
  });
  assert.match(century.chunks[0]!.spoken, /nineteen hundred/);
  assert.doesNotMatch(century.chunks[0]!.spoken, /thousand/);

  const yearWords = [
    ['In 2000 it began.', /two thousand/] as const,
    ['In 2005 it began.', /two thousand five/] as const,
    ['In 2015 it began.', /twenty fifteen/] as const,
    ['In 1000 it began.', /one thousand/] as const,
    ['In 1100 it began.', /eleven hundred/] as const,
  ];
  for (const [source, pattern] of yearWords) {
    const plan = buildPlan([source], {
      language: 'en-US',
      normalizeEnglish: true,
      segmenterFactory: null,
    });
    assert.match(plan.chunks.map(chunk => chunk.spoken).join(' '), pattern);
    assert.match(plan.chunks.map(chunk => chunk.text).join(' '), /\d{4}/);
  }
});

test('speech planner keeps sentence pauses between short sentences', () => {
  const plan = buildPlan(['End of sentence. Next one starts.'], {
    segmenterFactory: null,
  });
  assert.deepEqual(plan.chunks.map(chunk => chunk.text), [
    'End of sentence.',
    'Next one starts.',
  ]);
  assert.equal(plan.chunks[1]!.pauseMs, pause('sentencePauseMs'));
  assert.ok(pause('sentencePauseMs') > pause('commaPauseMs'));
  assertPlanIntegrity(plan);
});

test('English preprocessing preserves source text, offsets, and semantic hyphens', () => {
  const paragraphs = [
    'A well-known fact. Next word…',
    'The range is 5-10 and the date is 2026-09-14.',
  ];
  const plan = buildPlan(paragraphs, {
    language: 'en-US',
    normalizeEnglish: true,
    segmenterFactory: null,
  });

  assert.equal(plan.text, paragraphs.join(' '));
  assert.equal(plan.chunks.map(chunk => chunk.text).join(' '), paragraphs.join(' '));
  assert.match(plan.chunks[0]!.spoken, /well-known/);
  assert.match(plan.chunks.at(-1)!.spoken, /5-10/);
  assert.match(plan.chunks.at(-1)!.spoken, /2026-09-14/);
  assertPlanIntegrity(plan);
});

test('English preprocessing normalizes punctuation dashes only in spoken text', () => {
  const source = 'Wait—the API costs $12 and is 50% ready.';
  const plan = buildPlan([source], {
    language: 'en',
    normalizeEnglish: true,
    segmenterFactory: null,
  });

  assert.equal(plan.text, source);
  assert.equal(plan.chunks[0]!.text, 'Wait—');
  assert.equal(plan.chunks[0]!.spoken, 'Wait --');
  assert.match(plan.chunks[1]!.spoken, /A P I costs 12 dollars and is 50 percent ready\./);
  assert.doesNotMatch(plan.chunks.map(chunk => chunk.spoken).join(' '), /-- --/);
  assertPlanIntegrity(plan);
});

test('speech planner omits footnote markers from spoken text', () => {
  assert.equal(BookstrSpeech.spokenText('He left[1] at dawn.'), 'He left at dawn.');
  assert.equal(BookstrSpeech.spokenText('He left\u00B9 at dawn.'), 'He left at dawn.');
  assert.equal(BookstrSpeech.spokenText('See chapter 12.'), 'See chapter 12.');
  assert.equal(BookstrSpeech.spokenText('word(1) next'), 'word next');
  assert.equal(BookstrSpeech.spokenText('(1) First item'), '(1) First item');
  assert.equal(BookstrSpeech.spokenText(''), '');
  assert.equal(visibleText(null), '');
  assert.equal(silentParent(null), false);
  assert.equal(silentParent({
    closest() { return null; },
    getAttribute() { return ''; },
    className: '',
  }), false);
  assert.equal(silentParent({
    closest(selector: string) { return String(selector).includes('sup') ? this : null; },
    getAttribute() { return ''; },
    className: '',
  }), true);
  assert.equal(silentParent({
    closest(selector: string) { return selector === 'a' ? this : null; },
    getAttribute(name: string) { return name === 'epub:type' ? 'noteref' : ''; },
    className: '',
  }), true);
  assert.equal(silentParent({
    closest(selector: string) { return selector === 'a' ? this : null; },
    getAttribute() { return ''; },
    className: 'footnote-ref',
  }), true);
  assert.equal(silentParent({
    closest(selector: string) { return selector === 'a' ? this : null; },
    getAttribute() { return ''; },
    className: 'regular-link',
  }), false);
  assert.equal(visibleText({ ownerDocument: {} }), '');
  const document = {
    createTreeWalker() {
      const nodes = [
        { parentElement: { closest() { return null; }, getAttribute() { return ''; }, className: '' }, nodeValue: 'Hello ' },
        { parentElement: { closest(selector: string) { return String(selector).includes('sup') ? this : null; }, getAttribute() { return ''; }, className: '' }, nodeValue: '1' },
        { parentElement: { closest() { return null; }, getAttribute() { return ''; }, className: '' }, nodeValue: 'world' },
      ];
      let index = 0;
      return {
        nextNode() { return index < nodes.length ? nodes[index++] ?? null : null; },
      };
    },
  };
  assert.equal(visibleText({ ownerDocument: document }), 'Hello world');
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
  const compare = (left: string, right: string) => order[left as keyof typeof order] - order[right as keyof typeof order];
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
  const node = fixture<Node>({ id: 'n' });
  const other = fixture<Node>({ id: 'o' });
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
  const plan = buildPlan(['Fallback one. Fallback two!'], {
    softLimit: 12,
    hardLimit: 20,
    segmenterFactory: FailingSegmenter,
  });

  assert.deepEqual(plan.chunks.map(chunk => chunk.text), ['Fallback one.', 'Fallback two!']);
  assertPlanIntegrity(plan);
});

test('speech planner keeps short sentences separate and rebalances a one-word tail', () => {
  assert.deepEqual(
    buildPlan(['One. Two.']).chunks.map(chunk => chunk.text),
    ['One.', 'Two.'],
  );
  assert.equal(
    buildPlan(['One. Two.']).chunks[1]!.pauseMs,
    pause('sentencePauseMs'),
  );

  const rebalanced = buildPlan(['aaaaa bbbbb ccccc ddddd'], {
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
  const sentencePlan = buildPlan([sentenceTail]);
  assert.equal(sentencePlan.chunks.at(-1)!.text, 'Tail.');
  assert.equal(sentencePlan.chunks.at(-2)!.text.endsWith('end.'), true);
  assertPlanIntegrity(sentencePlan);
});

test('speech planner hard-splits only an overlong unbroken token', () => {
  const text = 'x'.repeat(501);
  const plan = buildPlan([text]);

  assert.equal(plan.text, text);
  assert.deepEqual(plan.chunks.map(chunk => chunk.text.length), [240, 240, 21]);
  assert.ok(plan.chunks.every(chunk => chunk.text.length <= 240));
  assertPlanIntegrity(plan);
});

test('speech planner caps input at a whole-word boundary and normalizes locales', () => {
  const plan = buildPlan(['one two three four'], { maximumCharacters: 12 });

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

  assert.equal(selectVoice(voices, 'en', ''), null);
  assert.equal(selectVoice(voices, 'en', 'com.example.kokoro.heart'), voices[0]!);
  assert.equal(selectVoice(voices, 'pt', 'tugão'), voices[1]!);
  assert.equal(selectVoice(voices, 'en', 'tugão'), null);
  assert.equal(selectVoice(voices, 'pt', 'missing voice'), null);
});

function playerHarness({ voices = [] }: { voices?: SpeechSynthesisVoice[] } = {}) {
  let clock = 1000;
  let nextTimerID = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const states: Array<'playing' | 'paused' | 'stopped'> = [];
  const spoken: SpeechUtteranceFixture[] = [];
  const synthesis = {
    cancelCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    speak(utterance: SpeechUtteranceFixture) { spoken.push(utterance); },
    cancel() { this.cancelCalls += 1; },
    pause() { this.pauseCalls += 1; },
    resume() { this.resumeCalls += 1; },
    getVoices() { return voices; },
  };
  const Utterance = SpeechUtteranceFixture;
  const player = createPlayer({
    speechSynthesis: synthesis,
    Utterance,
    now: () => clock,
    setTimeout(callback: () => void, delay: number) {
      const id = nextTimerID++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
    onStateChange(state: 'playing' | 'paused' | 'stopped') { states.push(state); },
  });
  return {
    player,
    synthesis,
    spoken,
    states,
    timers,
    advance(milliseconds: number) { clock += milliseconds; },
    runTimer() {
      const [id, timer] = timers.entries().next().value || [];
      assert.ok(timer, 'Expected a pending speech timer');
      assert.notEqual(id, undefined);
      timers.delete(id!);
      clock += timer.delay;
      timer.callback();
    },
  };
}

test('speech player speaks sequential chunks with language and timed pauses', () => {
  const kokoro = fixture<SpeechSynthesisVoice>({ name: 'Kokoro Heart', voiceURI: 'kokoro-heart', lang: 'en-US' });
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
  assert.equal(harness.spoken[0]!.text, 'First.');
  assert.equal(harness.spoken[0]!.lang, 'pt-PT');
  assert.equal(harness.spoken[0]!.rate, 1);
  assert.equal(harness.spoken[0]!.voice, undefined, 'a mismatched English voice is not used for Portuguese');

  harness.spoken[0]!.onend();
  assert.equal(harness.spoken.length, 1);
  assert.equal([...harness.timers.values()][0]!.delay, 400);
  harness.runTimer();
  assert.equal(harness.spoken[1]!.text, 'Second.');
  harness.spoken[1]!.onend();
  assert.equal([...harness.timers.values()][0]!.delay, 35);
  harness.runTimer();
  harness.spoken[2]!.onend();

  assert.equal(harness.player.state, 'stopped');
  assert.deepEqual(harness.states, ['playing', 'stopped']);
});

test('speech player speaks grouped thousands from the spoken field', () => {
  const harness = playerHarness();
  assert.equal(harness.player.start({
    chunks: [{ text: '100,000', spoken: '100000', pauseMs: 0 }],
  }), true);
  assert.equal(harness.spoken[0]!.text, '100000');
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

  harness.spoken[0]!.onend();
  harness.advance(125);
  assert.equal(harness.player.pause(), true);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.player.resume(), true);
  assert.equal([...harness.timers.values()][0]!.delay, 275);
  harness.runTimer();
  assert.equal(harness.spoken[1]!.text, 'Second.');
});

test('speech player advances immediately for a zero delay', () => {
  const harness = playerHarness();
  harness.player.start({ chunks: [
    { text: 'First.', pauseMs: 0 },
    { text: 'Second.', pauseMs: 0 },
  ] });
  harness.spoken[0]!.onend();
  assert.equal(harness.spoken[1]!.text, 'Second.');
});

test('speech player stop and errors reject stale callbacks without duplicating speech', () => {
  const harness = playerHarness();
  harness.player.start({ chunks: [
    { text: 'Old.', pauseMs: 0 },
    { text: 'Never.', pauseMs: 10 },
  ] });
  const stale = harness.spoken[0]!;
  assert.equal(harness.player.stop(), true);
  stale.onend();
  assert.equal(harness.spoken.length, 1);

  harness.player.start({ chunks: [{ text: 'Current.', pauseMs: 0 }] }, { language: 'fr-fr' });
  const current = harness.spoken[1]!;
  assert.equal(current.lang, 'fr-FR');
  current.onerror();
  assert.equal(harness.player.state, 'stopped');
  assert.equal(harness.player.pause(), false);
  assert.equal(harness.player.resume(), false);
});

test('speech player reports unsupported or empty plans without starting', () => {
  const unsupported = createPlayer({});
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.start({ chunks: [{ text: 'No voice.' }] }), false);

  const harness = playerHarness();
  assert.equal(harness.player.start({ chunks: [] }), false);
  assert.equal(harness.spoken.length, 0);
});

test('speech planner and player cover defensive platform fallbacks', () => {
  assert.equal(buildPlan('single value').text, 'single value');
  assert.equal(buildPlan(['', 'kept'], { maximumCharacters: 4 }).text, 'kept');
  assert.equal(BookstrSpeech.normalizeLocale('zh-hant'), 'zh-hant');
  assert.equal(selectVoice('not an array', 'en', 'voice'), null);
  assert.equal(selectVoice([{ lang: 'en-US' }], 'en', 'voice'), null);

  const objectSegmenter = {
    segment() {
      return [{ segment: 'Object sentence.' }, { segment: '   ' }];
    },
  };
  assert.deepEqual(
    buildPlan(['Object sentence.'], { segmenterFactory: objectSegmenter }).chunks.map(chunk => chunk.text),
    ['Object sentence.'],
  );
  const emptySegmenter = { segment() { return []; } };
  assert.equal(buildPlan(['Fallback text'], { segmenterFactory: emptySegmenter }).chunks[0]!.text, 'Fallback text');

  const spoken: SpeechUtteranceFixture[] = [];
  const synthesis = {
    speak(utterance: SpeechUtteranceFixture) { spoken.push(utterance); },
    cancel() {},
    getVoices() { return [{ name: 'English voice', voiceURI: 'voice', lang: 'en-US' }]; },
  };
  const Utterance = SpeechUtteranceFixture;
  const player = createPlayer({
    speechSynthesis: synthesis,
    Utterance,
    setTimeout(callback: () => void) { callback(); return 1; },
    clearTimeout() {},
  });
  assert.equal(player.stop(), false);
  assert.equal(player.start({ chunks: [null, { text: ' ' }, { text: 'Current.' }] }, {
    language: 'en-US', rate: 20, voiceIdentifier: 'voice',
  }), true);
  assert.equal(spoken[0]!.rate, 10);
  assert.deepEqual(spoken[0]!.voice, synthesis.getVoices()[0]);
  spoken[0]!.onerror();
  assert.equal(player.state, 'stopped');
});

test('speech planner covers empty, truncated, punctuation, and segmenter-mismatch inputs', () => {
  assert.deepEqual(buildPlan([]), { text: '', chunks: [] });
  assert.equal(buildPlan(['one', 'two'], { maximumCharacters: 1 }).text, 'o');
  assert.equal(buildPlan(['a', 'b'], { maximumCharacters: 2 }).text, 'a');
  assert.deepEqual(buildPlan(['---']).chunks, []);
  assert.equal(
    buildPlan(['Actual text.'], {
      segmenterFactory: { segment() { return [{ segment: 'Different text.' }]; } },
    }).chunks[0]!.text,
    'Actual text.',
  );
  const punctuationPlan = buildPlan(['left --- right, then continue; here it ends.'], {
    softLimit: 10,
    hardLimit: 18,
    segmenterFactory: null,
  });
  assert.ok(punctuationPlan.chunks.length > 1);
  assertPlanIntegrity(punctuationPlan);
});

test('speech player tolerates missing optional synthesis APIs and stale timers', () => {
  const spoken: SpeechUtteranceFixture[] = [];
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const synthesis = {
    speak(utterance: SpeechUtteranceFixture) { spoken.push(utterance); },
    cancel() {},
  };
  const Utterance = SpeechUtteranceFixture;
  const player = createPlayer({
    speechSynthesis: synthesis,
    Utterance,
    setTimeout(callback: () => void, delay: number) {
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
  spoken[0]!.onend();
  const pending = timers.at(-1)!;
  assert.equal(player.stop(), true);
  pending.callback();
  assert.equal(spoken.length, 1);
  assert.equal(player.stop(), false);
});

test('speech module works without CommonJS, Intl, or host timers', async () => {
  const source = await readFile(new URL('../reader-speech.js', import.meta.url), 'utf8');
  const context = fixture<{ Intl: undefined; BookstrSpeech: SpeechApi }>({ Intl: undefined });
  vm.runInNewContext(source, context);
  const api = fixture<SpeechApi>(context['BookstrSpeech']);
  assert.equal(typeof api.buildPlan, 'function');
  assert.equal(api.buildPlan(['Fallback sentence.']).chunks[0]!.text, 'Fallback sentence.');

  const Utterance = SpeechUtteranceFixture;
  const spoken: SpeechUtteranceFixture[] = [];
  const player = createPlayer({
    speechSynthesis: { speak(utterance: SpeechUtteranceFixture) { spoken.push(utterance); } },
    Utterance,
  }, api);
  assert.equal(player.start({ chunks: [
    { text: 'First.', spoken: 'First.', start: 0, pauseMs: 0 },
    { text: 'Second.', spoken: 'Second.', start: 7, pauseMs: 10 },
  ] }), true);
  assert.equal(spoken.length, 1);
  spoken[0]!.onend();
  assert.equal(spoken.length, 2);

  const noRoot = { globalThis: undefined };
  vm.runInNewContext(`(function() { "use strict"; ${source} }).call(null)`, noRoot);
  new Function('globalThis', `"use strict"; ${source}`)(undefined);
});

test('speech player accepts an omitted configuration object', () => {
  const player = createPlayer();
  assert.equal(player.supported, false);
  assert.equal(player.start(null), false);
  assert.equal(player.stop(), false);
});

test('speech planner handles punctuation after parenthetical phrases and empty DOM text nodes', () => {
  for (const suffix of ['"...', '!']) {
    const plan = buildPlan([`Before (inside)${suffix} after.`]);
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
      return { nextNode() { return index < nodes.length ? nodes[index++] ?? null : null; } };
    },
  };
  assert.equal(visibleText({ ownerDocument: document }), 'visible');

  assert.equal(silentParent({
    closest(selector: string) { return selector === 'a' ? this : null; },
    getAttribute(name: string) { return name === 'role' ? 'footnote' : ''; },
    className: '',
  }), true);
  for (const text of [
    'abcdefghij,word with no comma boundary and enough words to split later.',
    'abcdefghij;word with no clause boundary and enough words to split later.',
    'abcdefghij:word with no colon boundary and enough words to split later.',
    'one --- two three four five six seven eight nine ten.',
    'one - two three four five six seven eight nine ten.',
  ]) {
    assertPlanIntegrity(buildPlan([text], { softLimit: 10, hardLimit: 20, segmenterFactory: null }));
  }
});

interface SpeechTextFixture { nodeType: 3; nodeValue: string; parentElement: SpeechElementFixture | null }
interface SpeechElementFixture {
  tagName: string;
  localName: string;
  nodeType: 1;
  childNodes: Array<SpeechElementFixture | SpeechTextFixture>;
  parentElement: SpeechElementFixture | null;
  ownerDocument: SpeechDocumentFixture | null;
  className: string;
  getAttribute(name: string): string | null;
  readonly textContent: string;
  closest(selector: string): SpeechElementFixture | null;
  querySelector(selector: string): SpeechElementFixture | null;
  querySelectorAll(selector: string): SpeechElementFixture[];
}
interface SpeechDocumentFixture {
  body: SpeechElementFixture;
  documentElement: SpeechElementFixture;
  querySelector(selector: string): SpeechElementFixture | null;
  querySelectorAll(selector: string): SpeechElementFixture[];
  createTreeWalker(root: SpeechElementFixture): { nextNode(): SpeechTextFixture | null };
}
type SpeechElementBuilder = (tag: string, kids?: Array<string | SpeechElementFixture>, attributes?: Record<string, string>) => SpeechElementFixture;

function speechDocument(buildChildren: (createElement: SpeechElementBuilder) => SpeechElementFixture[]): Document {
  function matches(element: SpeechElementFixture | SpeechTextFixture | null, selector: string): boolean {
    if (!element || element.nodeType === 3) return false;
    return String(selector)
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
      .some((part) => {
        if (part === '*') return true;
        const tag = part.replace(/\[.*$/, '');
        if (element.localName !== tag) return false;
        const attribute = part.match(/\[([^=\]]+)/);
        return !attribute || element.getAttribute(attribute[1]!) !== null;
      });
  }

  function collect(root: SpeechElementFixture, selector: string, includeRoot: boolean): SpeechElementFixture[] {
    const found: SpeechElementFixture[] = [];
    function walk(node: SpeechElementFixture | SpeechTextFixture, isRoot: boolean): void {
      if (node.nodeType === 3) return;
      if ((!isRoot || includeRoot) && matches(node, selector)) found.push(node);
      for (const child of node.childNodes || []) walk(child, false);
    }
    walk(root, true);
    return found;
  }

  function createElement(tag: string, kids: Array<string | SpeechElementFixture> = [], attributes: Record<string, string> = {}): SpeechElementFixture {
    const element: SpeechElementFixture = {
      tagName: String(tag).toUpperCase(),
      localName: String(tag).toLowerCase(),
      nodeType: 1,
      childNodes: [] as Array<SpeechElementFixture | SpeechTextFixture>,
      parentElement: null,
      ownerDocument: null as SpeechDocumentFixture | null,
      className: '',
      getAttribute(name: string) { return attributes[name] ?? null; },
      get textContent() {
        return this.childNodes.map((child) => child.nodeType === 3 ? child.nodeValue : child.textContent).join('');
      },
      closest(selector: string) {
        let current: SpeechElementFixture | null = this;
        while (current) {
          if (matches(current, selector)) return current;
          current = current.parentElement;
        }
        return null;
      },
      querySelector(selector: string) {
        return collect(this, selector, false)[0] || null;
      },
      querySelectorAll(selector: string) {
        return collect(this, selector, false);
      },
    };
    for (const kid of kids) {
      if (typeof kid === 'string') {
        element.childNodes.push({ nodeType: 3, nodeValue: kid, parentElement: element });
      } else {
        kid.parentElement = element;
        element.childNodes.push(kid);
      }
    }
    return element;
  }

  const children = typeof buildChildren === 'function' ? buildChildren(createElement) : [];
  const body = createElement('body', children);
  const documentElement = createElement('html', [body]);
  const document: SpeechDocumentFixture = {
    body,
    documentElement,
    querySelector(selector: string) {
      return collect(documentElement, selector, true)[0] || null;
    },
    querySelectorAll(selector: string) {
      return collect(documentElement, selector, true);
    },
    createTreeWalker(root: SpeechElementFixture) {
      const nodes: SpeechTextFixture[] = [];
      function walk(node: SpeechElementFixture): void {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) nodes.push(child);
          else walk(child);
        }
      }
      walk(root);
      let index = 0;
      return {
        nextNode() {
          return index < nodes.length ? nodes[index++] ?? null : null;
        },
      };
    },
  };

  function attach(node: SpeechElementFixture): void {
    node.ownerDocument = document;
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) child.parentElement = node;
      else attach(child);
    }
  }
  attach(documentElement);
  body.parentElement = documentElement;
  return fixture<Document>(document);
}

test('speakableBlocks does not re-speak nested wrappers inside headings', () => {
  const document = speechDocument((el) => [
    el('h2', [
      el('div', ['Chapter Title']),
      el('div', ['Chapter Title']),
      el('div', ['Chapter Title']),
    ]),
  ]);
  const blocks = speakableBlocks(document);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.localName, 'h2');
  assert.equal(
    BookstrSpeech.normalizeText(visibleText(blocks[0])),
    'Chapter TitleChapter TitleChapter Title',
  );
});

test('speakableBlocks skips nested primary tags inside a heading', () => {
  const document = speechDocument((el) => [
    el('h1', [
      el('li', ['Repeated']),
      el('li', ['Repeated']),
    ]),
  ]);
  const blocks = speakableBlocks(document);
  assert.deepEqual(blocks.map((block) => block.localName), ['h1']);
});

test('speakableBlocks includes leaf div text when primary tags are empty', () => {
  const document = speechDocument((el) => [
    el('p', ['   ']),
    el('div', ['Mid-chapter narration continues here.']),
  ]);
  const blocks = speakableBlocks(document);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.localName, 'div');
  assert.equal(BookstrSpeech.normalizeText(visibleText(blocks[0])), 'Mid-chapter narration continues here.');
});

test('speakableBlocks prefers primary paragraphs over wrapping containers', () => {
  const document = speechDocument((el) => [
    el('section', [
      el('p', ['First paragraph.']),
      el('p', ['Second paragraph.']),
    ]),
  ]);
  const blocks = speakableBlocks(document);
  assert.deepEqual(blocks.map((block) => block.localName), ['p', 'p']);
  assert.deepEqual(
    blocks.map((block) => BookstrSpeech.normalizeText(visibleText(block))),
    ['First paragraph.', 'Second paragraph.'],
  );
});

test('speakableBlocks prefers nested leaf containers over empty ancestors', () => {
  const document = speechDocument((el) => [
    el('section', [
      el('div', ['Only the leaf should speak.']),
    ]),
  ]);
  const blocks = speakableBlocks(document);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.localName, 'div');
  assert.equal(
    BookstrSpeech.normalizeText(visibleText(blocks[0])),
    'Only the leaf should speak.',
  );
});

test('speakableBlocks falls back to body when no block tags carry text', () => {
  const document = speechDocument((el) => [
    el('span', ['Body-level prose without paragraphs.']),
  ]);
  const blocks = speakableBlocks(document);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.localName, 'body');
  assert.equal(
    BookstrSpeech.normalizeText(visibleText(blocks[0])),
    'Body-level prose without paragraphs.',
  );
});

test('speakableBlocks returns an empty list for missing documents', () => {
  assert.deepEqual(speakableBlocks(null), []);
  assert.deepEqual(speakableBlocks({}), []);
});

test('speech skips semantic chapter navigation while keeping nearby prose', () => {
  const document = speechDocument((el) => [
    el('nav', [el('li', ['Chapter one']), el('li', ['Chapter two'])], { 'epub:type': 'toc' }),
    el('p', ['The story begins here.']),
  ]);
  assert.deepEqual(speakableBlocks(document).map((node) => node.textContent),
    ['The story begins here.']);
  assert.equal(openingNavigation(document, true), false);
  const tocOnly = speechDocument((el) => [el('nav', [el('li', ['Chapter one'])])]);
  assert.deepEqual(speakableBlocks(tocOnly), []);
});

test('speech recognizes unmarked opening contents lists without skipping later chapter links', () => {
  const document = speechDocument((el) => [
    el('h1', ['Contents']),
    el('ol', [
      el('li', [el('a', ['First chapter'], { href: '#one' })]),
      el('li', [el('a', ['Second chapter'], { href: '#two' })]),
      el('li', [el('a', ['Third chapter'], { href: '#three' })]),
    ]),
  ]);
  assert.equal(openingNavigation(document, true), true);
  assert.equal(openingNavigation(document, false), false);
  const prose = speechDocument((el) => [el('h1', ['Chapter one']), el('p', ['The story starts.'])]);
  assert.equal(openingNavigation(prose, true), false);
});

interface MobileTextBlockFixture {
  textContent: string;
  ownerDocument?: MobileDocumentFixture;
  getBoundingClientRect(): { bottom: number };
  contains?(node: unknown): boolean;
}
interface MobileRangeFixture {
  startContainer: MobileTextBlockFixture;
  startOffset?: number;
  atEnd?: boolean;
  selectNodeContents(): void;
  collapse(atEnd: boolean): void;
}
interface MobileDocumentFixture {
  blocks: MobileTextBlockFixture[];
  body: { textContent: string; getAttribute(name: string): string | null };
  documentElement: { lang: string };
  defaultView: object;
  querySelectorAll(): never[];
  createRange?(): MobileRangeFixture;
  createTreeWalker?(): { nextNode(): { nodeValue: string; parentElement: MobileTextBlockFixture } | null };
}
interface MobileReaderContextFixture {
  [key: string]: unknown;
  document: { getElementById(): { addEventListener(): void; contains(): boolean }; addEventListener(): void; body: object };
  localStorage: { getItem(): null; setItem(): void };
  AndroidBridge: { onSpeechText(json: string): void };
  BookstrSpeech: SpeechApi;
  console: Console;
  setTimeout: typeof setTimeout;
  requestAnimationFrame(callback: () => void): void;
  addEventListener(name: string, callback: () => void): void;
}

test('mobile speech advances past a contents page and rebuilds highlights after layout', async () => {
  const html = await readFile(new URL('../../shared/reader/reader.html', import.meta.url), 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  const messages: Array<{ text: string }> = [];
  const events: Record<string, () => void> = {};
  const noopElement = { addEventListener() {}, contains() { return false; } };
  const context = fixture<MobileReaderContextFixture>({
    document: {
      getElementById() { return noopElement; },
      addEventListener() {},
      body: {},
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    AndroidBridge: { onSpeechText(json: string) { messages.push(JSON.parse(json) as { text: string }); } },
    BookstrSpeech: {
      ...BookstrSpeech,
      speakableBlocks(doc: MobileDocumentFixture) { return fixture<Element[]>(doc.blocks); },
      visibleText(block: Element) { return fixture<MobileTextBlockFixture>(block).textContent; },
    },
    console,
    setTimeout,
    requestAnimationFrame(callback: () => void) { callback(); },
    addEventListener(name: string, callback: () => void) { events[name] = callback; },
  });
  context.window = context;
  vm.createContext(context);
  vm.runInContext(inline, context);
  const makeDocument = (text: string, role = ''): MobileDocumentFixture => {
    const block = { textContent: text, getBoundingClientRect() { return { bottom: 1 }; } };
    const body = { textContent: text, getAttribute(name: string) { return name === 'role' ? role : null; } };
    return {
      blocks: [block], body, documentElement: { lang: 'en' }, defaultView: {},
      querySelectorAll() { return []; },
    };
  };
  let currentIndex = 0;
  let chapter = makeDocument('The story begins here.');
  const contents = makeDocument('Chapter one Chapter two Chapter three', 'doc-toc');
  context['mockBook'] = { spine: { spineItems: [{ href: 'contents' }, { href: 'chapter' }] } };
  const mockRendition = {
    getContents() { return [{ document: currentIndex === 0 ? contents : chapter }]; },
    currentLocation() { return { start: { index: currentIndex } }; },
    display() { currentIndex = 1; return Promise.resolve(); },
  };
  context['mockRendition'] = mockRendition;
  vm.runInContext('book = mockBook; rendition = mockRendition', context);
  const requestSpeechText = fixture<(full: boolean, cfi: null, progress: string) => { text: string }>(context['requestSpeechText']);
  requestSpeechText(true, null, '');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.text, 'The story begins here.');
  const replacement = makeDocument('The story begins here.');
  chapter = replacement;
  vm.runInContext('lastSpeechCfi = "current-position"', context);
  events['resize']!();
  assert.equal(vm.runInContext('speechBlocks[0].element', context), replacement.blocks[0]);
  assert.equal(vm.runInContext('speechBlocks[0].start', context), 0);
  assert.equal(vm.runInContext('speechPlanStartCfi', context), '');
  assert.equal(vm.runInContext('lastSpeechCfi', context), 'current-position');
  assert.equal(messages.length, 1);

  const selected = makeDocument('Before selected after.');
  const textNode = { nodeValue: selected.blocks[0]!.textContent, parentElement: selected.blocks[0]! };
  selected.blocks[0]!.ownerDocument = selected;
  selected.blocks[0]!.contains = (node: unknown) => node === textNode;
  selected.createRange = () => ({
    startContainer: selected.blocks[0]!,
    selectNodeContents() {},
    collapse(atEnd: boolean) { this.atEnd = atEnd; },
  });
  selected.createTreeWalker = () => {
    let visited = false;
    return { nextNode() { if (visited) return null; visited = true; return textNode; } };
  };
  context['NodeFilter'] = { SHOW_TEXT: 4 };
  chapter = selected;
  mockRendition.getContents = () => [{
    document: selected,
    cfiFromRange(range: MobileRangeFixture) { return range.atEnd ? 'z' : 'a'; },
    range() { return { startContainer: textNode, startOffset: 7 }; },
  }];
  const fromSelection = requestSpeechText(false, null, 'm');
  assert.equal(fromSelection.text, 'selected after.');
});
