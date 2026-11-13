// The shell round the page: a book in a frame, the family's page script
// run inside it as it stands, and the bridge the script posts to.
//
// In the apps the book's HTML is the web view's whole document and the
// script is evaluated in it after the load; the reader answers through
// `window.webkit.messageHandlers`. Here the frame is that document and
// this file is that reader.

import { convert, formats, accept } from './book.js';
import { load, save, defaults, payload, theme, mix, direction, pictureStrip, turning, paged, onSystemLight } from './model.js';
import { renderApps } from './apps.js';
import { ornament } from './ornament.js';
import { version } from './version.js';
import { renderNews, latest } from './news.js';
import { settingsPanel } from './panel.js';
import { progressBar } from './progress.js';
import { t, setLanguage, resolve, problem, languages } from './i18n.js';
import { keepLast, lastBook } from './store.js';

const $ = (id) => document.getElementById(id);
const frame = $('page');
const settings = load();
setLanguage(resolve(settings.language));

let book = null;
let restored = false;
/// The page's last report: where the reader is, how many pages there are.
let place = { progress: 0, currentPage: 0, totalPages: 0 };
/// Pages for the bar's bubble where the page does not count them: a text
/// in scroll at the family's 1800 characters a page.
let estimatedPages = 0;

// MARK: - The bridge

// The handlers the reader registers on the Mac — `readerKey` is the
// iPad's and is left out, so the page keeps its own keys.
const handlerNames = [
    'positionUpdate', 'jsLog', 'positionRestored', 'toggleFullscreen', 'pageZoom', 'pageMark',
    'selectionChanged', 'selectionMark', 'userActivity', 'visibilityChanged', 'scrollResetX',
    'setPagedMode', 'pageLayout', 'pageFlip',
];
const messages = [];
const errors = [];

function receive(name, body) {
    if (messages.length < 5000) messages.push({ name, body, at: performance.now() });
    switch (name) {
    case 'positionUpdate':
        if (!book) break;
        // The place is kept only once the page stands where it was
        // restored to; the reports on the way still say the pages.
        if (restored && body.xpath !== undefined) {
            localStorage.setItem('nano.position.' + book.key, JSON.stringify({
                xpath: body.xpath || '', scrollY: body.scrollY || 0, progress: body.progress || 0,
            }));
        }
        place = {
            progress: restored ? body.progress || 0 : place.progress,
            currentPage: body.currentPage ?? place.currentPage,
            totalPages: body.totalPages ?? place.totalPages,
        };
        showPosition();
        break;
    case 'positionRestored':
        restored = true;
        frame.style.opacity = '1';
        break;
    case 'toggleFullscreen':
        toggleFullscreen();
        break;
    case 'pageFlip':
        turn(body);
        break;
    case 'jsLog':
        console.debug('[page]', body);
        break;
    }
}

/// The page hands a turn to the reader to draw (the apps' snapshots and
/// their leaf, cards and sink). Here only the plain slide asks — Space,
/// Return and the vertical arrows slide the page up, as in the apps: the
/// frame goes up and out, the page turns under it, the next comes up in.
/// Unanswered, those keys did nothing.
let turnInFlight = false;
async function turn({ direction: way, vertical, kind }) {
    const page = frame.contentWindow;
    const tracker = page?.PositionTracker;
    if (!tracker) return;
    if (turnInFlight) return;
    turnInFlight = true;
    // The page sends a vertical turn unmirrored and mirrors every turn back
    // in a book read right to left — so Space went back there (CR #1136).
    // Mirrored here first, it lands forward.
    const pageWay = vertical && turning(settings, book) && direction(book) === 'rtl' ? -way : way;
    try {
        if (vertical && kind === 'slide' && frame.animate) {
            const rise = way > 0 ? -1 : 1;
            await frame.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${rise * 28}px)`, opacity: 0 }],
                { duration: 120, easing: 'ease-in', fill: 'forwards' }).finished;
            await tracker.turnPageInstantPainted(pageWay);
            await frame.animate([{ transform: `translateY(${-rise * 28}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
                { duration: 170, easing: 'ease-out' }).finished;
            frame.getAnimations().forEach((animation) => animation.cancel());
        } else {
            await tracker.turnPageInstantPainted(pageWay);
        }
    } finally {
        turnInFlight = false;
    }
}

function showPosition() {
    const percent = Math.round(place.progress * 100) + ' %';
    const turns = turning(settings, book) && place.totalPages > 0;
    // A phone gives the bar the room: the per cent alone.
    $('position').textContent = turns && innerWidth > 600 ? `${place.currentPage + 1} / ${place.totalPages} · ${percent}` : percent;
    bar.set(place.progress, direction(book) === 'rtl');
}

const bar = progressBar($('bar'), {
    onGo: (fraction) => {
        frame.contentWindow?.PositionTracker?.scrollToProgress(fraction);
        frame.contentWindow?.focus();
    },
    pageAt: (fraction) => {
        const total = turning(settings, book) && place.totalPages > 0 ? place.totalPages : estimatedPages;
        return total ? Math.max(1, Math.min(total, Math.ceil(fraction * total))) : 0;
    },
});

// MARK: - A book in the frame

let engineSource = null;

/// Two opens at once (a resumed book and a file dropped meanwhile): the
/// later one wins.
let generation = 0;

async function show(next) {
    const mine = ++generation;
    close();
    book = next;
    appliedPayload = '';
    restored = false;
    place = { progress: 0, currentPage: 0, totalPages: 0 };
    messages.length = 0;
    document.title = book.title + ' — WebReader';
    $('title').textContent = book.author ? `${book.title} — ${book.author}` : book.title;
    $('position').textContent = '';
    $('contentsDoor').hidden = !(book.chapters && book.chapters.length > 1);
    $('home').hidden = true;
    $('reader').hidden = false;
    frame.style.opacity = '0';
    engineSource ??= await (await fetch('engine/PositionTracker.js')).text();
    if (mine !== generation) return;

    await new Promise((done) => {
        frame.addEventListener('load', done, { once: true });
        frame.srcdoc = book.html;
    });
    if (mine !== generation) return;
    localStorage.setItem('nano.open', book.key);
    newOrnamentFor(book.key);
    const page = frame.contentWindow;
    page.webkit = { messageHandlers: {} };
    for (const name of handlerNames) {
        page.webkit.messageHandlers[name] = { postMessage: (body) => receive(name, body) };
    }
    page.addEventListener('error', (event) => errors.push(String(event.message)));
    // The script blurs the text while a resize is laid out again. Chromium
    // paints that blur over the whole book — hundreds of columns — and a
    // large book stood still for three seconds; the dimming alone stays.
    const calm = page.document.createElement('style');
    calm.textContent = 'body { filter: none !important; }';
    page.document.head.appendChild(calm);
    page.addEventListener('pointerdown', () => { $('contents').hidden = true; });
    page.addEventListener('mousemove', wake, { passive: true });
    page.addEventListener('keydown', keys);

    const notes = page.document.getElementById('_cr_footnotes');
    const characters = page.document.body.textContent.length - (notes ? notes.textContent.length : 0);
    estimatedPages = book.pages ? page.document.querySelectorAll('._cr_page').length : Math.max(1, Math.ceil(characters / 1800));

    paperWithTheText(page);
    // As the reader does: the script, the settings, then the position.
    page.eval(engineSource);
    apply();
    const saved = JSON.parse(localStorage.getItem('nano.position.' + book.key) || 'null') || { xpath: '', scrollY: 0, progress: 0 };
    page.PositionTracker.restorePosition(saved.xpath, 0, saved.scrollY, saved.progress);
    place.progress = saved.progress;
    showPosition();
    // The reader's own grace: shown anyway if the page never answers.
    setTimeout(() => { if (!restored) receive('positionRestored', {}); }, 8000);
    wake();
    page.focus();
}

/// Closed by the reader: the next visit starts at home, the book offered.
function closeBook() {
    localStorage.removeItem('nano.open');
    close();
    offerLast();
}

function close() {
    $('contents').hidden = true;
    if ($('panel').open) $('panel').close();
    if (!book) return;
    for (const url of book.urls || []) URL.revokeObjectURL(url);
    book = null;
    frame.srcdoc = '';
    $('reader').hidden = true;
    $('home').hidden = false;
    document.title = 'WebReader';
    apply();
}

/// The paper goes with the text. The page lays its wash on a fixed layer —
/// in the apps the reader's ground round the page wears the same paper in
/// phase — and under a scroll the text slid over a paper that stood
/// still. Here nothing surrounds the page: the wash is taken off the layer
/// and laid on the document itself, which scrolls (and slides with a
/// turn).
function paperWithTheText(page) {
    const doc = page.document;
    const sheet = doc.createElement('style');
    sheet.id = '_nano_paper';
    doc.head.appendChild(sheet);
    let layer = null;
    const follow = new page.MutationObserver(() => carry());
    function carry() {
        const wash = layer?.isConnected ? layer.style.backgroundImage : '';
        sheet.textContent = wash
            ? `#_cr_page_texture { display: none !important; } html { background-image: ${wash} !important; background-repeat: repeat !important; background-attachment: scroll !important; }`
            : '';
    }
    new page.MutationObserver(() => {
        const now = doc.getElementById('_cr_page_texture');
        if (now !== layer) {
            follow.disconnect();
            layer = now;
            if (layer) follow.observe(layer, { attributes: true, attributeFilter: ['style'] });
        }
        carry();
    }).observe(doc.documentElement, { childList: true });
}

// MARK: - Settings

/// What the panel shows: the book's own choices where it has them.
function context() {
    const pictures = !!book?.pages;
    const shown = Object.assign({}, settings, pictures
        ? { direction: direction(book), layout: pictureStrip(book) ? 'scroll' : 'pages', columns: settings.pagesColumns }
        : { direction: direction(book), layout: paged(settings) ? 'pages' : 'scroll' });
    return { pictures, shown };
}

const panel = settingsPanel($('panel'), {
    settings,
    context,
    onChange(setting, value) {
        if (value !== undefined) {
            if (setting === 'direction') {
                if (book) localStorage.setItem('nano.direction.' + book.key, value);
            } else if (book?.pages && setting === 'layout') {
                localStorage.setItem('nano.strip.' + book.key, value === 'scroll' ? '1' : '0');
            } else if (book?.pages && setting === 'columns') {
                settings.pagesColumns = value;
            } else {
                settings[setting] = value;
            }
        }
        applySoon();
    },
    onReset() {
        // The language is not the page's look: it stays.
        Object.assign(settings, defaults, { language: settings.language });
        apply();
    },
    onLanguage: changeLanguage,
});

/// The language from the settings window or from home.
function changeLanguage() {
    save(settings);
    speak();
    panel.build();
}

/// The shell's own words in the reader's language.
function speak() {
    setLanguage(resolve(settings.language));
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const node of document.querySelectorAll('[data-i18n-label]')) {
        const words = t(node.dataset.i18nLabel);
        node.setAttribute('aria-label', words);
        node.title = node.dataset.key ? `${words} (${node.dataset.key})` : words;
    }
    if (!$('home').hidden) offerLast();
    if (!$('apps').hidden) renderApps($('apps'));
    if (!$('news').hidden) renderNews($('news'), settings.language);
    const choice = $('homeLanguage');
    choice.replaceChildren(new Option(t('As the browser'), 'auto'), ...Object.entries(languages).map(([code, name]) => new Option(name, code)));
    choice.value = settings.language || 'auto';
    $('formats').textContent = t(formats) + '.';
    $('bar').querySelector('.progress')?.setAttribute('aria-label', t('Position in the book'));
}
$('panel').addEventListener('close', () => { wake(); frame.contentWindow?.focus(); });

/// The shell's own colours follow the page's.
function dress() {
    const colours = theme(settings, !!book?.pages);
    const root = document.documentElement.style;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colours.bg);
    root.setProperty('--ground', colours.bg);
    root.setProperty('--ink', colours.text);
    root.setProperty('--surface', colours.dark ? mix(colours.bg, '#ffffff', 0.07) : mix(colours.bg, '#ffffff', 0.6));
    root.setProperty('--raised', colours.dark ? mix(colours.bg, '#ffffff', 0.17) : '#ffffff');
    root.colorScheme = colours.dark ? 'dark' : 'light';
    root.setProperty('--accent', colours.link);
    // The family's own colours for the home's words (the site's ink and
    // terracotta) by day; at night the page's text and the wing's copper.
    root.setProperty('--brand-ink', colours.dark ? colours.text : '#1F3A52');
    root.setProperty('--brand-soft', colours.dark ? mix(colours.text, colours.bg, 0.3) : '#496982');
    root.setProperty('--brand-accent', colours.dark ? '#E8845A' : '#C45D38');
    root.setProperty('--brand-accent-deep', colours.dark ? '#F09A6A' : '#A84B28');
    // The home's band: a lattice in the page's own colours, a shade off
    // the paper, the straps in the links' colour and the stones in its
    // opposite; drawn anew for another book.
    const ground = mix(colours.bg, colours.text, colours.dark ? 0.06 : 0.07);
    const tile = ornament(ornamentSeed(), {
        ground,
        strap: mix(ground, colours.link, colours.dark ? 0.3 : 0.42),
        stone: mix(ground, opposite(colours.link), colours.dark ? 0.4 : 0.3),
    });
    root.setProperty('--band', ground);
    root.setProperty('--band-pattern', `url("data:image/svg+xml,${encodeURIComponent(tile.svg)}")`);
    root.setProperty('--band-size', `${tile.width}px ${tile.height}px`);
    root.setProperty('--band-size-small', `${tile.width * 0.6}px ${tile.height * 0.6}px`);
    root.setProperty('--cover-size', `${tile.width * 0.4}px ${tile.height * 0.4}px`);
    for (const key of document.querySelectorAll('#homeLight [data-value]')) {
        const chosen = key.dataset.value === settings.light;
        key.classList.toggle('chosen', chosen);
        key.setAttribute('aria-checked', String(chosen));
    }
}

/// The band's seed: kept, and changed when another book opens.
function ornamentSeed() {
    let seed = Number(localStorage.getItem('nano.ornament'));
    if (!seed) {
        seed = 1 + Math.floor(Math.random() * 2 ** 31);
        localStorage.setItem('nano.ornament', String(seed));
    }
    return seed;
}
function newOrnamentFor(key) {
    if (localStorage.getItem('nano.ornament.book') === key) return;
    localStorage.setItem('nano.ornament.book', key);
    localStorage.setItem('nano.ornament', String(1 + Math.floor(Math.random() * 2 ** 31)));
}

/// A colour's opposite, deep: the hue turned (copper → teal), muted and
/// darkened to sit in the band.
function opposite(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, delta = max - min;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    let hue = 0;
    if (delta) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 160 + 360) % 360;
    const sat = Math.min(s, 0.4), light = 0.3;
    const k = (n) => (n + hue / 30) % 12, a = sat * Math.min(light, 1 - light);
    const f = (n) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

let appliedWidth = 0;
/// What the page was last given. The page lays itself out again for any
/// payload, an unchanged one too — dimmed for the moment it takes — so a
/// setting that does not show now (the night's tone or brightness by day)
/// must not reach it.
let appliedPayload = '';
const paintKeys = new Set(['bgColor', 'textColor', 'linkColor', 'pageTextureDark', 'pagesBrightness']);
let lightTimer = 0;
function holdTheLight(page) {
    let hold = page.document.getElementById('_nano_hold');
    if (!hold) {
        hold = page.document.createElement('style');
        hold.id = '_nano_hold';
        page.document.head.appendChild(hold);
    }
    hold.textContent = 'body { opacity: 1 !important; transition: none !important; }';
    clearTimeout(lightTimer);
    lightTimer = setTimeout(() => { hold.textContent = ''; }, 700);
}
function apply() {
    save(settings);
    dress();
    panel.refresh();
    const page = frame.contentWindow;
    if (!book || !page || !page.PositionTracker) return;
    appliedWidth = frame.clientWidth;
    const tracker = page.PositionTracker;
    tracker.setPageTexture(settings.paper === 'none' ? '' : new URL(`engine/paper/${settings.paper}.png`, location.href).href);
    const next = payload(settings, book, frame.clientWidth || innerWidth);
    const said = JSON.stringify(next);
    if (said === appliedPayload) return;
    const before = appliedPayload ? JSON.parse(appliedPayload) : null;
    appliedPayload = said;
    // The pages' brightness at night alone: the page's own setter, which
    // rewrites the tint and nothing else — the whole road re-lays the pages
    // out at every step of the slider, and they blinked.
    const changed = before ? Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(before[key])) : null;
    if (changed && changed.length === 1 && changed[0] === 'pagesBrightness') {
        tracker.setPagesBrightness(next.pagesBrightness);
        return;
    }
    // Colours alone move nothing on the page, yet the page dims itself for
    // the pass all the same — a blink at every step of a colour's slider.
    // The dim is held off for such a pass.
    if (changed && changed.every((key) => paintKeys.has(key))) holdTheLight(page);
    tracker.applySettings(next);
    showPosition();
}

/// A slider sends a value a step: the page is laid again at most every
/// 150 ms while it moves, and once more where it stops.
let applyTimer = 0, appliedAt = 0;
function applySoon() {
    dress();
    panel.refresh();
    clearTimeout(applyTimer);
    const wait = Math.max(0, 150 - (performance.now() - appliedAt));
    applyTimer = setTimeout(() => { appliedAt = performance.now(); apply(); }, wait);
}

// MARK: - The strip: awake while the pointer moves, asleep while one reads

let sleepTimer = 0;
function wake() {
    $('strip').classList.add('awake');
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(sleep, 2500);
}
function sleep() {
    if ($('strip').matches(':hover') || !$('contents').hidden || $('panel').open) { sleepTimer = setTimeout(sleep, 1000); return; }
    $('strip').classList.remove('awake');
}
$('strip').addEventListener('pointerenter', wake);
$('strip').addEventListener('pointerdown', wake);
addEventListener('mousemove', wake, { passive: true });

// MARK: - Full screen

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', wake);

/// The shell's keys, from the page or the shell: F for the full screen.
function keys(event) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (event.code === 'KeyF' && book) { event.preventDefault(); toggleFullscreen(); }
    if (event.key === 'Escape' && !$('contents').hidden) { $('contents').hidden = true; frame.contentWindow?.focus(); }
}
addEventListener('keydown', keys);

// MARK: - Contents

/// The book's contents: a list that travels. The chapter the reader is in
/// is marked — the last whose place is not past the page's.
function showContents() {
    const tracker = frame.contentWindow.PositionTracker;
    const places = new Map(JSON.parse(tracker.getChapterPositions(book.chapters.map((chapter) => chapter.id))).map((p) => [p.id, p.progress]));
    const here = (tracker.getPosition().progress || 0) + 0.0005;
    let current = -1;
    book.chapters.forEach((chapter, index) => { if (places.has(chapter.id) && places.get(chapter.id) <= here) current = index; });
    $('contents').replaceChildren(...book.chapters.map((chapter, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = chapter.title;
        row.classList.toggle('chosen', index === current);
        row.addEventListener('click', () => { $('contents').hidden = true; tracker.scrollToElementId(chapter.id); frame.contentWindow.focus(); });
        return row;
    }));
    $('contents').hidden = false;
    $('contents').querySelector('.chosen')?.scrollIntoView({ block: 'center' });
}

// MARK: - Doors

async function openFile(file, { keep = true } = {}) {
    $('problem').textContent = '';
    try {
        const converted = await convert(await file.arrayBuffer(), file.name);
        const key = `${file.name}:${file.size}`;
        await show({ key, ...converted });
        if (keep) {
            // The bytes, not the File: Safari's private windows keep no
            // Blob in IndexedDB, and an ArrayBuffer is kept everywhere.
            keepLast({ key, name: file.name, title: converted.title, bytes: await file.arrayBuffer() });
            // Asked once a book is read: the browser keeps the place and
            // the book through its own clean-ups.
            navigator.storage?.persist?.().catch(() => {});
        }
    } catch (error) {
        close();
        $('problem').textContent = problem(error.message || String(error));
    }
}

/// A book the family's converter already made — the development samples.
async function openSample(slug, title) {
    const base = new URL(`samples/${slug}/`, location.href).href;
    const source = await (await fetch(base + 'content.html')).text();
    const html = source.replace(/<head>/i, `<head><base href="${base}">`);
    await show({ key: 'sample:' + slug, title, author: '', html });
    keepLast({ key: 'sample:' + slug, name: slug, title, sample: slug });
}

/// The last book again, as it was kept.
async function reopen(record) {
    if (record.sample) return openSample(record.sample, record.title);
    const file = new File([record.bytes ?? record.file], record.name);
    return openFile(file, { keep: false });
}

/// At home: the last book, one press away.
async function offerLast() {
    const record = await lastBook();
    const door = $('resume');
    door.hidden = !record;
    if (!record) return;
    const read = JSON.parse(localStorage.getItem('nano.position.' + record.key) || 'null')?.progress || 0;
    door.querySelector('.label').textContent = t('Continue reading');
    door.querySelector('.name').textContent = record.title;
    door.querySelector('.initial').textContent = [...(record.title || '').replace(/^\W+/u, '')][0] || '';
    door.querySelector('.share').textContent = `${Math.round(read * 100)}%`;
    door.style.setProperty('--read', `${(read * 100).toFixed(1)}%`);
    door.setAttribute('aria-label', `${t('Continue reading')}: ${record.title}`);
    door.onclick = () => reopen(record);
}

$('open').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) openFile(file);
});
$('close').addEventListener('click', closeBook);
$('settings').addEventListener('click', () => {
    $('contents').hidden = true;
    $('panel').showModal();
    // The window itself takes the focus, not its first key: a ring round
    // the close button on a touch said nothing.
    $('panel').focus();
});
$('contentsDoor').addEventListener('click', () => { if ($('contents').hidden) showContents(); else $('contents').hidden = true; });
$('fullscreen').addEventListener('click', toggleFullscreen);
// The iPhone's browser has no full screen for a page.
$('fullscreen').hidden = !document.fullscreenEnabled;

const home = $('home');

$('homeLanguage').addEventListener('change', (event) => {
    settings.language = event.target.value;
    changeLanguage();
});

// The home's light: the reader's own, one setting.
$('homeLight').addEventListener('click', (event) => {
    const key = event.target.closest('[data-value]');
    if (!key) return;
    settings.light = key.dataset.value;
    apply();
});

/// The home and the apps' page share the leaf; the address says which.
function route() {
    const page = { '#apps': 'apps', '#news': 'news' }[location.hash] || 'front';
    if (page === 'apps') renderApps($('apps'));
    if (page === 'news') {
        renderNews($('news'), settings.language);
        localStorage.setItem('nano.news.seen', latest);
    }
    for (const id of ['front', 'apps', 'news']) $(id).hidden = id !== page;
    home.classList.toggle('on-page', page !== 'front');
    // A dot by the version while there is news the reader has not opened.
    $('version').querySelector('.dot').hidden = (localStorage.getItem('nano.news.seen') || '') >= latest;
    home.querySelector('.leaf').scrollTop = 0;
}
addEventListener('hashchange', route);
route();
addEventListener('dragover', (event) => { event.preventDefault(); home.classList.add('over'); });
addEventListener('dragleave', () => home.classList.remove('over'));
addEventListener('drop', (event) => {
    event.preventDefault();
    home.classList.remove('over');
    const file = event.dataTransfer.files[0];
    if (file) openFile(file);
});

onSystemLight(apply);

// The margins are a share of the width: a resized window gets them anew.
let resizeTimer = 0;
addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (book && frame.clientWidth !== appliedWidth) apply(); }, 400);
});

fetch('samples.json').then((answer) => (answer.ok ? answer.json() : [])).catch(() => []).then((samples) => {
    for (const sample of samples) {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = sample.title;
        link.addEventListener('click', (event) => { event.preventDefault(); openSample(sample.slug, sample.title); });
        row.appendChild(link);
        $('samples').appendChild(row);
    }
});

$('version').querySelector('.number').textContent = version;
$('file').setAttribute('accept', accept);
speak();
apply();

// Without the network too, once it has been here; an installed reader
// opens the files the system hands it.
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
        const handle = params.files?.[0];
        if (handle) openFile(await handle.getFile());
    });
}

// A book open when the page went away opens again; else home offers it.
lastBook().then((record) => {
    if (record && localStorage.getItem('nano.open') === record.key && !book) reopen(record);
    else offerLast();
});

// For the tests and the console.
window.nano = {
    settings, messages, errors, apply, openSample, openFile, show, close,
    payload: () => payload(settings, book, frame.clientWidth || innerWidth),
    get book() { return book; }, get restored() { return restored; },
};
