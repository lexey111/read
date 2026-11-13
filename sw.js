// Works without the network: the reader's own files are kept as they come
// and served from the keep when the network is not there. The network is
// asked first, so a new version is used as soon as it is reachable. The
// books are not here — they never leave the page (the last one is in the
// page's own IndexedDB) — but one shared from another app (Android's
// share sheet) waits here a moment for the page to take it.

// Stamped by scripts/stamp-version.sh with every commit: a new version is
// a new worker, which keeps its files under its own name, drops the old
// ones and tells the open pages (`controllerchange`).
const VERSION = '1.8.30';
const KEEP = 'webreader-' + VERSION;
// pdf.js changes with its own number, not ours: kept across versions, so
// a PDF opens offline after an update too. The package's version.
const PDFJS = 'pdfjs-6.5.438';
const SHARED = 'webreader-shared';
const SHELL = [
    './', 'index.html', 'shell.css', 'manifest.webmanifest',
    'shell.js', 'model.js', 'panel.js', 'progress.js', 'apps.js', 'ornament.js', 'version.js', 'news.js', 'i18n.js', 'store.js',
    'book.js', 'link.js', 'zip.js', 'bytes.js', 'sanitize.js', 'template.js',
    'epub.js', 'fb2.js', 'markdown.js', 'text.js', 'pages.js', 'pdf.js', 'pdftext.js', 'mobi.js',
    'engine/PositionTracker.js',
    'engine/paper/lined.png', 'engine/paper/squared.png', 'engine/paper/sand.png',
    'engine/paper/kraft.png', 'engine/paper/fibre.png', 'engine/paper/laid.png',
    'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/seal.svg', 'img/room-jr.webp', 'img/room-pr.webp', 'img/room-cr.webp',
    'fonts/source-serif-4-latin-opsz.woff2', 'fonts/source-serif-4-latin-opsz-italic.woff2', 'fonts/inter-latin-wght.woff2', 'icons/apps/icon-jr.svg', 'icons/apps/icon-pr.svg', 'icons/apps/icon-cr.svg',
];

self.addEventListener('install', (event) => {
    // Past the browser's own cache: the host lets it keep a file ten
    // minutes, and a new version must not be filled with the old files.
    event.waitUntil(caches.open(KEEP)
        .then((keep) => keep.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
        .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((names) => Promise.all(names.filter((name) => ![KEEP, PDFJS, SHARED].includes(name)).map((name) => caches.delete(name))))
        .then(() => self.clients.claim()));
});

/// A file shared to the installed reader (the manifest's `share_target`):
/// kept for the page, which takes it at `?shared`.
async function share(request) {
    try {
        const file = (await request.formData()).get('book');
        if (file && typeof file !== 'string') {
            const keep = await caches.open(SHARED);
            await keep.put('book', new Response(file, { headers: { 'X-Name': encodeURIComponent(file.name || 'book') } }));
        }
    } catch {
        // Nothing to keep: the page opens as it would.
    }
    return Response.redirect('./?shared', 303);
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (url.origin !== location.origin) return;
    if (request.method === 'POST' && url.pathname.endsWith('/share')) {
        event.respondWith(share(request));
        return;
    }
    if (request.method !== 'GET' || url.pathname.includes('/samples/')) return;
    // Asked of the server every time (a 304 when nothing changed): the
    // host lets a browser keep files for ten minutes, and a new version
    // waited that long. A page's own request can't be copied with options.
    const fresh = request.mode === 'navigate' ? new Request(request.url, { cache: 'no-cache' }) : new Request(request, { cache: 'no-cache' });
    const keep = url.pathname.includes('/vendor/pdfjs/') ? PDFJS : KEEP;
    event.respondWith(fetch(fresh)
        .then((response) => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(keep).then((cache) => cache.put(request, copy));
            }
            return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((kept) => kept || caches.match('index.html'))));
});
