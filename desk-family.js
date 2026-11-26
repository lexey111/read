// «Other readers»: the family's window in NanoReader, the apps' About with
// the family folded in (ReaderCore's FamilyOverview.swift and
// FamilyAboutView.swift, CR #1142). The map: the browser's reader at the
// left, past the line between the web and the apps the three on Apple's
// devices in a row, and from the browser's a branch down to this program,
// ringed as the place the reader is in. A place clicked is chosen; under
// the map its card: its picture, its few lines, the way to it. Under the
// family, the doors every app of it has: what is new, the changelog, the
// dev log, a word to us, the papers.

import { make } from './drawer.js';
import { t } from './i18n.js';
import { apps, site } from './apps.js';

const links = {
    family: `${site}family.html`,
    web: `${site}webreader`,
    changelog: `${site}changelog.html`,
    privacy: `${site}privacy.html`,
    devlog: 'https://www.reddit.com/r/ContinuousReader/',
};

// The words. JustReader's, the browser's and the program's are the apps'
// own less «no ads, no account»: said of one, it reads as if the others had
// ads or asked for an account.
const words = {
    header: 'One reading engine: in a browser, on Apple’s devices and on other computers. You are in {name}.',
    web: 'The reader in a browser tab, simpler than in the apps. Works on any device, with nothing to install. The book is stored and processed locally, on the device you opened it on.',
    jr: 'Three books at hand: open a file and read.',
    nr: 'A simple reader as a program of its own: open a book and read. A beta for now.',
    bought: 'One reading engine for all. Bought once for Mac, iPad and iPhone, no subscription, with Family Sharing.',
    // The three readers of three books say why (user, 26.11.2026).
    three: 'Three books is a deliberate limit: these are books without a library. For a library there are PlainReader (the advanced level) and ContinuousReader (the professional one).',
};

const app = Object.fromEntries(apps.map((one) => [one.id, one]));
// The places; `at` is where a place's dot stands, as a share of the map's
// width and height: the native map's own numbers.
const places = [
    { id: 'wr', name: 'WebReader', short: 'WR', at: [0.07, 0.32], kind: 'In a browser', terms: 'Free', pitch: words.web, icon: 'icons/icon.svg', doors: [['Open in a browser', links.web]] },
    ...['jr', 'pr', 'cr'].map((id, index) => ({
        id, name: app[id].name, short: id.toUpperCase(), at: [[0.36, 0.62, 0.88][index], 0.32],
        kind: app[id].role, terms: app[id].terms, apple: true, pitch: id === 'jr' ? words.jr : app[id].text,
        icon: `icons/apps/icon-${id}.svg`, picture: `img/room-${id}.webp`, ground: app[id].ground,
        doors: [['App Store', app[id].store], ['Site', links.family]],
    })),
    { id: 'nr', name: 'NanoReader', short: 'NR', at: [0.36, 0.84], kind: 'For Windows, Linux and Mac', terms: 'Free', pitch: words.nr, icon: 'icons/icon.svg' },
];
const here = 'nr';
/// Between the web and the apps.
const divide = 0.215;
/// The program's three dots, one for each kind of computer: the first to
/// the branch, two past it.
const trio = [[-6, 0], [3, -5.2], [3, 5.2]];
/// Below this width the map names its places short.
const roomy = 520;

// The place chosen, kept while the program runs: the page is drawn again
// at a language's change and a version's arrival.
let chosen = here;
let masks = 0;

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attributes = {}, ...children) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    node.append(...children);
    return node;
};
const glyphs = {
    news: 'M12 3l2.2 5.6L20 10l-4.6 3.6L17 20l-5-3.4L7 20l1.6-6.4L4 10l5.8-1.4z',
    changelog: 'M9.5 6.5h10M9.5 12h10M9.5 17.5h10M5 6.5h.01M5 12h.01M5 17.5h.01',
    devlog: 'M4 5.5h16v10.5h-9.5L6 19.5v-3.5H4zM8 9.5h8M8 12.5h5',
    feedback: 'M3.5 6h17v12h-17zM4 6.5l8 6.5 8-6.5',
    privacy: 'M12 3.5l7 2.8v5.2c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.3z',
    site: 'M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 0 1 0-17zM3.5 12h17M12 3.5c-2.6 2.4-3.6 5.2-3.6 8.5s1 6.1 3.6 8.5M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5',
    out: 'M8 16L16 8M10 8h6v6',
    on: 'M9.5 6l6 6-6 6',
};
const glyph = (name, kind = 'glyph') => svg('svg', { viewBox: '0 0 24 24', class: kind, 'aria-hidden': 'true' }, svg('path', { d: glyphs[name] }));
/// A door out of the program: the shell sends it to the system's browser.
const outside = (href, ...children) => make('a', { href, target: '_blank', rel: 'noopener' }, ...children);
const put = (node, x, y) => {
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.dataset.x = x;
    node.dataset.y = y;
};

export function renderFamily(into, tools, api) {
    tools.replaceChildren();
    let hovered = null;

    // MARK: The map

    const mask = `familyHoles${++masks}`;
    const holes = svg('mask', { id: mask, maskUnits: 'userSpaceOnUse' });
    const divideLine = svg('line', { class: 'divide' });
    const way = svg('path', { class: 'way', mask: `url(#${mask})` });
    const lines = svg('svg', { class: 'lines', 'aria-hidden': 'true' }, svg('defs', {}, holes), divideLine, way);
    const doors = places.map((place) => {
        const door = make('button', { type: 'button', class: `place ${place.id}`, 'aria-label': place.name, title: place.name },
            make('i', { class: 'halo' }), make('i', { class: 'orbit' }),
            place.id === 'nr'
                ? make('i', { class: 'trio' }, ...trio.map(([x, y]) => {
                    const dot = make('b');
                    dot.style.setProperty('--x', `${x}px`);
                    dot.style.setProperty('--y', `${y}px`);
                    return dot;
                }))
                : make('i', { class: 'spot' }),
            make('span', { class: 'called', 'aria-hidden': 'true' }));
        door.addEventListener('click', () => { chosen = place.id; show(); });
        door.addEventListener('pointerenter', () => { hovered = place.id; show(); });
        door.addEventListener('pointerleave', () => { if (hovered === place.id) { hovered = null; show(); } });
        return door;
    });
    const caption = (text, kind = '') => make('span', { class: `cap ${kind}`.trim(), text, 'aria-hidden': 'true' });
    const captions = { web: caption(t('Web')), apple: caption('Apple'), other: caption('Windows · Linux · Mac', 'beside') };
    const map = make('div', { class: 'map', role: 'group', 'aria-label': t('The family') }, lines, ...doors, ...Object.values(captions));

    // MARK: The cards, every place's in one cell: the tallest sets the
    // height, and a click does not make the page jump.

    const cards = make('div', { class: 'deck' }, ...places.map(card));

    // MARK: The page

    const head = make('header', { class: 'head' },
        make('h2', { text: t('The family') }),
        outside(links.family, t('The family on the site'), glyph('out', 'out')));
    const rows = make('nav', { class: 'rows island' },
        row('news', t('What’s new'), make('a', { href: '#news' })),
        row('changelog', t('Changelog'), outside(links.changelog), true),
        row('devlog', t('Dev log on Reddit'), outside(links.devlog), true),
        row('feedback', t('Feedback'), (() => {
            const press = make('button', { type: 'button' });
            press.addEventListener('click', () => api.feedback());
            return press;
        })(), true));
    const foot = make('footer', { class: 'foot' },
        make('span', { class: 'soft selectable', text: `NanoReader ${api.version()}` }),
        outside(links.privacy, glyph('privacy'), t('Privacy')),
        outside(site, glyph('site'), t('Site')));
    // The family's island on the chosen place's paper, the pictures' own
    // (user, 26.11.2026: the cream square on grey looked cut out).
    const island = make('section', { class: 'island tinted' }, head,
            make('p', { class: 'lead', text: t(words.header).replace('{name}', 'NanoReader') }),
            map, cards);
    into.replaceChildren(make('div', { class: 'family' }, make('div', { class: 'sheet' }, island, rows, foot)));

    // Laid out in the map's own pixels, again when its width changes: the
    // dots and the words keep their size, the lines their weight.
    let width = 0;
    function layout() {
        const w = map.clientWidth;
        if (!w || w === width) return;
        width = w;
        const compact = w < roomy;
        map.classList.toggle('compact', compact);
        const h = map.clientHeight;
        const spot = (id) => {
            const [x, y] = places.find((place) => place.id === id).at;
            return [Math.round(x * w), Math.round(y * h)];
        };
        lines.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const x = Math.round(divide * w) + 0.5;
        for (const [key, value] of Object.entries({ x1: x, x2: x, y1: Math.round(h * 0.04), y2: Math.round(h * 0.98) })) divideLine.setAttribute(key, value);
        // The lines one path, one stroke: where the branch leaves the row
        // the two do not darken each other. The branch goes a little way
        // along, bends down and runs into the program's first dot.
        const [wx, wy] = spot('wr'), [cx] = spot('cr'), [nx, ny] = spot('nr');
        const start = wx + 0.04 * w, landing = 0.27 * w;
        way.setAttribute('d', `M${wx} ${wy}H${cx}M${wx} ${wy}H${start}C${start + 0.07 * w} ${wy} ${landing - 0.08 * w} ${ny} ${landing} ${ny}H${nx + trio[0][0]}`);
        for (const [index, place] of places.entries()) {
            const [px, py] = spot(place.id);
            put(doors[index], px, py);
            doors[index].querySelector('.called').textContent = compact ? place.short : place.name;
        }
        put(captions.web, wx, wy + 28);
        put(captions.apple, spot('jr')[0], wy + 28);
        captions.other.classList.toggle('beside', !compact);
        if (compact) put(captions.other, nx, ny + 30); else put(captions.other, nx + 30, ny);
        cut();
    }

    function show() {
        for (const [index, place] of places.entries()) {
            const door = doors[index];
            door.classList.toggle('here', place.id === here);
            door.classList.toggle('chosen', place.id === chosen);
            door.classList.toggle('hover', place.id === hovered);
            door.setAttribute('aria-pressed', String(place.id === chosen));
        }
        const paper = places.find((place) => place.id === chosen)?.ground || app.jr.ground;
        island.style.setProperty('--paper', paper);
        for (const node of cards.children) {
            const shown = node.dataset.place === chosen;
            node.classList.toggle('shown', shown);
            node.inert = !shown;
        }
        cut();
    }

    // The lines stop at the dots, wider round the place chosen, the one
    // under the pointer and the one the reader is in: a faint ring is
    // see-through, and the line showed through it.
    function cut() {
        if (!width) return;
        holes.replaceChildren(svg('rect', { width, height: map.clientHeight, fill: '#fff' }), ...places.flatMap((place, index) => {
            const { x, y } = doors[index].dataset;
            if (place.id === 'nr') return trio.map(([dx, dy]) => svg('circle', { cx: +x + dx, cy: +y + dy, r: 4, fill: '#000' }));
            const r = place.id === here ? 21 : place.id === chosen || place.id === hovered ? 16 : 7;
            return [svg('circle', { cx: x, cy: y, r, fill: '#000' })];
        }));
    }

    show();
    layout();
    const watch = new ResizeObserver(() => {
        if (!map.isConnected) { watch.disconnect(); return; }
        layout();
    });
    watch.observe(map);
}

/// A place's card: its picture, its name with what it is, its lines and
/// the way to it; «You are here» for this program.
function card(place) {
    const figure = make('figure', { class: `picture ${place.picture ? 'room' : 'emblem'}` },
        make('img', { src: place.picture || place.icon, alt: '', draggable: false }));
    figure.style.setProperty('--paper', place.ground || app.jr.ground);
    const terms = [t(place.kind), t(place.terms), ...(place.apple ? ['iPhone, iPad, Mac'] : [])].join(' · ');
    const end = place.id === here
        ? make('p', { class: 'present' }, make('i'), t('You are here'))
        : make('p', { class: 'doors' }, ...place.doors.map(([label, href], index) => {
            const door = outside(href, t(label), glyph('out', 'out'));
            door.className = index === 0 ? 'btn prominent' : 'btn';
            return door;
        }));
    return make('article', { class: 'card', 'data-place': place.id },
        figure,
        make('header', {},
            make('img', { src: place.icon, alt: '', draggable: false }),
            make('div', {}, make('h3', { text: place.name }), make('p', { class: 'soft', text: terms }))),
        make('div', { class: 'say selectable' },
            make('p', { class: 'pitch' }, ...linked(t(place.pitch), place.id)),
            place.id === 'pr' || place.id === 'cr' ? make('p', { class: 'small', text: t(words.bought) }) : null,
            place.id === 'wr' || place.id === 'jr' || place.id === 'nr' ? make('p', { class: 'small' }, ...linked(t(words.three), place.id)) : null,
            end));
}

/// A sibling named in the pitch is a link to its store page: PlainReader
/// says what it is not by naming ContinuousReader.
function linked(text, self) {
    const others = apps.filter((one) => one.id !== self);
    const pattern = new RegExp(`(${others.map((one) => one.name).join('|')})`);
    return text.split(pattern).filter(Boolean).map((part) => {
        const sibling = others.find((one) => one.name === part);
        return sibling ? outside(sibling.store, part) : part;
    });
}

/// A row of the doors under the family: its glyph, its words, an arrow for
/// a page outside or a chevron for one of the program's own.
function row(name, label, door, away = false) {
    door.classList.add('row');
    door.append(glyph(name), make('span', { text: label }), glyph(away ? 'out' : 'on', 'tail'));
    return door;
}
