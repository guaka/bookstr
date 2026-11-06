import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('worker deployment instructions use pnpm dlx', async () => {
  const readme = await readFile(new URL('../worker/README.md', import.meta.url), 'utf8');

  assert.match(readme, /pnpm dlx wrangler deploy/);
  assert.doesNotMatch(readme, /\bnpx\b/);
});

test('WebTorrent setup guidance uses pnpm in desktop', async () => {
  const server = await readFile(new URL('../webdev.py', import.meta.url), 'utf8');

  assert.match(server, /Run pnpm install in desktop\/ to enable browser WebTorrent/);
  assert.doesNotMatch(server, /Run npm install in desktop\//);
});

test('WebTorrent handler reports pnpm setup when its bundle is missing and serves it when present', () => {
  const script = String.raw`
import io
import runpy
import trace
from unittest.mock import Mock, patch

with patch('os.chdir'), patch('http.server.ThreadingHTTPServer'):
    namespace = runpy.run_path('webdev.py', run_name='webdev_contract_test')
Handler = namespace['Handler']

def make_handler():
    handler = Handler.__new__(Handler)
    handler.path = '/__webdev__/webtorrent.min.js'
    handler.wfile = io.BytesIO()
    handler.send_error = Mock()
    handler.send_response = Mock()
    handler.send_header = Mock()
    handler.end_headers = Mock()
    return handler

missing = make_handler()
missing_bundle = Mock()
missing_bundle.is_file.return_value = False
Handler.do_GET.__globals__['WEBTORRENT_BUNDLE'] = missing_bundle
missing_trace = trace.Trace(count=True, trace=False)
missing_trace.runfunc(missing.do_GET)
missing.send_error.assert_called_once_with(
    503, 'Run pnpm install in desktop/ to enable browser WebTorrent'
)
missing.send_response.assert_not_called()
with open('webdev.py', encoding='utf-8') as source:
    hint_line = next(
        number for number, text in enumerate(source, 1)
        if 'Run pnpm install in desktop/' in text
    )
assert missing_trace.results().counts[(Handler.do_GET.__code__.co_filename, hint_line)] > 0

present = make_handler()
body = b'webtorrent bundle bytes'
present_bundle = Mock()
present_bundle.is_file.return_value = True
present_bundle.read_bytes.return_value = body
Handler.do_GET.__globals__['WEBTORRENT_BUNDLE'] = present_bundle
present.do_GET()
present.send_response.assert_called_once_with(200)
present.send_header.assert_any_call('Content-Type', 'application/javascript; charset=UTF-8')
present.send_header.assert_any_call('Content-Length', str(len(body)))
present.send_header.assert_any_call('Cache-Control', 'no-store')
present.end_headers.assert_called_once_with()
assert present.wfile.getvalue() == body
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout || `Python exited with ${result.status}`);
});
