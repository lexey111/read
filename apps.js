// «More in the apps»: what the family's three apps add around the same
// page — the reader's own features first, then each app's way of keeping
// books, with the doors to the site and the App Store.

import { t } from './i18n.js';
import { desktop, appName } from './desktop.js';

export const site = 'https://continuousreader.app/';

// What this reader has not. The search, the pictures and the contents are
// in both; the marks, the journal and the statistics in NanoReader.
export const reader = [
    ['Panels', 'An IDE for reading. Build your own reader: contents, bookmarks, notes and translation where you want them, docked to an edge or floating free. Or read in Comfort, the quiet mode where the book is all there is.'],
    ['Themes', 'Themes for day and for night in five palettes. And two that dress the whole page: a typewriter with a brass dashboard, and BookCommander, the blue panels from the days of DOS.'],
    ...(desktop ? [] : [['Bookmarks and notes', 'Bookmarks in seven colours, with a note on any of them. Search through them and you are back at the place in a moment.']]),
    ['Navigation', 'Chapters always at hand, bookmarks marked along the progress line, and a look at any page before you turn to it.'],
    ['Translation', 'Select a passage and read it in your own language. Or type a few words yourself: they are translated the moment you pause.'],
];
export const also = desktop
    ? 'And there is more: Read Aloud that lights the line it reads.'
    : 'And there is more: Read Aloud that lights the line it reads, a reading journal and statistics.';

// The apps in the words of their own About, the pictures too; `ground` is
// the paper each is drawn on.
export const apps = [
    {
        id: 'jr', name: 'JustReader', role: 'The nightstand', terms: 'Free', ground: '#fdf1db',
        text: 'Three books at hand: open a file and read.',
        store: 'https://apps.apple.com/app/justreader/id6781187067',
    },
    {
        id: 'pr', name: 'PlainReader', role: 'The bookshelf', terms: 'One-time purchase', ground: '#fcefd9',
        text: 'For reading several books at once, or keeping them on a shelf to come back to later. Every book keeps its bookmarks and notes, and the shelf is in order — not a full library like ContinuousReader, but a really long shelf, with coloured sections, search and filters.',
        store: 'https://apps.apple.com/app/plainreader/id6801140208',
    },
    {
        id: 'cr', name: 'ContinuousReader', role: 'The library', terms: 'One-time purchase', ground: '#f4e3cb',
        text: 'Folders, tags, genres, favourites, search by what is new, by history, author, series, even full-text search — everything you can imagine. OPDS catalogs that check for new arrivals and download in bulk. Downloads from the web. And the cherry on top: the library and the reading position sync between devices in real time.',
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
        element('p', { class: 'eyebrow', text: appName }),
        element('h2', { text: t('More in the apps') }),
        element('p', { class: 'lead', text: t('This reader runs on the same engine as the family’s apps for iPhone, iPad and Mac. But the apps give a good deal more around it.') }),

        element('h3', { text: t('In the reader, in all three') }),
        element('dl', { class: 'features' }, ...reader.flatMap(([name, text]) => [
            element('div', {}, element('dt', { text: t(name) }), element('dd', { text: t(text) })),
        ])),
        element('p', { class: 'also', text: t(also) }),

        element('h3', { text: t('Three ways to keep your books') }),
        element('div', { class: 'cards' }, ...apps.map((app) => element('article', { class: 'card' },
            // The family's pictures: a nightstand, a bookcase with its
            // lectern, a library — on their own paper.
            element('figure', { style: `background: ${app.ground}` }, element('img', { src: `img/room-${app.id}.webp`, alt: '', loading: 'lazy' })),
            element('header', {},
                element('img', { src: `icons/apps/icon-${app.id}.svg`, alt: '' }),
                element('div', {}, element('h4', { text: app.name }), element('p', { class: 'role', text: t(app.role) }), element('p', { class: 'role', text: t(app.terms) }))),
            element('p', { text: t(app.text) }),
            element('p', { class: 'links' }, outside(app.store, 'App Store'), outside(site + 'family.html', 'About it'))))),
        element('p', { class: 'compare' }, outside(site + 'family.html', 'All three side by side, on the site')),
    );
}
