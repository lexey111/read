// A PDF as a book of pages (ReaderCore `PDFConverter`, its pages mode):
// a `<div class="_cr_page">` a page with the page's size on it, laid out
// by the reader's script as a CBZ's pictures are. The apps draw every
// page to a JPEG once, at import; a browser opens the file anew each
// time, and four hundred pages drawn up front are a minute's wait. So a
// page is drawn here when it comes near the screen, at the size it is
// shown, and let go when it is far behind. pdf.js comes with the first
// PDF opened (the service worker keeps it after that).
//
// A PDF with a text layer is read as text by default (`pdftext.js`, the
// apps' rules): it takes the reader's type, columns and palette. The
// apps' rule chooses — text where most pages carry text, pictures for a
// scan — and the reader can turn one book either way (`mode`).

import { pagesPage, page as textPage } from './template.js';
import { inkIn, nameFromFile } from './pages.js';
import { readText, sampleText, hasTextLayer, html as textHTML } from './pdftext.js';

const base = new URL('./vendor/pdfjs/', import.meta.url).href;
let library = null;

function pdfjs() {
    library ??= import('./vendor/pdfjs/pdf.min.mjs')
        .then((lib) => {
            lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
            return lib;
        })
        .catch(() => {
            library = null;
            throw new Error('PDF support could not be loaded. It needs the network the first time.');
        });
    return library;
}

/// `%PDF-` and its version near the start: a writer may put a few bytes
/// before it — but a text that only talks of PDF is still a text.
export function isPDF(bytes, name = '') {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    const at = head.search(/%PDF-\d/);
    return at === 0 || (at > 0 && !/\.(md|markdown|mdown|mkd|txt|x?html?)$/i.test(name));
}

/// The info dictionary's title and authors, cleaned of what writers leave
/// in them — the apps' `PDFConverter.metadata`.
function described(info) {
    const text = (value) => (typeof value === 'string' ? value.replace(/\t/g, ' ').trim() : '');
    let title = text(info?.Title);
    if (/^microsoft word - /i.test(title)) title = title.slice(17).replace(/\.(docx?|rtf|odt)$/i, '');
    const lower = title.toLowerCase();
    if (lower === 'untitled' || /\.(pdf|doc|indd)$/.test(lower) || !/[\p{L}\p{N}]/u.test(title)) title = '';
    const authors = text(info?.Author).split(/[;,]/).map((part) => part.trim())
        .filter((part) => /\p{L}/u.test(part) && !['unknown', 'microsoft office user'].includes(part.toLowerCase()));
    return { title, authors };
}

/// The outline's first level as the book's contents — under the book's own
/// title when the outline is that one entry with the chapters inside. Each
/// with its page, 1-based.
async function contents(doc) {
    try {
        let items = await doc.getOutline();
        if (!items?.length) return [];
        if (items.length === 1 && items[0].items?.length > 1) items = items[0].items;
        const chapters = [];
        for (const item of items.slice(0, 500)) {
            const index = await pageOf(doc, item.dest);
            const title = (item.title || '').trim();
            if (index != null && title) chapters.push({ title, page: index + 1 });
        }
        return chapters;
    } catch {
        return [];
    }
}

async function pageOf(doc, dest) {
    try {
        const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
        if (!Array.isArray(explicit)) return null;
        return Number.isInteger(explicit[0]) ? explicit[0] : await doc.getPageIndex(explicit[0]);
    } catch {
        return null;
    }
}

/// An empty picture of the page's shape, until the page is drawn.
const blank = (width, height) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"/>`);

/// `mode`: 'text' or 'pages' as the reader chose for this book; none, the
/// document decides and the reader is asked (`pdf.asked`). `progress(done,
/// total)` is told as the text is read.
export async function convertPDF(bytes, name, { mode, progress } = {}) {
    const lib = await pdfjs();
    let doc, loading;
    try {
        loading = lib.getDocument({
            data: bytes,
            cMapUrl: base + 'cmaps/', cMapPacked: true,
            standardFontDataUrl: base + 'standard_fonts/',
            wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/',
            isEvalSupported: false, enableXfa: false,
        });
        doc = await loading.promise;
    } catch (error) {
        loading?.destroy();
        if (error?.name === 'PasswordException') throw new Error('This PDF is protected by a password.');
        throw new Error('This PDF could not be read.');
    }
    if (!doc.numPages) {
        loading.destroy();
        throw new Error('This PDF could not be read.');
    }

    const [meta, outline, layout, preferences] = await Promise.all([
        doc.getMetadata().catch(() => ({})),
        contents(doc),
        doc.getPageLayout().catch(() => ''),
        doc.getViewerPreferences().catch(() => null),
    ]);
    const { title, authors } = described(meta.info);
    // Text for a book: a text layer worth the name over eight pages and
    // more. A form, an invoice, a short paper keeps its layout — read as
    // text it came out as a heap of lines with «chapters» (user, 13.11).
    // Offered at all where there is any text; a scan has none.
    const sample = await sampleText(doc).catch(() => ({ pages: doc.numPages, pagesWithText: 0, characters: 0 }));
    const readable = sample.pagesWithText > 0;
    const given = mode === 'text' || mode === 'pages';
    const chosen = given ? mode : hasTextLayer(sample) && doc.numPages >= 8 ? 'text' : 'pages';
    const asked = !given && readable;
    if (chosen === 'text' && readable) {
        const book = await asText(doc, { title, authors, outline, name, language: meta.info?.Language, progress });
        if (book) {
            loading.destroy();
            return { ...book, pdf: { mode: 'text', text: true, asked } };
        }
    }

    // Every page's size, nothing drawn: the script lays the book out by them.
    const sizes = [];
    for (let start = 1; start <= doc.numPages; start += 32) {
        const batch = [];
        for (let n = start; n < start + 32 && n <= doc.numPages; n++) {
            batch.push(doc.getPage(n).then((page) => {
                const { width, height } = page.getViewport({ scale: 1 });
                return [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
            }));
        }
        sizes.push(...await Promise.all(batch));
    }

    const chapters = outline.map((chapter) => ({ title: chapter.title, id: '_cr_p' + chapter.page }));
    // The document's own word on its spreads (#1027): TwoPageRight opens on
    // page 1 alone, as a bound book; most PDFs say nothing and pair 1 with 2.
    const firstAlone = ['TwoPageRight', 'TwoColumnRight'].includes(layout);
    // A Map in pdf.js 6, a plain object before it.
    const rightToLeft = (preferences?.get?.('Direction') ?? preferences?.Direction) === 'R2L';

    const holder = document.implementation.createHTMLDocument('');
    const body = holder.createElement('div');
    sizes.forEach(([width, height], index) => {
        const slot = holder.createElement('div');
        slot.className = '_cr_page';
        slot.id = '_cr_p' + (index + 1);
        const img = holder.createElement('img');
        img.src = blank(width, height);
        img.width = width;
        img.height = height;
        img.alt = '';
        img.dataset.pdfPage = String(index + 1);
        slot.appendChild(img);
        body.appendChild(slot);
    });

    const shown = title || nameFromFile(name);
    let drawer = null;
    return {
        title: shown, author: authors.join(', '), language: '',
        rightToLeft, chapters, urls: [],
        pages: { rtl: rightToLeft, strip: false, firstAlone },
        pdf: { mode: 'pages', text: readable, asked },
        html: pagesPage(body.innerHTML, shown),
        attach(view) { drawer?.stop(); drawer = drawPages(doc, view, sizes); },
        release() { drawer?.stop(); drawer = null; loading.destroy(); },
    };
}

// MARK: - Text

/// The book as text: the blocks in the family's page, the outline's entries
/// on the blocks they point at (a heading on that page, else its first
/// block), or the headings where the outline says nothing more than the
/// title. Null with no text.
async function asText(doc, { title, authors, outline, name, language, progress }) {
    const { blocks, stats } = await readText(doc, {}, progress);
    if (!stats.pagesWithText || !blocks.length) return null;
    let chapters = [];
    // An outline of one entry is the book's title, not its contents.
    for (const entry of outline.length > 1 ? outline : []) {
        let at = blocks.findIndex((block) => block.page === entry.page && block.kind !== 'paragraph' && block.kind !== 'note');
        if (at < 0) at = blocks.findIndex((block) => block.page >= entry.page);
        if (at < 0) continue;
        if (blocks[at].kind === 'paragraph' || blocks[at].kind === 'note') blocks[at].anchor = true;
        chapters.push({ title: entry.title, id: '_cr_b' + at });
    }
    // The headings as the contents only for a document with room for
    // them: a page's large lines are not its sections.
    if (!chapters.length && doc.numPages >= 3) {
        const headings = blocks.map((block, at) => ({ block, at })).filter(({ block }) => block.kind === 'h1' || block.kind === 'h2');
        if (headings.length >= 3) chapters = headings.map(({ block, at }) => ({ title: block.text.replace(/\n/g, ' '), id: '_cr_b' + at }));
    }
    const heading = blocks.find((block) => block.kind === 'h1')?.text.replace(/\n/g, ' ');
    const shown = title || heading || nameFromFile(name);
    const lang = typeof language === 'string' ? language.trim().toLowerCase() : '';
    return {
        title: shown, author: authors.join(', '), language: lang, chapters,
        html: textPage(textHTML(blocks), shown, lang, '.footnote { font-size: 0.85em; opacity: 0.8; text-indent: 0; }'),
    };
}

// MARK: - Drawing

/// Pages drawn this much ahead of the screen and behind it, in screens.
const AHEAD = '100%';
/// A canvas every browser draws: the long side and the area.
const LONGEST = 4096, AREA = 16e6;
/// Drawn pages kept past the ones near the screen.
const SPARE = 6;

function drawPages(doc, view, sizes) {
    const page = view.document;
    const images = new Map([...page.querySelectorAll('img[data-pdf-page]')].map((img) => [Number(img.dataset.pdfPage), img]));
    const near = new Set();
    const drawn = new Map();
    let busy = false, stopped = false, clock = 0, settle = 0;

    /// The scale the page is shown at, in the screen's pixels.
    function wanted(n) {
        const [width, height] = sizes[n - 1];
        const box = images.get(n).getBoundingClientRect();
        let fit = Math.min(box.width / width, box.height / height);
        if (!(fit > 0) || !Number.isFinite(fit)) fit = Math.max(view.innerWidth, view.innerHeight) / Math.max(width, height);
        const scale = fit * (view.devicePixelRatio || 1);
        return Math.max(0.25, Math.min(scale, LONGEST / Math.max(width, height), Math.sqrt(AREA / (width * height))));
    }

    /// How far a page is from the middle of the screen.
    function distance(n) {
        const box = images.get(n).getBoundingClientRect();
        return Math.hypot(box.left + box.width / 2 - view.innerWidth / 2, box.top + box.height / 2 - view.innerHeight / 2);
    }

    // Not yet drawn, or drawn for a smaller page than the screen shows now.
    const due = (n) => { const it = drawn.get(n); return !it || (!it.failed && it.scale < wanted(n) * 0.75); };

    async function draw(n) {
        const scale = wanted(n);
        const canvas = document.createElement('canvas');
        try {
            const proxy = await doc.getPage(n);
            const viewport = proxy.getViewport({ scale });
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await proxy.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
            proxy.cleanup();
            if (stopped) return;
            const ink = inkIn(canvas);
            const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.9));
            if (stopped || !blob) return;
            const url = URL.createObjectURL(blob);
            // The ink tag rides the fragment, as a CBZ page's does.
            images.get(n).src = `${url}#p${n}${ink ? '.mono' : ''}.jpg`;
            const old = drawn.get(n);
            if (old?.url) URL.revokeObjectURL(old.url);
            drawn.set(n, { url, scale, used: ++clock });
        } catch {
            if (!stopped) drawn.set(n, { failed: true, scale: 0, used: ++clock });
        } finally {
            canvas.width = canvas.height = 0;
        }
    }

    /// The farthest drawn pages go back to blank once there are more than
    /// the ones near the screen and a few spare.
    function forget() {
        const room = near.size + SPARE;
        if (drawn.size <= room) return;
        const far = [...drawn.keys()].filter((n) => !near.has(n)).sort((a, b) => distance(b) - distance(a));
        for (const n of far.slice(0, drawn.size - room)) {
            const it = drawn.get(n);
            if (it.url) URL.revokeObjectURL(it.url);
            const [width, height] = sizes[n - 1];
            images.get(n).src = blank(width, height);
            drawn.delete(n);
        }
    }

    async function pump() {
        if (busy || stopped) return;
        busy = true;
        try {
            for (;;) {
                if (stopped) return;
                const next = [...near].filter(due).sort((a, b) => distance(a) - distance(b))[0];
                if (!next) break;
                await draw(next);
            }
            forget();
        } finally {
            busy = false;
        }
    }

    const observer = new view.IntersectionObserver((entries) => {
        for (const entry of entries) {
            const n = Number(entry.target.dataset.pdfPage);
            if (entry.isIntersecting) near.add(n); else near.delete(n);
        }
        pump();
    }, { root: page, rootMargin: AHEAD });
    for (const img of images.values()) observer.observe(img);

    // A larger window, the full screen, fewer columns: the pages near
    // the screen are drawn again where they are now shown larger.
    const resized = () => { clearTimeout(settle); settle = setTimeout(pump, 250); };
    view.addEventListener('resize', resized);

    return {
        stop() {
            stopped = true;
            observer.disconnect();
            clearTimeout(settle);
            view.removeEventListener('resize', resized);
            for (const it of drawn.values()) if (it.url) URL.revokeObjectURL(it.url);
            drawn.clear();
        },
    };
}
