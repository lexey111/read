// «More in the apps»: what the family's three apps add around the same
// page — the reader's own features first, then each app's way of keeping
// books, with the doors to the site and the App Store.

import { t } from './i18n.js';

const site = 'https://continuousreader.app/';

const reader = [
    ['Panels', 'An IDE for reading. Build your own reader: contents, bookmarks, notes and translation where you want them, docked to an edge or floating free. Or read in Comfort, the quiet mode where the book is all there is.'],
    ['Themes', 'Forty-two themes for day and for night. And two that dress the whole page: a typewriter with a brass dashboard, and a blue terminal from the days of DOS.'],
    ['Bookmarks and notes', 'Bookmarks in seven colours, with a note on any of them. Search through them and you are back at the place in a moment.'],
    ['Search', 'Search in the book, and in ContinuousReader across the whole library at once.'],
    ['Navigation', 'Chapters always at hand, bookmarks marked along the progress line, and a look at any page before you turn to it.'],
    ['Pictures', 'Every illustration of the book in one row. Look at any of them at full size, or go back to where it lives in the text.'],
    ['Translation', 'Select a passage and read it in your own language. Or type a few words yourself: they are translated the moment you pause.'],
];

const apps = [
    {
        id: 'jr', name: 'JustReader', role: 'The nightstand', terms: 'Free', ground: '#f6efe5',
        text: 'One book at a time: open a file, read it, close it. There is no library to look after, and the reader is full-fledged.',
        store: 'https://apps.apple.com/app/justreader/id6781187067',
    },
    {
        id: 'pr', name: 'PlainReader', role: 'The shelf', terms: 'Bought once', ground: '#f7e7d0',
        text: 'A shelf of up to 1000 books with named, coloured dividers. Every book opens where you stopped, so several can be read at once. OPDS catalogues are built in.',
        store: 'https://apps.apple.com/app/plainreader/id6801140208',
    },
    {
        id: 'cr', name: 'ContinuousReader', role: 'The library', terms: 'Bought once', ground: '#f4e4ca',
        text: 'Folders, genres, series and a page for every author. Full-text search through every book, and the library and your reading in sync across your devices.',
        store: 'https://apps.apple.com/app/continuousreader/id6783733436',
    },
];

const element = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
    }
    node.append(...children.filter(Boolean));
    return node;
};

const outside = (href, words) => element('a', { href, target: '_blank', rel: 'noopener' }, t(words));

export function renderApps(host) {
    host.replaceChildren(
        element('a', { class: 'back', href: '#' }, '← ', t('Back')),
        element('p', { class: 'eyebrow', text: 'WebReader' }),
        element('h2', { text: t('More in the apps') }),
        element('p', { class: 'lead', text: t('This reader runs on the same engine as the family’s apps for iPhone, iPad and Mac. But the apps give a good deal more around it.') }),

        element('h3', { text: t('In the reader, in all three') }),
        element('dl', { class: 'features' }, ...reader.flatMap(([name, text]) => [
            element('div', {}, element('dt', { text: t(name) }), element('dd', { text: t(text) })),
        ])),
        element('p', { class: 'also', text: t('And there is more: Read Aloud that lights the line it reads, a reading journal and statistics.') }),

        element('h3', { text: t('Three ways to keep your books') }),
        element('div', { class: 'cards' }, ...apps.map((app) => element('article', { class: 'card' },
            // The family's pictures: one book, a stand with a few, a
            // bookcase — on their own paper.
            element('figure', { style: `background: ${app.ground}` }, element('img', { src: `img/room-${app.id}.webp`, alt: '', loading: 'lazy' })),
            element('header', {},
                element('img', { src: `icons/apps/icon-${app.id}.svg`, alt: '' }),
                element('div', {}, element('h4', { text: app.name }), element('p', { class: 'role', text: `${t(app.role)} · ${t(app.terms)}` }))),
            element('p', { text: t(app.text) }),
            element('p', { class: 'links' }, outside(app.store, 'App Store'), outside(site + 'family.html', 'About it'))))),
        element('p', { class: 'compare' }, outside(site + 'family.html', 'All three side by side, on the site')),
    );
}
