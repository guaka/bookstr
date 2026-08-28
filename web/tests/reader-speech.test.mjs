import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

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

  assert.equal(plan.chunks[0].pauseMs, 0);
  assert.ok(plan.chunks.some((chunk, index) => index > 0 && chunk.pauseMs === 35));
  assert.ok(plan.chunks.some((chunk, index) => index > 0 && chunk.pauseMs === 180));
  const paragraphStart = plan.text.indexOf('A new paragraph');
  assert.equal(plan.chunks.find(chunk => chunk.start === paragraphStart)?.pauseMs, 400);
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

  assert.deepEqual(plan.chunks.map(chunk => chunk.pauseMs), [0, 320, 320, 250, 280]);
  assertPlanIntegrity(plan);
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

function playerHarness() {
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
  const harness = playerHarness();
  const plan = {
    chunks: [
      { text: 'First.', start: 0, pauseMs: 0 },
      { text: 'Second.', start: 7, pauseMs: 400 },
      { text: 'Third.', start: 15, pauseMs: 35 },
    ],
  };

  assert.equal(harness.player.start(plan, { language: 'pt', rate: 1 }), true);
  assert.equal(harness.player.state, 'playing');
  assert.equal(harness.spoken[0].text, 'First.');
  assert.equal(harness.spoken[0].lang, 'pt-PT');
  assert.equal(harness.spoken[0].rate, 1);

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
