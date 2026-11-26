// NanoReader's window when no book is open: a sidebar, a toolbar with the
// page's own tools, the page, a status line. The address's hash says which
// page, as it does in the browser's reader.

import { t, languages, language } from './i18n.js';
import { make } from './drawer.js';
import { news } from './news.js';
import { desk } from './desk.js';
import { renderFamily } from './desk-family.js';
import { renderBooks, renderHistory, renderNotes, renderJournal, renderStats, today, button } from './desk-pages.js';

const icons = {
    books: 'M5 4h3v16H5zM10 4h3v16h-3zM15.5 5l3-.8 3.4 15-3 .8z',
    history: 'M12 4a8 8 0 1 1 0 16a8 8 0 0 1 0-16zM12 8v4.5l3 2',
    notes: 'M7 4h10v16l-5-4-5 4z',
    journal: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h4',
    stats: 'M5 20V11M11 20V5M17 20v-7M3 20h18',
    apps: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    news: 'M12 3l2.2 5.6L20 10l-4.6 3.6L17 20l-5-3.4L7 20l1.6-6.4L4 10l5.8-1.4z',
    prefs: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4',
};
const pages = [
    ['Reading', [['books', 'Books'], ['history', 'History']]],
    ['Records', [['notes', 'Notes'], ['journal', 'Journal'], ['stats', 'Statistics']]],
    ['NanoReader', [['apps', 'Other readers'], ['news', 'What’s new'], ['prefs', 'Settings']]],
];
const titles = Object.fromEntries(pages.flatMap(([, list]) => list));
/// A page's heading where the sidebar's short word would not say enough.
const headings = { history: 'Closed books' };

function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', icons[name]);
    svg.append(path);
    return svg;
}

export function deskHome(host, api) {
    const side = make('nav', { class: 'side' });
    const title = make('h1');
    const tools = make('div', { class: 'tools' });
    const own = make('div', { class: 'own-tools' });
    own.style.display = 'contents';
    tools.append(title, own);
    const said = make('p');
    const notice = make('div', { class: 'notice', role: 'alert', hidden: true }, said, make('button', { type: 'button', 'aria-label': t('Close'), text: '×' }));
    notice.querySelector('button').addEventListener('click', () => { notice.hidden = true; });
    const body = make('main', { class: 'body', tabIndex: -1 });
    const left = make('span'), right = make('span', { class: 'end' });
    host.replaceChildren(side, make('div', { class: 'main' }, tools, notice, body), make('footer', { class: 'statusline' }, left, right));
    // The sidebar folded to its icons, by the button before the title, the
    // View menu or a double click on its free room; kept.
    const fold = make('button', { type: 'button', class: 'fold', title: t('Show or Hide the Sidebar'), 'aria-label': t('Show or Hide the Sidebar') });
    fold.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M9.5 5v14"/></svg>';
    fold.addEventListener('click', () => toggleSide());
    tools.prepend(fold);
    side.addEventListener('dblclick', (event) => { if (!event.target.closest('a')) toggleSide(); });
    const folded = (on) => host.classList.toggle('folded', on);
    folded(localStorage.getItem('nano.desk.folded') === '1');
    function toggleSide() {
        const on = !host.classList.contains('folded');
        folded(on);
        localStorage.setItem('nano.desk.folded', on ? '1' : '0');
    }

    let current = 'books';
    let drawnPage = '';
    const draws = {
        books: renderBooks, history: renderHistory, notes: renderNotes, journal: renderJournal, stats: renderStats,
        apps: renderFamily, news: drawNews, prefs: drawPrefs,
    };
    const own_ = { ...api, again: () => draw(), say: (words) => say(words) };
    let drawn = 0;

    function draw() {
        title.replaceChildren(icon(current), t(headings[current] || titles[current]));
        for (const door of side.querySelectorAll('a')) {
            door.classList.toggle('chosen', door.dataset.page === current);
            if (door.dataset.page === current) door.setAttribute('aria-current', 'page'); else door.removeAttribute('aria-current');
        }
        left.textContent = today();
        right.textContent = api.version();
        const mine = ++drawn;
        // The same page drawn again (a note changed, a row let go): where its
        // lists stood is where they stay (user, 26.11.2026: the notes ran to
        // the top after an edit).
        const again = drawnPage === current;
        drawnPage = current;
        const scrolled = again ? [body, ...body.querySelectorAll('[data-keep-scroll]')].map((node) => [node.dataset.keepScroll || '', node.scrollTop]) : [];
        Promise.resolve(draws[current](body, own, { ...own_, stillHere: () => mine === drawn })).then(() => {
            if (mine !== drawn) return;
            for (const [name, top] of scrolled) {
                const node = name ? body.querySelector(`[data-keep-scroll="${name}"]`) : body;
                if (node) node.scrollTop = top;
            }
        });
        showDoors();
    }

    /// The closed books' door only where there are some.
    async function showDoors() {
        const door = side.querySelector('[data-page="history"]');
        if (!door) return;
        const onShelf = new Set((await api.places()).filter(Boolean).map((record) => record.key));
        door.hidden = !desk.history.some((entry) => !onShelf.has(entry.key)) && current !== 'history';
    }

    function say(words) {
        said.textContent = words || '';
        notice.hidden = !words;
        notice.querySelector('button').setAttribute('aria-label', t('Close'));
    }

    function speak() {
        // The program's own at the sidebar's foot, the reading above.
        side.replaceChildren(...pages.flatMap(([heading, list], index) => [
            make('h2', { text: t(heading), class: index === pages.length - 1 ? 'foot' : '' }),
            ...list.map(([page, word]) => {
                const door = make('a', { href: `#${page}`, title: t(word), 'data-page': page }, icon(page), make('span', { class: 'name', text: t(word) }));
                return door;
            }),
        ]));
        draw();
    }

    // MARK: The pages with no data of their own

    function drawNews(into, toolsOfPage) {
        toolsOfPage.replaceChildren(button('Feedback', () => api.feedback()));
        const pick = (words) => words[language()] || words.en;
        const when = new Intl.DateTimeFormat(language(), { day: 'numeric', month: 'long', year: 'numeric' });
        into.replaceChildren(make('div', { class: 'pad news selectable' }, ...news.map((entry) => make('article', {},
            make('span', { class: 'soft', text: when.format(new Date(`${entry.date}T12:00:00`)) }),
            make('h3', { text: pick(entry.title) }),
            make('p', { text: pick(entry.text) })))));
    }

    function drawPrefs(into, toolsOfPage) {
        toolsOfPage.replaceChildren();
        const choice = make('select', { class: 'pick', id: 'deskLanguage' }, new Option(t('As the system'), 'auto'), ...Object.entries(languages).map(([code, name]) => new Option(name, code)));
        choice.value = api.settings.language || 'auto';
        choice.addEventListener('change', () => api.setLanguage(choice.value));
        const light = make('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('Light') }, ...[['auto', 'Auto'], ['day', 'Day'], ['dusk', 'Twilight'], ['night', 'Night']].map(([value, word]) => {
            const key = make('button', { type: 'button', role: 'radio', text: t(word), 'data-value': value, 'aria-checked': String(api.settings.light === value) });
            key.classList.toggle('chosen', api.settings.light === value);
            key.addEventListener('click', () => { api.setLight(value); draw(); });
            return key;
        }));
        into.replaceChildren(make('div', { class: 'pad' }, make('div', { class: 'form' },
            make('label', { class: 'what', for: 'deskLanguage', text: t('Language') }), choice,
            make('span', { class: 'what', text: t('Light') }), light)));
    }

    return {
        speak, draw, toggleSide,
        show(page) {
            current = titles[page] ? page : 'books';
            body.scrollTop = 0;
            draw();
        },
        say,
        get page() { return current; },
        /// The keys' focus, taken from a book's frame that is gone.
        focus() { body.focus({ preventScroll: true }); },
    };
}
