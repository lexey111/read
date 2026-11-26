// The book's drawer in its own window (NanoReader): a mirror of the one in
// the reader's window (aside-host.js), drawn here, with what the reader
// does sent back to be done there. The fields keep what is typed in them;
// all else is the reader's window's to say.

const tauri = window.__TAURI__;
const own = tauri.window.getCurrentWindow();
const host = document.getElementById('drawer');
const root = document.documentElement;
import { pictureStep } from './drawer.js';
const tell = (kind, more = {}) => tauri.event.emitTo('main', 'aside-do', { kind, ...more }).catch(() => {});

const pathOf = (node) => {
    const steps = [];
    for (; node && node !== host; node = node.parentNode) steps.unshift([...node.parentNode.childNodes].indexOf(node));
    return node === host ? steps : null;
};
const nodeAt = (steps) => steps.reduce((node, index) => node?.childNodes[index], host);

/// `into` made like `from`, node by node: what stands where it stood is
/// kept — a field being typed in, the lists' scroll.
function patch(into, from) {
    const want = [...from.childNodes];
    want.forEach((node, index) => {
        const old = into.childNodes[index];
        if (!old) { into.append(node.cloneNode(true)); return; }
        if (old.nodeType !== node.nodeType || old.nodeName !== node.nodeName) { old.replaceWith(node.cloneNode(true)); return; }
        if (node.nodeType !== Node.ELEMENT_NODE) { if (old.data !== node.data) old.data = node.data; return; }
        for (const { name } of [...old.attributes]) if (!node.hasAttribute(name)) old.removeAttribute(name);
        for (const { name, value } of node.attributes) if (old.getAttribute(name) !== value) old.setAttribute(name, value);
        patch(old, node);
    });
    while (into.childNodes.length > want.length) into.lastChild.remove();
}

let chosen = new Set();
let first = true;
tauri.event.listen('aside', ({ payload: said }) => {
    root.lang = said.lang || 'en';
    root.toggleAttribute('data-dark', said.dark);
    root.toggleAttribute('data-dusk', !!said.dusk);
    for (const [name, value] of Object.entries(said.vars)) root.style.setProperty(name, value);
    own.setTheme(said.dark ? 'dark' : 'light').catch(() => {});
    // Its title in the drawer's own colour.
    own.setBackgroundColor?.(getComputedStyle(root).getPropertyValue('--c-window').trim() || (said.dark ? '#2a2a2d' : '#f5f5f6')).catch(() => {});
    if (document.title !== said.title) { document.title = said.title; own.setTitle(said.title).catch(() => {}); }
    const made = document.createElement('template');
    made.innerHTML = said.html;
    patch(host, made.content);
    for (const [path, value] of said.values) {
        const field = path && nodeAt(path);
        if (field && field !== document.activeElement && field.value !== value) field.value = value;
    }
    if (said.focus) {
        const field = nodeAt(said.focus);
        if (field && field !== document.activeElement) { field.focus(); field.select?.(); }
    }
    // The row the reader is at, in view: in the middle the first time.
    const now = new Set([...host.querySelectorAll('.chosen')].filter((row) => row.offsetParent));
    for (const row of now) if (!chosen.has(row)) row.scrollIntoView({ block: first ? 'center' : 'nearest' });
    chosen = now;
    first = false;
});

// What the reader does here, done there.
host.addEventListener('click', (event) => tell('click', { path: pathOf(event.target) }));
host.addEventListener('dblclick', (event) => tell('dblclick', { path: pathOf(event.target) }));
for (const kind of ['input', 'change']) host.addEventListener(kind, (event) => tell(kind, { path: pathOf(event.target), value: event.target.value }));
host.addEventListener('submit', (event) => { event.preventDefault(); tell('submit', { path: pathOf(event.target) }); });
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); tell('key', { path: [], key: 'Escape' }); return; }
    // The system's search key goes to the search.
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyF') {
        event.preventDefault();
        const tab = host.querySelector('[data-tab="search"]');
        if (tab) tell('click', { path: pathOf(tab) });
        return;
    }
    // The arrows walk a list's rows here, where the keys are; from the
    // search's field, into its hits.
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.isComposing) {
        const down = event.key === 'ArrowDown';
        const field = event.target.matches?.('.search input');
        const list = field ? host.querySelector('[data-section="search"] .list') : event.target.closest?.('.list');
        if (list && (field || event.target.matches('button'))) {
            const rows = [...list.querySelectorAll('button:not(.icon)')];
            const next = field ? (down ? rows[0] : null) : rows[rows.indexOf(event.target) + (down ? 1 : -1)];
            if (next) { event.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); return; }
        }
    }
    // The pictures' grid: the arrows choose here and there, Return and Space
    // are done there.
    if (event.target.matches?.('.pictures button')) {
        const next = pictureStep(event.target, event.key);
        if (next) { event.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); tell('click', { path: pathOf(next) }); return; }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tell('key', { path: pathOf(event.target), key: event.key }); return; }
    }
    // Return on a row is its click, as a button's.
    // Return in the search steps through its hits; a form's (the place to
    // go to) submits by itself.
    if (event.key === 'Enter' && !event.isComposing && event.target.matches?.('input') && !event.target.closest('form')) {
        event.preventDefault();
        tell('key', { path: pathOf(event.target), key: 'Enter', shift: event.shiftKey });
    }
});
// No browser's menu, reload or print here either.
document.addEventListener('contextmenu', (event) => { if (!event.target.closest('input, textarea')) event.preventDefault(); });
document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && ['KeyR', 'KeyP', 'KeyG'].includes(event.code)) event.preventDefault();
    if (event.key === 'F5') event.preventDefault();
}, true);

// Its close button shuts the drawer; where it stands is kept for next time.
own.onCloseRequested((event) => { event.preventDefault(); tell('close'); });
async function place() {
    const scale = await own.scaleFactor();
    const at = await own.outerPosition();
    const size = await own.innerSize();
    tell('place', { value: { x: Math.round(at.x / scale), y: Math.round(at.y / scale), width: Math.round(size.width / scale), height: Math.round(size.height / scale) } });
}
let placing = 0;
const placeSoon = () => { clearTimeout(placing); placing = setTimeout(() => place().catch(() => {}), 300); };
own.onMoved(placeSoon);
own.onResized(placeSoon);
tell('ready');
