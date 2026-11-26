// NanoReader's pages, a program's: the books at hand and the history, the
// notes of every book, the journal, the statistics. Each is drawn from what
// `desk.js` keeps into the window's body, its own tools into the toolbar.
// Nothing is counted twice and nothing leaves the program.

import { t, language } from './i18n.js';
import { make, percent } from './drawer.js';
import { colours } from './marks.js';
import { desk, dropFromHistory, marksOf, changeMark, removeMark, setNote } from './desk.js';
import { standing, savedFile } from './desktop.js';
import { formats, write } from './desk-export.js';

// MARK: - Words

const day = (at) => { const date = new Date(at); date.setHours(0, 0, 0, 0); return date.getTime(); };
const dayBefore = (start, days) => { const date = new Date(start); date.setDate(date.getDate() - days); return date.getTime(); };
const date = (at, options) => new Intl.DateTimeFormat(language(), options).format(at);
const number = (value) => new Intl.NumberFormat(language()).format(value);

/// «2 h 05 min», in the language's own short units.
export function span(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    const unit = (value, name) => new Intl.NumberFormat(language(), { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
    if (minutes < 60) return unit(minutes, 'minute');
    const rest = minutes % 60;
    return unit(Math.floor(minutes / 60), 'hour') + (rest ? ' ' + unit(rest, 'minute') : '');
}

/// «Today», «Yesterday», else the date; with the year where it is another.
export function dayName(at, length = 'long') {
    const start = day(at), today = day(Date.now());
    if (start === today) return t('Today');
    if (start === dayBefore(today, 1)) return t('Yesterday');
    const same = new Date(at).getFullYear() === new Date().getFullYear();
    const words = date(at, { ...(length === 'long' ? { weekday: 'long' } : {}), day: 'numeric', month: length, ...(same ? {} : { year: 'numeric' }) });
    return words[0].toLocaleUpperCase(language()) + words.slice(1);
}

const clockTime = (at) => date(at, { hour: 'numeric', minute: '2-digit' });

export const button = (words, pressed, kind = '') => {
    const node = make('button', { type: 'button', class: `btn ${kind}`.trim(), text: t(words) });
    node.addEventListener('click', pressed);
    return node;
};

const empty = (words) => make('div', { class: 'empty' }, make('p', { text: t(words) }));
const line = (share) => {
    const fill = make('i');
    fill.style.width = `${(share * 100).toFixed(1)}%`;
    return make('span', { class: 'meter', 'aria-hidden': 'true' }, fill);
};
const far = (share) => make('span', { class: 'far' }, line(share), make('span', { text: percent(share) }));

/// A table: `columns` are [word, width, 'num'?], `rows` are tr's.
function table(columns, rows, kind = '') {
    const tall = make('table', { class: kind });
    tall.append(
        make('colgroup', {}, ...columns.map(([, width]) => { const col = make('col'); if (width) col.style.width = width; return col; })),
        make('thead', {}, make('tr', {}, ...columns.map(([word, , side]) => make('th', { class: side || '', text: word ? t(word) : '' })))),
        make('tbody', {}, ...rows));
    return tall;
}

const cell = (content, side = '') => {
    const node = make('td', { class: side });
    if (content instanceof Node) node.append(content);
    else { node.textContent = content ?? ''; if (content) node.title = content; }
    return node;
};

/// The actions' glyphs, in menus and on the buttons over the lists: by the
/// item's word, or named by the item itself (a word already said).
const actionIcons = {
    edit: '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
    open: '<path d="M4 6.5C6.5 5 9.5 5 12 6.5c2.5-1.5 5.5-1.5 8 0V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0zM12 6.5V19"/>',
    delete: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5"/>',
    start: '<path d="M6 5v14M18 12H9.5M13 8l-4 4 4 4"/>',
    end: '<path d="M18 5v14M6 12h8.5M11 8l4 4-4 4"/>',
    about: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
    load: '<path d="M12 4v10M8 10l4 4 4-4M5 16v3h14v-3"/>',
    forget: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/><path d="M4 4l16 16"/>',
    file: '<path d="M7 3.5h7l4 4V20.5H7zM14 3.5V8h4"/>',
    link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
    book: '<path d="M6 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v13.5H7.5A1.5 1.5 0 0 1 6 18zM6 18a1.5 1.5 0 0 1 1.5-1.5H18"/>',
    read: '<path d="M8 5.5v13l10-6.5z"/>',
    comment: '<path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z"/><path d="M8.5 9h7M8.5 12h4.5"/>',
};
const iconFor = { 'Edit the comment': 'comment', 'Edit the note': 'edit', 'Open at the note': 'open', Delete: 'delete', 'Go to the book': 'open', 'About the book…': 'about', 'Remove from the history': 'forget', 'From a file…': 'file', 'From a link…': 'link', 'All of the history…': 'history', Read: 'read', Remove: 'delete' };
const glyph = (name) => (name && actionIcons[name] ? svgIcon(actionIcons[name], 'act') : null);

/// The family's list on the desk (user, 26.11.2026): a click chooses a
/// row; another on the chosen one, or Return, does its main thing; the
/// arrows walk the rows, Home and End go to the ends; the right button, or
/// the menu key, gives its menu. A row is never a door at a single click.
/// `id` keeps the choice across a redraw (a card closed, a note changed);
/// `chose` is told when the row is chosen (a list whose choice is its act).
/// The page's action buttons follow the chosen row (`actionBar`).
const chosenIds = new Map();
function pickable(row, { id, list = 'rows', open, menu, chose } = {}) {
    row.classList.add('pickrow');
    row.tabIndex = -1;
    if (id !== undefined) row.dataset.pick = `${list}:${id}`;
    row.menuItems = menu;
    const group = () => [...(row.closest('[data-list]') || row.parentNode).querySelectorAll('.pickrow')];
    const choose = (one) => {
        for (const other of group()) { const it = other === one; other.classList.toggle('chosen', it); other.tabIndex = it ? 0 : -1; }
        if (one.dataset.pick) chosenIds.set(list, one.dataset.pick);
        one.focus({ preventScroll: true });
        one.scrollIntoView({ block: 'nearest' });
        one.chose?.();
        one.dispatchEvent(new CustomEvent('picked', { bubbles: true }));
    };
    row.chose = chose;
    row.addEventListener('click', (event) => {
        if (event.target.closest('a, input, textarea, select')) return;
        if (row.classList.contains('chosen') && open) open(); else choose(row);
    });
    row.addEventListener('keydown', (event) => {
        if (event.target !== row) return;
        const all = group();
        const at = all.indexOf(row);
        const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
        if (to !== undefined) { event.preventDefault(); if (all[to]) choose(all[to]); return; }
        if (event.key === 'Enter' && open) { event.preventDefault(); open(); return; }
        if (menu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault();
            const where = row.getBoundingClientRect();
            popMenu(menu(), { x: where.left + 24, y: where.bottom });
        }
    });
    if (menu) row.addEventListener('contextmenu', (event) => { event.preventDefault(); choose(row); popMenu(menu(), { x: event.clientX, y: event.clientY }); });
    // Chosen before a redraw: chosen again.
    if (row.dataset.pick && chosenIds.get(list) === row.dataset.pick) { row.classList.add('chosen'); row.tabIndex = 0; }
    // The list is reached by Tab at its first row, or its chosen one.
    queueMicrotask(() => { const all = group(); if (all.length && !all.some((one) => one.tabIndex === 0)) all[0].tabIndex = 0; });
    return row;
}

/// Buttons over a list for its chosen row: the row's menu, its rules left
/// out; before a choice, the first row's, not to be pressed.
function actionBar(tools, body) {
    const bar = make('div', { class: 'actions' });
    tools.prepend(bar);
    const draw = () => {
        const chosen = body.querySelector('.pickrow.chosen');
        const items = (chosen || body.querySelector('.pickrow'))?.menuItems?.() || [];
        bar.replaceChildren(...items.filter(Array.isArray).map(([words, act, more, icon, short]) => {
            const said = more === undefined ? t(words) : words;
            const press = make('button', { type: 'button', class: 'btn', title: said }, glyph(icon || iconFor[words]), make('span', { text: short || said }));
            press.disabled = !chosen;
            press.addEventListener('click', act);
            return press;
        }));
        fit();
    };
    // Its words where they fit; where not, the glyphs alone, the words in
    // their tips — never a button cut in half (user, 26.11.2026).
    const fit = () => {
        bar.classList.remove('compact');
        if (bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('compact');
    };
    // The toolbar's own box: `tools` is laid out in it (display: contents).
    new ResizeObserver(fit).observe(tools.closest('.tools') || tools.parentElement || tools);
    body.addEventListener('picked', draw);
    queueMicrotask(draw);
    return draw;
}

// MARK: - Books

let coverURLs = [];

const svgIcon = (paths, kind = '') => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (kind) svg.setAttribute('class', kind);
    svg.innerHTML = paths;
    return svg;
};

/// The family's butterfly, JustReader's — NanoReader is its port to other
/// computers: the wings' outline in the ink, the dot at the body orange.
const butterfly = () => {
    const svg = svgIcon('<g class="wings"><path d="M -8,4 C -16,44 -62,60 -74,38 C -86,16 -66,-14 -46,-12 C -28,-10 -14,-4 -8,0 Z"/><path d="M 8,4 C 16,44 62,60 74,38 C 86,16 66,-14 46,-12 C 28,-10 14,-4 8,0 Z"/><path d="M -8,-2 C -24,-70 -98,-96 -112,-58 C -125,-20 -98,38 -66,33 C -42,28 -18,12 -8,0 Z"/><path d="M 8,-2 C 24,-70 98,-96 112,-58 C 125,-20 98,38 66,33 C 42,28 18,12 8,0 Z"/></g><circle class="body" cx="0" cy="0" r="8"/>', 'butterfly');
    svg.setAttribute('viewBox', '-120 -97 240 164');
    return svg;
};

/// The three places, a card each, as JustReader's system skin has them: in a
/// row where the window is wide, one under another where it is tall. A
/// card is read by its button alone; a free place loads a book — from a
/// file, a link, the closed books. The last read wears the accent.
export async function renderBooks(body, tools, api) {
    tools.replaceChildren();
    const placed = await api.places();
    // Another page came meanwhile: the window is its own.
    if (!api.stillHere()) return;
    for (const url of coverURLs) URL.revokeObjectURL(url);
    coverURLs = [];
    const onShelf = new Set(placed.filter(Boolean).map((record) => record.key));
    const last = desk.history.find((entry) => onShelf.has(entry.key))?.key;
    const closed = await closedBooks(onShelf);
    if (!api.stillHere()) return;
    const cards = placed.map((record, at) => (record ? slot(record, api, record.key === last) : freeSlot(at, closed, api)));
    const shelf = make('div', { class: 'shelf' }, make('div', { class: 'slots' }, make('div', { class: 'row' }, ...cards)));
    walkCards(cards, placed, last, body);
    if (!onShelf.size) shelf.append(make('p', { class: 'fine', text: `${t(api.formats)}. ${t('or drop it on the page')[0].toUpperCase()}${t('or drop it on the page').slice(1)}.` }));
    body.replaceChildren(shelf);
}

/// The books opened or loaded before and not at hand now, whose files or
/// links are still there.
async function closedBooks(onShelf) {
    const entries = desk.history.filter((entry) => !onShelf.has(entry.key));
    const there = entries.length ? await standing(entries.map((entry) => entry.path || '')).catch(() => entries.map(() => false)) : [];
    return entries.map((entry, index) => ({ entry, reachable: !!(there[index] || entry.link) }));
}

/// The cards walked by the arrows (user, 26.11.2026): left and right, up
/// and down where they stand one under another; Return reads the chosen
/// one, or opens a free one's «Load»; a click chooses. The last read is
/// chosen at first; the choice outlives a redraw.
let chosenSlot = -1;
function walkCards(cards, placed, last, body) {
    if (chosenSlot < 0 || chosenSlot >= cards.length) chosenSlot = Math.max(0, placed.findIndex((record) => record?.key === last));
    const choose = (at, focus = true) => {
        chosenSlot = at;
        cards.forEach((card, index) => { card.classList.toggle('chosen', index === at); card.tabIndex = index === at ? 0 : -1; });
        if (focus) cards[at].focus({ preventScroll: true });
    };
    cards.forEach((card, at) => {
        card.addEventListener('pointerdown', (event) => { if (!event.target.closest('button')) choose(at); });
        card.addEventListener('focusin', () => { if (chosenSlot !== at) choose(at, false); });
        card.addEventListener('keydown', (event) => {
            if (event.target !== card) return;
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
            if (step) { event.preventDefault(); choose((at + step + cards.length) % cards.length); return; }
            if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); choose(event.key === 'Home' ? 0 : cards.length - 1); return; }
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.querySelector('.read, .load')?.click(); }
        });
    });
    choose(chosenSlot, false);
    // The keys to the cards when the window has them (a book just closed).
    queueMicrotask(() => { if (document.activeElement === body || document.activeElement === document.body) cards[chosenSlot]?.focus({ preventScroll: true }); });
}

/// «EPUB · 185 KB», from the file's name and the size in the book's key.
function about(record) {
    const kind = (record.name || '').split('.').pop().toUpperCase();
    const bytes = Number(String(record.key).split(':').pop());
    const size = bytes > 0 ? new Intl.NumberFormat(language(), { style: 'unit', unit: bytes >= 1048576 ? 'megabyte' : 'kilobyte', unitDisplay: 'short', maximumFractionDigits: bytes >= 1048576 ? 1 : 0 }).format(bytes >= 1048576 ? bytes / 1048576 : Math.max(1, bytes / 1024)) : '';
    return [kind.length <= 5 ? kind : '', size].filter(Boolean).join(' · ');
}

/// What the reader has done with a book: time, marks, the last day.
function figures(key) {
    const seconds = desk.journal.filter((one) => one.key === key).reduce((sum, one) => sum + one.seconds, 0);
    const marks = marksOf(key).list.length;
    const opened = desk.history.find((entry) => entry.key === key)?.opened || desk.books[key]?.opened;
    const item = (paths, words, title) => make('span', { class: 'figure', title }, svgIcon(paths), make('span', { text: words }));
    return make('span', { class: 'figures' },
        seconds ? item('<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>', span(seconds), t('Reading time')) : null,
        marks ? item('<path d="M7 4h10v16l-5-4-5 4z"/>', number(marks), t('Marks')) : null,
        opened ? item('<path d="M5 6h14v13H5zM5 10h14M9 4v4M15 4v4"/>', dayName(opened, 'short'), t('Last opened')) : null);
}

/// The cover as a picture of its own size, fitted in the room the card
/// leaves it (no container units: WebKit kept them from before a resize,
/// and the covers were gone — user, 26.11.2026).
const coverOf = (record) => {
    if (record.cover?.bytes) {
        const url = URL.createObjectURL(new Blob([record.cover.bytes], { type: record.cover.type }));
        coverURLs.push(url);
        return make('img', { class: 'cover', src: url, alt: '' });
    }
    // No picture: the first letter or digit of any script.
    return make('span', { class: 'cover letter', text: [...(record.title || '').replace(/^[^\p{L}\p{N}]+/u, '')][0] || '' });
};

function slot(record, api, last) {
    const read = api.progress(record.key);
    const go = make('button', { type: 'button', class: 'btn prominent read', text: t('Read') });
    go.setAttribute('aria-label', `${t('Read')}: ${record.title}${record.author ? ', ' + record.author : ''}`);
    go.addEventListener('click', () => api.reopen(record));
    const remove = make('button', { type: 'button', class: 'forget', title: t('Remove'), 'aria-label': `${t('Remove')}: ${record.title}` }, svgIcon('<path d="M12 5.5l6.5 7.5h-13zM5.5 17.5h13"/>'));
    remove.addEventListener('click', async () => {
        if (!(await confirmRemove(record))) return;
        await api.forget(record.key);
        api.again();
    });
    // The book's own comment, a door beside «Read» (user, 26.11.2026).
    const comment = make('button', { type: 'button', class: 'btn comment', title: t('Comment'), 'aria-label': `${t('Comment')}: ${record.title}` }, glyph('comment'));
    comment.classList.toggle('has', !!marksOf(record.key).note.trim());
    comment.addEventListener('click', () => commentCard(record.key, record.title, api));
    // The cover, then what is said of the book with its doors under it:
    // the doors at the card's foot, a row across the cards (user,
    // 26.11.2026); one under the words where the cards lie in a column.
    const card = make('div', { class: 'book' },
        make('span', { class: 'face' }, coverOf(record)),
        make('span', { class: 'info' },
            make('span', { class: 'words' },
                make('span', { class: 'name', text: record.title, title: record.title }),
                make('span', { class: 'author', text: record.author || '' }),
                make('span', { class: 'how-far' }, line(read), make('span', { class: 'share', text: percent(read) })),
                make('span', { class: 'meta', text: about(record) }),
                figures(record.key)),
            make('span', { class: 'doors' }, go, comment)));
    // A double click on the card reads, as its button does.
    card.addEventListener('dblclick', (event) => { if (!event.target.closest('button')) api.reopen(record); });
    return make('div', { class: last ? 'resume last' : 'resume' }, card, remove);
}

/// A free place: the butterfly, its word, «Load» and its menu.
function freeSlot(at, closed, api) {
    const load = make('button', { type: 'button', class: 'load', 'aria-haspopup': 'menu' }, make('span', { text: t('Load') }), svgIcon('<path d="M7 10l5 5 5-5"/>'));
    load.setAttribute('aria-label', `${t('Free slot')} ${at + 1}: ${t('Load')}`);
    load.addEventListener('click', () => loadMenu(load, at, closed.filter((one) => one.reachable).map((one) => one.entry).slice(0, 6), api));
    // «Load» where the others' «Read» stands.
    return make('div', { class: 'resume free' }, make('div', { class: 'book' },
        make('span', { class: 'face' }, make('span', { class: 'emblem' }, butterfly(), make('span', { class: 'what', text: t('Free slot') }))),
        make('span', { class: 'info' }, make('span', { class: 'doors' }, load))));
}

/// The menu under «Load»: a file, a link, a closed book, all of them.
function loadMenu(anchor, at, offered, api) {
    popMenu([
        ['From a file…', () => api.loadFile(at)],
        ['From a link…', () => api.loadLink(at)],
        ...(offered.length ? [null, t('From the history'), ...offered.map((entry) => [entry.title, () => api.loadEntry(entry, at), entry.author, 'book'])] : []),
        ...(offered.length ? [null, ['All of the history…', () => { location.hash = 'history'; }]] : []),
    ], anchor);
}

/// A menu as a system's: `items` are [words, act, more?] (words a key of
/// the dictionary unless `more` is given), null a rule, a string a label;
/// under `at` — an element — or at a point {x, y}.
let shown = null;
function popMenu(items, at) {
    shown?.close();
    const menu = make('div', { class: 'menu', role: 'menu' });
    for (const item of items) {
        if (item === null) { menu.append(make('hr')); continue; }
        if (typeof item === 'string') { menu.append(make('p', { class: 'label', text: item })); continue; }
        const [words, act, more, icon] = item;
        const mark = glyph(icon || iconFor[words]) || (items.some((one) => Array.isArray(one) && (one[3] || iconFor[one[0]])) ? make('span', { class: 'act-room' }) : null);
        const choice = make('button', { type: 'button', role: 'menuitem' }, mark, make('span', { class: 'words', text: more === undefined ? t(words) : words }), more ? make('span', { class: 'soft', text: more }) : null);
        choice.addEventListener('click', () => { close(); act(); });
        menu.append(choice);
    }
    document.body.append(menu);
    let left, top;
    if (at instanceof Element) {
        const where = at.getBoundingClientRect();
        menu.style.minWidth = `${Math.max(220, where.width)}px`;
        left = where.left + where.width / 2 - menu.offsetWidth / 2;
        top = where.bottom + 6 + menu.offsetHeight > innerHeight - 8 ? where.top - 6 - menu.offsetHeight : where.bottom + 6;
    } else {
        left = at.x;
        top = at.y + menu.offsetHeight > innerHeight - 8 ? at.y - menu.offsetHeight : at.y;
    }
    menu.style.left = `${Math.min(innerWidth - menu.offsetWidth - 8, Math.max(8, left))}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    const keys = (event) => {
        const all = [...menu.querySelectorAll('button')];
        const now = all.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); all[(now + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus(); }
    };
    const away = (event) => { if (!menu.contains(event.target)) close(); };
    function close() {
        menu.remove();
        removeEventListener('keydown', keys, true);
        removeEventListener('pointerdown', away, true);
        removeEventListener('blur', close);
        shown = null;
    }
    addEventListener('keydown', keys, true);
    setTimeout(() => addEventListener('pointerdown', away, true), 0);
    addEventListener('blur', close);
    shown = { close };
    if (at instanceof Element) menu.querySelector('button')?.focus();
}

/// A window of the program's own: a title, words, the rows given, the
/// buttons at its foot. Resolves with the value of the button pressed, or
/// null when closed.
function ask({ title, words, rows = [], buttons, kind = '' }) {
    // The keys go back where they were, to the same row after a redraw.
    const before = document.activeElement;
    const pick = before?.dataset?.pick;
    const back = () => {
        const there = before?.isConnected ? before : pick && document.querySelector(`[data-pick="${CSS.escape(pick)}"]`);
        if (there && !document.querySelector('dialog[open]')) there.focus({ preventScroll: true });
    };
    return new Promise((done) => {
        const box = make('dialog', { class: `ask own ${kind}`.trim() });
        let answer = null;
        const foot = make('footer', {}, ...buttons.map(([label, value, kind]) => {
            const button = make('button', { type: 'button', class: kind || '', text: label });
            button.addEventListener('click', () => { answer = value; box.close(); });
            return button;
        }));
        box.append(make('h2', { text: title }), ...(words ? [make('p', { text: words })] : []), ...rows, foot);
        box.addEventListener('close', () => { box.remove(); done(answer); setTimeout(back, 40); setTimeout(back, 300); }, { once: true });
        document.body.append(box);
        box.showModal();
        box.querySelector('footer button:last-child')?.focus();
    });
}

/// A book let go only when the reader says so: it stays among the closed.
const confirmRemove = (record) => ask({
    title: t('Remove the book?'),
    words: t('{title} frees its place and stays in the closed books, to be loaded again.').replace('{title}', `«${record.title}»`),
    buttons: [[t('Cancel'), false, 'quiet'], [t('Remove'), true, 'prominent']],
});

/// The closed books: those opened or loaded before and not at hand now.
/// A row opens the book's card: what it is, how far, where it can go.
export async function renderHistory(body, tools, api) {
    tools.replaceChildren();
    const placed = await api.places();
    const onShelf = new Set(placed.filter(Boolean).map((record) => record.key));
    const closed = await closedBooks(onShelf);
    if (!api.stillHere()) return undefined;
    if (!closed.length) {
        return body.replaceChildren(make('div', { class: 'quiet-page' },
            butterfly(),
            // A sentence a line.
            make('p', {}, ...t('The books you close will be here, to load them again.').split(/(?<=[.。])\s*/).filter(Boolean).map((sentence) => make('span', { text: sentence })))));
    }
    const grid = table([['Title'], ['Author', '24%'], ['Progress', '128px'], ['Last opened', '170px']], closed.map(({ entry, reachable }) => {
        const known = desk.books[entry.key];
        const card = () => bookCard(entry, reachable, placed, api);
        const free = placed.map((record, at) => (record ? -1 : at)).filter((at) => at >= 0);
        const row = pickable(make('tr', {},
            cell(entry.title), cell(reachable ? entry.author : t('The file is not there any more.')), cell(far(known?.progress || 0)), cell(`${dayName(entry.opened, 'short')}, ${clockTime(entry.opened)}`)), {
            id: entry.key, list: 'closed',
            open: card,
            menu: () => [['About the book…', card],
                ...(reachable && free.length ? [null, ...free.map((at) => [t('Load into place {n}').replace('{n}', at + 1), () => api.loadEntry(entry, at).then(() => { location.hash = 'books'; }), undefined, 'load'])] : []),
                null, ['Remove from the history', () => { dropFromHistory(entry.key); api.again(); }]],
        });
        if (!reachable) row.classList.add('gone');
        row.title = entry.path || entry.link || entry.name || '';
        return row;
    }), 'bare history');
    body.replaceChildren(grid);
    actionBar(tools, grid);
    return undefined;
}

/// A closed book's card: what it is, when, how far; into which free place
/// it goes, or that none is free; out of the history.
async function bookCard(entry, reachable, placed, api) {
    const known = desk.books[entry.key] || {};
    const read = api.progress(entry.key);
    const facts = make('dl', { class: 'facts' },
        ...[[t('Author'), entry.author], [t('Last opened'), `${dayName(entry.opened, 'short')}, ${clockTime(entry.opened)}`], [t('Progress'), percent(read)],
            [t('Reading time'), (() => { const seconds = desk.journal.filter((one) => one.key === entry.key).reduce((sum, one) => sum + one.seconds, 0); return seconds ? span(seconds) : ''; })()],
            [t('Marks'), marksOf(entry.key).list.length ? number(marksOf(entry.key).list.length) : ''],
            [reachable ? '' : '', reachable ? (entry.path || entry.link || known.path || '') : t('The file is not there any more.')]]
            .filter(([, value]) => value)
            .map(([name, value]) => make('div', {}, make('dt', { text: name }), make('dd', { text: value }))));
    const free = placed.map((record, at) => (record ? -1 : at)).filter((at) => at >= 0);
    const places = !reachable ? [] : free.length
        ? [make('div', { class: 'places' }, ...free.map((at) => {
            const into = make('button', { type: 'button', class: 'btn', text: t('Load into place {n}').replace('{n}', at + 1) });
            into.addEventListener('click', () => { into.closest('dialog').close(); api.loadEntry(entry, at).then(() => { location.hash = 'books'; }); });
            return into;
        }))]
        : [make('p', { class: 'soft', text: t('No place is free: remove one of the books first.') })];
    const answer = await ask({ title: entry.title, rows: [facts, ...places], buttons: [[t('Remove from the history'), 'drop', 'quiet danger'], [t('Cancel'), null, 'prominent']] });
    if (answer === 'drop') { dropFromHistory(entry.key); api.again(); }
}

// MARK: - The journal

const journalFilter = { words: '', shelf: '' };

/// Which books are at hand now, a book or a closed one (user, 26.11.2026:
/// the notes and the journal say so, and filter by it).
async function atHand(api) {
    return new Set((await api.places()).filter(Boolean).map((record) => record.key));
}

/// «All books · At hand · Closed»: a filter's choice.
function shelfFilter(state, again) {
    const choice = make('select', { class: 'pick shelf-filter', 'aria-label': t('Books') },
        new Option(t('All Books'), ''), new Option(t('At hand'), 'hand'), new Option(t('Closed'), 'closed'));
    choice.value = state.shelf;
    choice.addEventListener('change', () => { state.shelf = choice.value; again(); });
    return choice;
}
const shelfPasses = (state, onShelf, key) => !state.shelf || (state.shelf === 'hand') === onShelf.has(key);
/// A closed book's title says so.
const titleCell = (title, closed) => {
    const node = make('td', { title });
    node.append(title, closed ? make('span', { class: 'closed-tag', text: t('closed') }) : '');
    return node;
};

/// Every sitting, by day, the newest first; filtered by the title's words,
/// the books at hand or the closed ones.
export async function renderJournal(body, tools, api) {
    const all = [...desk.journal].sort((a, b) => b.start - a.start);
    tools.replaceChildren();
    if (!all.length) return body.replaceChildren(empty('Your reading sittings will appear here.'));
    const onShelf = await atHand(api);
    if (!api.stillHere()) return undefined;
    const words = make('input', { type: 'search', class: 'field narrow', placeholder: t('Filter by title'), value: journalFilter.words, 'aria-label': t('Filter by title'), autocomplete: 'off', spellcheck: false });
    words.addEventListener('input', () => { journalFilter.words = words.value; draw(); });
    tools.replaceChildren(words, shelfFilter(journalFilter, () => draw()));
    const holder = make('div', { class: 'grid-holder' });
    body.replaceChildren(holder);
    actionBar(tools, holder);
    function draw() {
    const wanted = journalFilter.words.trim().toLowerCase();
    const days = new Map();
    for (const one of all) {
        if (wanted && !(one.title || '').toLowerCase().includes(wanted)) continue;
        if (!shelfPasses(journalFilter, onShelf, one.key)) continue;
        if (!days.has(day(one.start))) days.set(day(one.start), []);
        days.get(day(one.start)).push(one);
    }
    const rows = [...days].flatMap(([start, list]) => {
        const name = make('td', { text: dayName(start) });
        name.colSpan = 3;
        return [
            make('tr', { class: 'head' }, name, cell(span(sum(list)), 'num'), cell('', 'num'), cell('', 'num')),
            ...list.map((one, index) => pickable(make('tr', {},
                cell(clockTime(one.start)), titleCell(one.title, !onShelf.has(one.key)), cell(one.author), cell(span(one.seconds), 'num'),
                cell(one.pages ? number(one.pages) : '', 'num'), cell(`${percent(one.from)} → ${percent(one.to)}`, 'num')), {
                id: one.id ?? `${one.key}:${one.start}:${index}`, list: 'journal',
                open: () => api.openEntry(one),
                menu: () => [
                    ['Go to the book', () => api.openEntry(one)],
                    [t('Go to where it began ({p})').replace('{p}', percent(one.from)), () => api.openEntry(one, { xpath: '', progress: one.from }), undefined, 'start', percent(one.from)],
                    [t('Go to where it ended ({p})').replace('{p}', percent(one.to)), () => api.openEntry(one, { xpath: '', progress: one.to }), undefined, 'end', percent(one.to)],
                ],
            })),
        ];
    });
    holder.replaceChildren(rows.length ? table([['Time', '96px'], ['Title'], ['Author', '22%'], ['Reading time', '120px', 'num'], ['Pages', '86px', 'num'], ['Progress', '120px', 'num']], rows, 'journal') : empty('Nothing found'));
    holder.dispatchEvent(new CustomEvent('picked'));
    }
    draw();
    return undefined;
}

// MARK: - The notes

const filter = { words: '', colour: -1, book: '', shelf: '' };

/// Every book's marks and notes: the books at the left, the marks of the
/// chosen one, or of all, at the right. `openEntry(entry, mark)` goes to
/// the place.
export async function renderNotes(body, tools, api) {
    const keys = Object.keys(desk.marks).sort((a, b) => lastOf(b) - lastOf(a));
    tools.replaceChildren();
    if (!keys.length) return body.replaceChildren(empty('Your notes and highlights of every book will be here.'));
    const onShelf = await atHand(api);
    if (!api.stillHere()) return undefined;
    if (!keys.includes(filter.book)) filter.book = '';
    const words = make('input', { type: 'search', class: 'field', placeholder: t('Search'), value: filter.words, 'aria-label': t('Search'), autocomplete: 'off', spellcheck: false });
    const dots = make('div', { class: 'dots' });
    const list = make('div', { class: 'list', 'data-keep-scroll': 'note-books' });
    const notes = make('div', { class: 'selectable', 'data-list': '', 'data-keep-scroll': 'notes' });
    const used = new Set(keys.flatMap((key) => desk.marks[key].list.map((mark) => mark.colour)));
    const fill = () => {
        dots.replaceChildren(...colours.map(([name, value], index) => {
            if (!used.has(index)) return null;
            const dot = make('button', { type: 'button', class: 'dot', title: t(name), 'aria-label': t(name), 'aria-pressed': String(filter.colour === index) });
            dot.style.setProperty('--dot', value);
            dot.classList.toggle('chosen', filter.colour === index);
            dot.addEventListener('click', () => { filter.colour = filter.colour === index ? -1 : index; fill(); });
            return dot;
        }).filter(Boolean));
        const found = keys.filter((key) => shelfPasses(filter, onShelf, key)).map((key) => [key, picked(key)]).filter(([, some]) => some);
        const row = (key, title, author, count) => {
            const pick = make('div', { class: 'book-pick' }, make('span', { text: title }), make('span', { class: 'count', text: number(count) }),
                author || (key && !onShelf.has(key)) ? make('span', { class: 'soft' }, author || '', key && !onShelf.has(key) ? make('span', { class: 'closed-tag', text: t('closed') }) : '') : null);
            pickable(pick, { id: key || 'all', list: 'note-books', chose: () => { if (filter.book !== key) { filter.book = key; fill(true); } } });
            if (filter.book === key) { pick.classList.add('chosen'); pick.tabIndex = 0; }
            return pick;
        };
        const countOf = (some) => some.marks.length + (some.said ? 1 : 0);
        const focused = list.contains(document.activeElement);
        list.replaceChildren(row('', t('All Books'), '', found.reduce((total, [, some]) => total + countOf(some), 0)),
            ...found.map(([key, some]) => row(key, titleOf(key), desk.books[key]?.author, countOf(some))));
        const shown = found.filter(([key]) => !filter.book || key === filter.book);
        notes.replaceChildren(...(shown.length ? shown.map(([key, some]) => bookOf(key, some, api, !onShelf.has(key))) : [empty('Nothing found')]));
        if (focused) list.querySelector('.chosen')?.focus({ preventScroll: true });
    };
    words.addEventListener('input', () => { filter.words = words.value; fill(); });
    const out = make('select', { class: 'pick export', 'aria-label': t('Export') }, new Option(`${t('Export')}…`, ''), ...formats.map(([value, name]) => new Option(name, value)));
    out.addEventListener('change', () => {
        const format = out.value;
        out.value = '';
        if (format) exported(format, filter.book ? [filter.book] : keys).catch((error) => api.say(error.message || String(error)));
    });
    tools.replaceChildren(dots, words, shelfFilter(filter, () => fill()), out);
    // The books' list as wide as the reader drags it (user, 26.11.2026).
    const split = make('div', { class: 'split' }, list, notes);
    const grip = make('div', { class: 'grip', 'aria-hidden': 'true' });
    split.append(grip);
    const width = (value) => split.style.setProperty('--list', `${Math.round(Math.max(160, Math.min(520, value)))}px`);
    width(Number(localStorage.getItem('nano.desk.notesList')) || 250);
    grip.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        grip.setPointerCapture(event.pointerId);
        const from = event.clientX - list.offsetWidth;
        const move = (next) => width(next.clientX - from);
        const end = () => { grip.removeEventListener('pointermove', move); localStorage.setItem('nano.desk.notesList', String(list.offsetWidth)); };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', end, { once: true });
        grip.addEventListener('pointercancel', end, { once: true });
    });
    grip.addEventListener('dblclick', () => { width(250); localStorage.removeItem('nano.desk.notesList'); });
    body.replaceChildren(split);
    // A book's actions stand in its own section, for the note chosen in it.
    notes.addEventListener('picked', () => { for (const section of notes.querySelectorAll('.book-notes')) section.refreshTools?.(); });
    fill();
    return undefined;
}

const lastOf = (key) => Math.max(desk.books[key]?.opened || 0, ...desk.marks[key].list.map((mark) => mark.made || 0));
const titleOf = (key) => desk.books[key]?.title || key.replace(/:\d+$/, '');

function picked(key) {
    const { note, list } = marksOf(key);
    const wanted = filter.words.trim().toLowerCase();
    const has = (text) => !wanted || (text || '').toLowerCase().includes(wanted);
    const whole = wanted && (has(titleOf(key)) || has(desk.books[key]?.author));
    const marks = list.filter((mark) => (filter.colour < 0 || mark.colour === filter.colour) && (whole || has(mark.text) || has(mark.note))).sort((a, b) => a.progress - b.progress);
    const said = note.trim() && filter.colour < 0 && (whole || has(note)) ? note : '';
    return marks.length || said ? { marks, said } : null;
}

function bookOf(key, { marks, said }, api, closed) {
    // The book's comment, its door at the header's right; the actions on
    // the note chosen in this book under the comment.
    const comment = make('button', { type: 'button', class: 'btn small comment-door' }, glyph('comment'), make('span', { text: t('Comment') }));
    comment.classList.toggle('has', !!marksOf(key).note.trim());
    comment.addEventListener('click', () => commentCard(key, titleOf(key), api));
    const tools = make('div', { class: 'book-tools' });
    const section = make('section', { class: 'book-notes' },
        make('header', {}, make('h3', { text: titleOf(key) }), make('span', { class: 'soft', text: desk.books[key]?.author || '' }), closed ? make('span', { class: 'closed-tag', text: t('closed') }) : null, comment),
        said ? (() => {
            // The book's comment: chosen, edited at another click, Return,
            // its menu or the pencil on it.
            const edit = () => commentCard(key, titleOf(key), api);
            const pen = make('button', { type: 'button', class: 'pen', title: t('Edit the comment'), 'aria-label': t('Edit the comment') }, glyph('edit'));
            pen.addEventListener('click', (event) => { event.stopPropagation(); edit(); });
            return pickable(make('div', { class: 'own' }, make('span', { text: said }), pen), { id: `own:${key}`, list: 'notes', open: edit, menu: () => [['Edit the comment', edit]] });
        })() : null,
        ...marks.map((mark) => {
            const dot = make('i', { class: 'dot', 'aria-hidden': 'true' });
            dot.style.setProperty('--dot', colours[mark.colour]?.[1] || colours[4][1]);
            const row = make('button', { type: 'button', class: 'entry' }, dot,
                make('span', { class: 'words' }, make('span', { class: 'quote', text: mark.text }), mark.note ? make('span', { class: 'note', text: mark.note }) : null),
                make('span', { class: 'where', text: percent(mark.progress) }));
            const card = (writing) => noteCard(key, mark, api, writing);
            return pickable(row, {
                id: mark.id, list: 'notes',
                open: () => card(false),
                menu: () => [['Edit the note', () => card(true)], null, ['Open at the note', () => api.openEntry({ key }, mark)], null, ['Delete', () => removeNote(key, mark, api)]],
            });
        }));
    if (marks.length) section.querySelector('header').after(...[section.querySelector('.own')].filter(Boolean), tools);
    section.refreshTools = () => {
        const chosen = section.querySelector('.entry.chosen');
        const items = (chosen || section.querySelector('.entry'))?.menuItems?.() || [];
        tools.replaceChildren(...items.filter(Array.isArray).map(([words, act]) => {
            const press = make('button', { type: 'button', class: 'btn small', title: t(words) }, glyph(iconFor[words]), make('span', { text: t(words) }));
            press.disabled = !chosen;
            press.addEventListener('click', act);
            return press;
        }));
        tools.classList.toggle('live', !!chosen);
    };
    section.refreshTools();
    return section;
}

/// A note's card: its words, the reader's note and colour to change, the
/// way to its place; out of the book.
async function noteCard(key, mark, api, writing) {
    const words = make('textarea', { rows: 4, value: mark.note || '', placeholder: t('Note') });
    words.setAttribute('aria-label', t('Note'));
    let colour = mark.colour;
    const row = make('div', { class: 'dots' });
    const fill = () => row.replaceChildren(...colours.map(([name, value], index) => {
        const dot = make('button', { type: 'button', class: 'dot', title: t(name), 'aria-label': t(name) });
        dot.style.setProperty('--dot', value);
        dot.classList.toggle('chosen', index === colour);
        dot.addEventListener('click', () => { colour = index; fill(); });
        return dot;
    }));
    fill();
    const where = make('p', { class: 'soft', text: `${titleOf(key)} · ${percent(mark.progress)}` });
    if (writing) setTimeout(() => words.focus(), 0);
    const answer = await ask({
        title: t('Note'),
        rows: [make('blockquote', { text: mark.text }), words, row, where],
        buttons: [[t('Delete'), 'delete', 'quiet danger'], [t('Open at the note'), 'go', ''], [t('Done'), 'done', 'prominent']],
        kind: 'note-card',
    });
    if (answer === 'delete') return removeNote(key, mark, api);
    // What was written stays, whichever way the card is left.
    if ((words.value.trim() !== (mark.note || '')) || colour !== mark.colour) changeMark(key, mark.id, { note: words.value.trim(), colour });
    if (answer === 'go') return api.openEntry({ key }, { ...mark, note: words.value.trim(), colour });
    api.again();
    return undefined;
}

/// The book's own comment, written in a window of its own.
async function commentCard(key, title, api) {
    const field = make('textarea', { rows: 8, value: marksOf(key).note, placeholder: t('Your comment on the book') });
    field.setAttribute('aria-label', t('Your comment on the book'));
    setTimeout(() => { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }, 0);
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); field.closest('dialog').querySelector('footer .prominent').click(); } });
    const answer = await ask({ title: `${t('Comment')} · ${title}`, rows: [field], buttons: [[t('Cancel'), null, 'quiet'], [t('Done'), 'done', 'prominent']], kind: 'note-card' });
    if (answer !== 'done') return;
    setNote(key, field.value.trim());
    api.again();
}

async function removeNote(key, mark, api) {
    if (!(await ask({ title: t('Delete the mark?'), words: mark.text.length > 120 ? `${mark.text.slice(0, 120)}…` : mark.text, buttons: [[t('Cancel'), false, 'quiet'], [t('Delete'), true, 'prominent danger-fill']] }))) return;
    removeMark(key, mark.id);
    api.again();
}

/// The chosen book's notes, or every book's, written to a file in a format.
async function exported(format, keys) {
    const books = keys.map((key) => {
        const { note, list } = marksOf(key);
        return {
            title: titleOf(key), author: desk.books[key]?.author || '', note: note.trim(),
            marks: [...list].sort((a, b) => a.progress - b.progress).map((mark) => ({ ...mark, note: mark.note || '', colour: colours[mark.colour]?.[0] || '' })),
        };
    });
    // A file named by the book, where it is one.
    const name = keys.length === 1 ? books[0].title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim() : 'notes';
    await savedFile(`${name}.${format}`, write(format, books));
}

// MARK: - The statistics

let period = 'month';

/// The days of a streak: in a row up to today or yesterday, and the longest.
export function streaks(starts, today = day(Date.now())) {
    const days = [...new Set(starts.map(day))].sort((a, b) => a - b);
    let longest = 0, run = 0, before = null;
    for (const one of days) {
        run = before !== null && dayBefore(one, 1) === before ? run + 1 : 1;
        longest = Math.max(longest, run);
        before = one;
    }
    const alive = before !== null && (before === today || before === dayBefore(today, 1));
    return { current: alive ? run : 0, longest, days: days.length };
}

/// The bars of a period: a day each for a week and a month, a month each
/// for a year and for all the time.
/// `key`: a book whose share of each bar is told apart (`own`).
export function bars(journal, which, now = Date.now(), key = '') {
    const today = day(now);
    const ownOf = (list) => (key ? sum(list.filter((one) => one.key === key)) : 0);
    if (which === 'week' || which === 'month') {
        const count = which === 'week' ? 7 : 30;
        return Array.from({ length: count }, (_, index) => {
            const start = dayBefore(today, count - 1 - index);
            return { start, label: which === 'week' ? date(start, { weekday: 'short' }) : date(start, { day: 'numeric' }), long: date(start, { day: 'numeric', month: 'long' }),
                seconds: sum(journal.filter((one) => day(one.start) === start)), own: ownOf(journal.filter((one) => day(one.start) === start)) };
        });
    }
    const first = new Date(now);
    let count = 12;
    if (which === 'all' && journal.length) {
        const oldest = new Date(Math.min(...journal.map((one) => one.start)));
        count = Math.max(12, (first.getFullYear() - oldest.getFullYear()) * 12 + first.getMonth() - oldest.getMonth() + 1);
    }
    return Array.from({ length: count }, (_, index) => {
        const start = new Date(first.getFullYear(), first.getMonth() - (count - 1 - index), 1).getTime();
        const end = new Date(first.getFullYear(), first.getMonth() - (count - 1 - index) + 1, 1).getTime();
        return { start, label: date(start, { month: count > 24 ? 'narrow' : 'short' }), long: date(start, { month: 'long', year: 'numeric' }),
            seconds: sum(journal.filter((one) => one.start >= start && one.start < end)), own: ownOf(journal.filter((one) => one.start >= start && one.start < end)) };
    });
}

const sum = (list, field = 'seconds') => list.reduce((total, one) => total + (one[field] || 0), 0);

export function renderStats(body, tools, api) {
    const { journal, books } = desk;
    tools.replaceChildren();
    if (!journal.length) return body.replaceChildren(empty('Your reading sittings will appear here.'));
    const chart = bars(journal, period);
    const shown = journal.filter((one) => one.start >= (period === 'all' ? 0 : chart[0].start));
    const { current, longest, days } = streaks(journal.map((one) => one.start));
    const opened = Object.values(books);
    tools.replaceChildren(make('div', { class: 'segmented', role: 'radiogroup' }, ...[['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']].map(([value, label]) => {
        const key = make('button', { type: 'button', role: 'radio', text: t(label), 'aria-checked': String(period === value) });
        key.classList.toggle('chosen', period === value);
        key.addEventListener('click', () => { period = value; api.again(); });
        return key;
    })));
    const tile = (label, value) => make('div', { class: 'tile' }, make('b', { text: value }), make('span', { text: t(label) }));
    // The book chosen in the list: its share of the bars, the rest dimmed;
    // kept across the periods while the book is in them.
    const graphFor = (key) => {
        statsBook = key;
        if (!key) return graph(chart);
        const title = shown.find((one) => one.key === key)?.title || books[key]?.title || '';
        return graph(bars(journal, period, Date.now(), key), title, () => {
            chosenIds.delete('stats');
            for (const row of body.querySelectorAll('.stats-books tr.chosen')) row.classList.remove('chosen');
            const next = graphFor('');
            figure.replaceWith(next);
            figure = next;
        });
    };
    let figure = graphFor(shown.some((one) => one.key === statsBook) ? statsBook : '');
    if (!statsBook) chosenIds.delete('stats');
    body.replaceChildren(make('div', { class: 'pad' },
        make('div', { class: 'tiles' },
            tile('Reading time', shown.length ? span(sum(shown)) : '—'),
            tile('Pages', number(sum(shown, 'pages'))),
            tile('Books', number(new Set(shown.map((one) => one.key)).size)),
            tile('Active days', number(streaks(shown.map((one) => one.start)).days))),
        figure,
        byBook(shown, api, (key) => { const next = graphFor(key); figure.replaceWith(next); figure = next; }),
        make('h3', { text: t('All time') }),
        make('div', { class: 'tiles' },
            tile('Reading time', span(sum(journal))),
            tile('Books opened', number(opened.length)),
            tile('Finished', number(opened.filter((one) => (one.progress || 0) >= 0.95).length)),
            tile('Active days', number(days)),
            tile('Current streak', number(current)),
            tile('Longest streak', number(longest))),
        make('p', { class: 'fine', text: t('A page is 1800 characters. The time is counted while the book is on the screen and you are reading: five minutes without a touch stop the clock.') })));
    return undefined;
}

/// What was read today, for the status line; empty when nothing was.
export function today() {
    const read = sum(desk.journal.filter((one) => day(one.start) === day(Date.now())));
    return read ? `${t('Today')}: ${span(read)}` : '';
}

/// Minutes read, a bar a day or a month. One series, or a book's share in
/// the accent and the rest dimmed — the heading names the book.
let statsBook = '';
function graph(list, book = '', clear = null) {
    const peak = Math.max(60, ...list.map((one) => one.seconds));
    const tip = make('div', { class: 'tip', hidden: true, 'aria-hidden': 'true' });
    const every = Math.max(1, Math.ceil(list.length / 12));
    const columns = list.map((one, index) => {
        const said = `${one.long}: ${one.seconds ? span(one.seconds) : '—'}${book && one.own ? ` · ${book}: ${span(one.own)}` : ''}`;
        const bar = make('i');
        bar.style.height = one.seconds ? `max(3px, ${((one.seconds / peak) * 100).toFixed(2)}%)` : '0';
        if (book) {
            bar.classList.add('rest');
            const own = make('b');
            own.style.height = `${((one.own / Math.max(1, one.seconds)) * 100).toFixed(2)}%`;
            bar.append(own);
        }
        // The labels that fit, counted back from the last bar.
        const label = make('span', { class: 'label', text: (list.length - 1 - index) % every === 0 ? one.label : '' });
        const column = make('div', { class: 'column', tabIndex: 0, role: 'img', 'aria-label': said }, make('span', { class: 'plot' }, bar), label);
        const show = () => {
            tip.textContent = said;
            tip.hidden = false;
            const box = tip.parentElement.getBoundingClientRect(), own = column.getBoundingClientRect();
            const left = own.left - box.left + own.width / 2 - tip.offsetWidth / 2;
            tip.style.left = `${Math.max(0, Math.min(box.width - tip.offsetWidth, left))}px`;
        };
        column.addEventListener('pointerenter', show);
        column.addEventListener('focus', show);
        column.addEventListener('pointerleave', () => { tip.hidden = true; });
        column.addEventListener('blur', () => { tip.hidden = true; });
        return column;
    });
    return make('figure', { class: 'graph' },
        make('figcaption', {}, make('span', { text: t('Activity') }),
            book ? (() => {
                const off = make('button', { type: 'button', class: 'legend', title: t('All Books') }, make('i', { class: 'swatch' }), make('span', { text: book }), make('span', { class: 'x', text: '×' }));
                off.addEventListener('click', () => clear?.());
                return off;
            })() : null,
            make('span', { class: 'soft', text: t('Longest: {t}').replace('{t}', span(Math.max(0, ...list.map((one) => one.seconds)))) })),
        make('div', { class: 'plots' }, ...columns, tip));
}

/// The period's books by the time given to them: the ten first. A row
/// chosen shows the book's share in the chart.
function byBook(shown, api, show) {
    if (!shown.length) return null;
    const books = new Map();
    for (const one of shown) {
        const book = books.get(one.key) || { key: one.key, title: one.title, author: one.author, seconds: 0, pages: 0 };
        book.seconds += one.seconds;
        book.pages += one.pages || 0;
        books.set(one.key, book);
    }
    const list = [...books.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 10);
    return make('section', { class: 'stats-books' }, make('h3', { text: t('Books') }), table([['Title'], ['Author', '24%'], ['', '120px'], ['Reading time', '120px', 'num'], ['Pages', '86px', 'num']],
        list.map((book) => pickable(make('tr', {}, cell(book.title), cell(book.author), cell(make('span', { class: 'far' }, line(book.seconds / list[0].seconds))), cell(span(book.seconds), 'num'), cell(number(book.pages), 'num')),
            { id: book.key, list: 'stats', chose: () => show(book.key), open: () => api.openEntry({ key: book.key }), menu: () => [['Go to the book', () => api.openEntry({ key: book.key })]] })), 'bare'));
}
