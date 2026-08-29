const path = require('node:path');
const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');

const JSZip = require('../../../web/jszip.min.js');

function installReaderSpeechHarness() {
  const state = {
    calls: 0,
    latestUtterance: null,
    utterances: [],
    canceled: 0,
    paused: false,
  };

  class MockSpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.onend = null;
      this.onerror = null;
    }
  }

  const mockSpeechSynthesis = {
    speak(utterance) {
      state.calls += 1;
      state.latestUtterance = utterance;
      state.utterances.push(utterance);
      this.paused = false;
    },
    cancel() {
      state.canceled += 1;
      this.paused = false;
    },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    getVoices: () => [
      { name: 'Kokoro Heart', voiceURI: 'kokoro-heart', lang: 'en-US', localService: true },
      { name: 'Tugão', voiceURI: 'piper-tugao', lang: 'pt-PT', localService: true },
    ],
    paused: false,
  };

  const defineOrAssign = (property, value) => {
    try {
      Object.defineProperty(window, property, { configurable: true, value });
    } catch (error) {
      Object.defineProperty(window, property, {
        configurable: true,
        writable: true,
        value,
      });
    }
  };

  defineOrAssign('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);
  defineOrAssign('speechSynthesis', mockSpeechSynthesis);
  window.__bookstrSpeechTestState = state;
}

async function minimalEpub(title) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>\n    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>\n    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">\n      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n        <dc:identifier id="book-id">urn:bookstr:test:${title}</dc:identifier>\n        <dc:title>${title}</dc:title><dc:language>en</dc:language>\n      </metadata>\n      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>\n      <spine><itemref idref="chapter"/></spine>\n    </package>`);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>\n    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>\n    <body><h1>${title}</h1><p>${Array.from({ length: 55 }, (_, index) => 'speechword' + index).join(' ')}.</p><p>Second paragraph.</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

function minimalPdf(text, secondPageText = 'Second PDF page.') {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const escapedSecondPage = String(secondPageText).replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const secondStream = `BT /F1 24 Tf 72 720 Td (${escapedSecondPage}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

async function ensureReaderControls(reader, selectors) {
  const { playId, pauseId, stopId } = selectors;
  const play = reader.locator(`#${playId}`);
  const pause = reader.locator(`#${pauseId}`);
  const stop = reader.locator(`#${stopId}`);
  await expect(play).toBeEnabled();
  await expect(pause).toBeDisabled();
  await expect(stop).toBeDisabled();

  await play.click();
  await expect(play).toBeDisabled();
  await expect(pause).toBeEnabled();
  await expect(stop).toBeEnabled();

  await pause.click();
  await expect(pause).toHaveText('▶');
  await pause.click();
  await expect(pause).toHaveText('▮▮');

  const firstUtterance = await reader.locator('body').evaluate(() => ({
    text: window.__bookstrSpeechTestState.latestUtterance.text,
    language: window.__bookstrSpeechTestState.latestUtterance.lang,
    rate: window.__bookstrSpeechTestState.latestUtterance.rate,
    voiceURI: window.__bookstrSpeechTestState.latestUtterance.voice?.voiceURI || '',
  }));
  expect(firstUtterance.text.length).toBeLessThanOrEqual(240);
  expect(firstUtterance.language).toBe('en');
  expect(firstUtterance.rate).toBe(1.1);
  expect(firstUtterance.voiceURI).toBe('kokoro-heart');
  await reader.locator('body').evaluate(() => window.__bookstrSpeechTestState.latestUtterance.onend());
  await expect.poll(() => reader.locator('body').evaluate(() => window.__bookstrSpeechTestState.calls)).toBeGreaterThan(1);

  await stop.click();
  await expect(play).toBeEnabled();
  await expect(pause).toBeDisabled();
  await expect(stop).toBeDisabled();
  await expect.poll(() => reader.locator('body').evaluate(() => window.__bookstrSpeechTestState.canceled)).toBeGreaterThan(1);

  await play.click();
  for (let index = 0; index < 20 && await play.isDisabled(); index += 1) {
    const before = await reader.locator('body').evaluate(() => window.__bookstrSpeechTestState.calls);
    await reader.locator('body').evaluate(() => window.__bookstrSpeechTestState.latestUtterance.onend());
    await expect.poll(() => reader.locator('body').evaluate((_body, { currentCalls, currentPlayId }) => (
      window.__bookstrSpeechTestState.calls > currentCalls
      || !document.getElementById(currentPlayId).disabled
    ), { currentCalls: before, currentPlayId: playId })).toBe(true);
  }
  await expect(play).toBeEnabled();
  await expect(pause).toBeDisabled();
  await expect(stop).toBeDisabled();
}

test('Desktop EPUB reader supports speech control transitions', async () => {
  const readUrl = 'https://files.test/desktop-reader.epub';
  const epub = await minimalEpub('Desktop Reader Speech');
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '../..')],
  });

  try {
    const firstWindow = await electronApp.firstWindow();
    await electronApp.context().addInitScript(installReaderSpeechHarness);
    await firstWindow.evaluate(() => localStorage.setItem('bookstr_reader_settings_v1', JSON.stringify({
      speechVoiceEnglish: 'kokoro-heart',
      speechVoicePortuguese: '',
      speechRate: 1.1,
      readerFontFamily: 'arial',
      readerTextAlign: 'justify',
      readerFontPercent: 125,
    })));
    await firstWindow.evaluate(payload => { void window.bookstrDesktop.openReader(payload); }, {
      kind: 'epub',
      base64: epub.toString('base64'),
      readUrl,
      book: {
        md5: '22222222222222222222222222222222',
        title: 'Desktop Reader Speech',
        language: 'en',
        extension: 'epub',
      },
    });
    const reader = firstWindow;
    await reader.waitForURL('app://bookstr/reader.html');
    expect(await electronApp.windows()).toHaveLength(1);
    await expect.poll(() => reader.evaluate(() => ({
      desktop: Boolean(window.bookstrDesktop),
      planner: Boolean(window.BookstrSpeech),
      synthesis: typeof window.speechSynthesis,
      utterance: typeof window.SpeechSynthesisUtterance,
      harness: Boolean(window.__bookstrSpeechTestState),
      supported: hasSpeechSupport(),
      player: Boolean(readerSpeechPlayer),
    }))).toEqual({
      desktop: true,
      planner: true,
      synthesis: 'object',
      utterance: 'function',
      harness: true,
      supported: true,
      player: true,
    });
    await expect(reader.locator('#reader-speech-controls')).toBeVisible({ timeout: 45_000 });
    await expect(reader.locator('body')).toHaveAttribute('data-location', /.+/, { timeout: 45_000 });
    await ensureReaderControls(reader, {
      playId: 'reader-speech-play',
      pauseId: 'reader-speech-pause',
      stopId: 'reader-speech-stop',
    });
  } finally {
    await electronApp.close();
  }
});

test('Desktop PDF reader supports speech control transitions', async () => {
  const pdfUrl = 'https://files.test/desktop-reader.pdf';
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '../..')],
  });

  try {
    const firstWindow = await electronApp.firstWindow();
    await electronApp.context().addInitScript(installReaderSpeechHarness);
    await firstWindow.evaluate(() => localStorage.setItem('bookstr_reader_settings_v1', JSON.stringify({
      speechVoiceEnglish: 'kokoro-heart',
      speechVoicePortuguese: '',
      speechRate: 1.1,
    })));
    const pdf = minimalPdf(Array.from({ length: 55 }, (_, index) => 'pdfword' + index).join(' ') + '.');
    await firstWindow.evaluate(payload => { void window.bookstrDesktop.openReader(payload); }, {
      kind: 'pdf',
      base64: pdf.toString('base64'),
      readUrl: pdfUrl,
      book: {
        md5: '33333333333333333333333333333333',
        title: 'Desktop PDF Speech',
        language: 'en',
        extension: 'pdf',
      },
    });
    const pdfReader = firstWindow;
    await pdfReader.waitForURL('app://bookstr/pdf-reader.html');
    expect(await electronApp.windows()).toHaveLength(1);
    await expect(pdfReader.locator('.pdf-page canvas').first()).toHaveAttribute('data-rendered', 'true', { timeout: 45_000 });
    await expect(pdfReader.locator('#pdf-speech-controls')).toBeVisible({ timeout: 45_000 });
    await ensureReaderControls(pdfReader, {
      playId: 'pdf-speech-play',
      pauseId: 'pdf-speech-pause',
      stopId: 'pdf-speech-stop',
    });
  } finally {
    await electronApp.close();
  }
});
