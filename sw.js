// Works without the network: the reader's own files are kept as they come
// and served from the keep when the network is not there. The network is
// asked first, so a new version is used as soon as it is reachable. The
// books are not here — they never leave the page (the last one is in the
// page's own IndexedDB).

const KEEP = 'nano-reader-v1';
const SHELL = [
    './', 'index.html', 'shell.css', 'manifest.webmanifest',
    'shell.js', 'model.js', 'panel.js', 'progress.js', 'apps.js', 'ornament.js', 'version.js', 'news.js', 'i18n.js', 'store.js',
    'book.js', 'zip.js', 'bytes.js', 'sanitize.js', 'template.js',
    'epub.js', 'fb2.js', 'markdown.js', 'text.js', 'pages.js', 'pdf.js',
    'engine/PositionTracker.js',
    'engine/paper/lined.png', 'engine/paper/squared.png', 'engine/paper/sand.png',
    'engine/paper/kraft.png', 'engine/paper/fibre.png', 'engine/paper/laid.png',
    'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/seal.svg', 'img/room-jr.webp', 'img/room-pr.webp', 'img/room-cr.webp',
    'fonts/source-serif-4-latin-opsz.woff2', 'fonts/source-serif-4-latin-opsz-italic.woff2', 'fonts/inter-latin-wght.woff2', 'icons/apps/icon-jr.svg', 'icons/apps/icon-pr.svg', 'icons/apps/icon-cr.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(KEEP).then((keep) => keep.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((names) => Promise.all(names.filter((name) => name !== KEEP).map((name) => caches.delete(name))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/samples/')) return;
    // Asked of the server every time (a 304 when nothing changed): the
    // host lets a browser keep files for ten minutes, and a new version
    // waited that long. A page's own request can't be copied with options.
    const fresh = request.mode === 'navigate' ? new Request(request.url, { cache: 'no-cache' }) : new Request(request, { cache: 'no-cache' });
    event.respondWith(fetch(fresh)
        .then((response) => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(KEEP).then((keep) => keep.put(request, copy));
            }
            return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((kept) => kept || caches.match('index.html'))));
});
