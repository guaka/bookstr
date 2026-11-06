import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { functionSource } from './source-tools.mts';

test('functionSource extracts complete declarations with nested blocks', () => {
  const source = `const before = true;\n  function choose(value) {\n    if (value) {\n      return { nested: { value } };\n    }\n    return null;\n  }\n  function after() { return false; }`;
  const extracted = functionSource(source, 'choose');
  assert.equal(extracted, `  function choose(value) {\n    if (value) {\n      return { nested: { value } };\n    }\n    return null;\n  }`);
  assert.doesNotThrow(() => new vm.Script(`(${extracted})`));
});

test('functionSource handles braces in template literals and regular expressions', () => {
  const source = `function render() {\n  const message = \`literal } \${(() => { return 'nested'; })()}\`;\n  return /[{}]/.test(message) && message.includes('nested');\n}\n`;
  assert.equal(functionSource(source, 'render'), source.trimEnd());
});

test('functionSource extracts async declarations without executing them', () => {
  const source = `async function load() {\n  globalThis.wasExecuted = true;\n  return { ready: true };\n}`;
  const extracted = functionSource(source, 'load');
  const context = vm.createContext({});
  new vm.Script(`(${extracted})`).runInContext(context);
  assert.equal(context.wasExecuted, undefined);
});

test('functionSource rejects missing declarations instead of returning a partial snippet', () => {
  assert.throws(() => functionSource('function other() { return 1; }', 'missing'), /Function declaration not found: missing/);
});

test('functionSource requires a complete declaration', () => {
  assert.throws(() => functionSource('function unfinished() { return 1;', 'unfinished'), /Complete function declaration not found: unfinished/);
});

test('functionSource escapes valid identifier punctuation', () => {
  const source = 'function read$() { return 1; }';
  assert.equal(functionSource(source, 'read$'), source);
});
