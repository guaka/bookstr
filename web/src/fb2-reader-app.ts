interface Fb2ReaderSettings {readerFont?:unknown;readerFontFamily?:unknown;readerFontPercent?:unknown;readerPadding?:unknown;readerAlignment?:unknown;readerTextAlign?:unknown}
type Fb2Window = {applyReaderSettings:(settings?:Fb2ReaderSettings)=>void;setReaderTypography:(font:unknown,alignment:unknown,padding:unknown)=>void;loadFB2:(base64:string,cfi?:string,theme?:string,bookId?:string)=>Promise<void>;nextPage:()=>void;prevPage:()=>void};
import { parseFB2 } from './fb2.js';
const viewer = document.getElementById('viewer') as HTMLElement;
let active = '';
let furthest = 0;
function applyReaderSettings(settings:Fb2ReaderSettings = {}) { const font = settings.readerFont || settings.readerFontFamily; const family = font === 'arial' ? 'Arial,Helvetica,sans-serif' : font === 'georgia' ? 'Georgia,"Times New Roman",serif' : font === 'system' ? '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' : font === 'roboto' ? 'Roboto,Arial,sans-serif' : font === 'noto-serif' ? '"Noto Serif",Georgia,"Times New Roman",serif' : '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif'; const size = Math.max(75, Math.min(180, Number(settings.readerFontPercent) || 100)); const padding = Math.max(8, Math.min(64, Number(settings.readerPadding) || 24)); const alignment = settings.readerAlignment || (settings.readerTextAlign === 'justify' ? 'justified' : settings.readerTextAlign); document.documentElement.style.setProperty('--reader-font', family); document.documentElement.style.setProperty('--reader-size', String(size)); document.documentElement.style.setProperty('--reader-padding', `${padding}px`); document.body.style.textAlign = alignment === 'justified' ? 'justify' : alignment === 'left' ? 'left' : ''; }
function applyScaledReaderSettings(settings:Fb2ReaderSettings = {}) { applyReaderSettings(settings); const size = Math.max(75, Math.min(180, Number(settings.readerFontPercent) || 100)); document.documentElement.style.setProperty('--reader-size', String(size / 100)); }
(window as unknown as Fb2Window).applyReaderSettings = applyScaledReaderSettings;
(window as unknown as Fb2Window).setReaderTypography = (font, alignment, padding) => applyScaledReaderSettings({ readerFont: font, readerAlignment: alignment, readerPadding: padding, readerFontPercent: (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-size')) || 1) * 100 });
try {
    applyScaledReaderSettings(JSON.parse(localStorage.getItem('bookstr_reader_settings_v1') || '{}'));
}
catch {
    applyScaledReaderSettings();
}
function decode(base64:string) { return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))); }
function progress() { const height = Math.max(1, document.documentElement.scrollHeight - innerHeight); return Math.max(0, Math.min(1, scrollY / height)); }
function locator() { const sections = [...viewer.querySelectorAll<HTMLElement>('[data-fb2-section]')]; const activeSection = sections.findLast?.(s => s.getBoundingClientRect().top <= 80) || sections[0]; return `fb2:${activeSection?.dataset.fb2Section || 'section-1'}:0:0`; }
function report() { const progression = progress(); furthest = Math.max(furthest, progression); parent.postMessage({ type: 'bookstr-reader-progress', bookId: active, md5: active, cfi: locator(), progression, furthestProgression: furthest, extension: 'fb2' }, location.origin); }
addEventListener('scroll', () => requestAnimationFrame(report), { passive: true });
(window as unknown as Fb2Window).loadFB2 = async (base64, cfi = '', theme = 'paper', bookId = '') => { active = bookId; furthest = 0; document.body.className = theme === 'night' ? 'night' : ''; const parsed = parseFB2(decode(base64), document); viewer.replaceChildren(parsed.document.body.firstElementChild!); const heading = document.createElement('h1'); heading.textContent = parsed.title; viewer.prepend(heading); const id = String(cfi).split(':')[1]; if (id)
    viewer.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView(); report(); };
(window as unknown as Fb2Window).nextPage = () => scrollBy({ top: innerHeight * .85, behavior: 'smooth' });
(window as unknown as Fb2Window).prevPage = () => scrollBy({ top: -innerHeight * .85, behavior: 'smooth' });
