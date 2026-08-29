const test = require('node:test');
const assert = require('node:assert/strict');

const BookstrSpeech = require('../../../web/reader-speech');

test('desktop speech planner keeps complete sentences and paragraph timing', () => {
  const sentence = Array.from({ length: 28 }, (_, index) => `word${index}`).join(' ') + '.';
  const plan = BookstrSpeech.buildPlan([sentence, 'Next paragraph.']);

  assert.equal(plan.chunks[0].text, sentence);
  assert.equal(plan.chunks[0].pauseMs, 0);
  assert.equal(plan.chunks[1].pauseMs, BookstrSpeech.defaults.paragraphPauseMs);
  assert.equal(plan.text.slice(plan.chunks[1].start), 'Next paragraph.');
});

test('desktop speech player queues system utterances and rejects stale completion', () => {
  const spoken = [];
  const timers = [];
  const synthesis = {
    speak(utterance) { spoken.push(utterance); },
    cancel() {},
    pause() {},
    resume() {},
  };
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const player = BookstrSpeech.createPlayer({
    speechSynthesis: synthesis,
    Utterance,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  });

  player.start({ chunks: [
    { text: 'First.', pauseMs: 0 },
    { text: 'Second.', pauseMs: 400 },
  ] }, { language: 'pt' });
  const stale = spoken[0];
  stale.onend();
  assert.equal(timers[0].delay, 400);
  timers[0].callback();
  assert.equal(spoken[1].text, 'Second.');
  assert.equal(spoken[1].lang, 'pt-PT');

  player.stop();
  stale.onend();
  assert.equal(spoken.length, 2);
});
