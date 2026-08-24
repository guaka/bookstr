import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs/pdf.mjs';

GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs';

const pages = document.getElementById('pages');
const message = document.getElementById('message');
const title = document.getElementById('title');
const pageCount = document.getElementById('page-count');
const zoomLabel = document.getElementById('zoom-label');
const download = document.getElementById('download');
let pdf = null;
let pdfBytes = null;
let downloadUrl = '';
let zoom = 1;
let renderGeneration = 0;

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function renderPage(pageNumber, canvas, generation) {
  if (canvas.dataset.rendered === 'true' || generation !== renderGeneration) return;
  canvas.dataset.rendered = 'true';
  const page = await pdf.getPage(pageNumber);
  if (generation !== renderGeneration) return;
  const base = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(280, Math.min(1100, window.innerWidth - 24));
  const cssScale = (availableWidth / base.width) * zoom;
  const viewport = page.getViewport({ scale: cssScale });
  const outputScale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  canvas.parentElement.style.width = canvas.style.width;
  canvas.parentElement.style.height = canvas.style.height;
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;
}

async function renderPages() {
  const generation = ++renderGeneration;
  pages.replaceChildren();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = entry.target.querySelector('canvas');
      void renderPage(Number(entry.target.dataset.page), canvas, generation);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '900px 0px' });
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const shell = document.createElement('section');
    shell.className = 'pdf-page';
    shell.dataset.page = String(pageNumber);
    shell.setAttribute('aria-label', `Page ${pageNumber}`);
    shell.appendChild(document.createElement('canvas'));
    pages.appendChild(shell);
    observer.observe(shell);
  }
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

window.loadPdf = async ({ base64, bookTitle, filename, theme = 'white' }) => {
  try {
    renderGeneration += 1;
    if (pdf) await pdf.destroy();
    pages.replaceChildren();
    document.body.dataset.theme = theme;
    title.textContent = bookTitle || 'PDF';
    pdfBytes = bytesFromBase64(base64);
    pdf = await getDocument({ data: pdfBytes.slice() }).promise;
    pageCount.textContent = `${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    download.href = downloadUrl;
    download.download = filename;
    await renderPages();
    message.classList.add('hidden');
  } catch (error) {
    message.textContent = `Could not display PDF: ${error?.message || error}`;
    throw error;
  }
};

document.getElementById('zoom-out').addEventListener('click', () => {
  zoom = Math.max(.5, zoom - .15);
  void renderPages();
});

document.getElementById('zoom-in').addEventListener('click', () => {
  zoom = Math.min(2.5, zoom + .15);
  void renderPages();
});

window.addEventListener('beforeunload', () => {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  pdf?.destroy();
});
