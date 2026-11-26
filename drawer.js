// The book's drawer over the strip: its contents, a search, the reader's
// marks, its pictures — a tab each — and a place to go to at the foot. The
// page script does the work, as it does for the apps' panels; here are the
// lists and what a press on them asks of it.

import { t, pageLabel } from './i18n.js';

export const make = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for') node.setAttribute(key, value);
        else node[key] = value;
    }
    node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
    return node;
};

export const percent = (share) => `${Math.round(share * 100)}%`;

/// The tile the arrows lead to in a grid of tiles: across a row, or to the
/// one under or above (the same column, by where it stands).
export function pictureStep(tile, key) {
    const all = [...tile.parentNode.children];
    const at = all.indexOf(tile);
    if (key === 'ArrowRight') return all[at + 1];
    if (key === 'ArrowLeft') return all[at - 1];
    if (key === 'Home') return all[0];
    if (key === 'End') return all.at(-1);
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
    const across = all.filter((one) => one.offsetTop === all[0].offsetTop).length || 1;
    return all[at + (key === 'ArrowDown' ? across : -across)];
}

/// `reader`: what the drawer asks of the shell — the open book, the page's
/// script, where the reader is, how many pages there are, whether it turns
/// them; `marks` is the marks' own section (`marks.js`), null where they
/// are not kept.
export function bookDrawer(host, reader) {
    const strip = host.querySelector('.tabs');
    const section = (name) => host.querySelector(`[data-section="${name}"]`);
    let shown = 'contents';

    const offered = () => {
        const book = reader.book();
        return {
            contents: !!(book?.chapters && book.chapters.length > 1),
            search: !!book && !book.pages,
            marks: !!book && !!reader.marks && !book.pages,
            notes: !!book && !!reader.marks && !book.pages,
            pictures: !!book && !book.pages && pictures().length > 1,
        };
    };

    function open(wanted) {
        const have = offered();
        const tab = have[wanted] ? wanted : Object.keys(have).find((name) => have[name]);
        if (!tab) return;
        // A tab left takes its traces off the page.
        if (shown === 'search' && tab !== 'search') clearSearch();
        shown = tab;
        for (const button of strip.children) {
            const name = button.dataset.tab;
            button.hidden = !have[name];
            button.classList.toggle('chosen', name === tab);
            button.setAttribute('aria-selected', String(name === tab));
        }
        for (const part of host.querySelectorAll('[data-section]')) part.hidden = part.dataset.section !== tab;
        // One tab alone needs no strip of them.
        strip.hidden = Object.values(have).filter(Boolean).length < 2;
        reader.opened?.(tab);
        host.hidden = false;
        draw[tab]();
        goField.value = '';
        goField.placeholder = t('Page or %');
    }

    function close() {
        if (host.hidden) return;
        reader.closing?.();
        host.hidden = true;
        clearSearch();
        reader.closed();
    }

    strip.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-tab]')?.dataset.tab;
        if (tab) open(tab);
    });
    host.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        // The arrows walk a list's rows; from the search's field, into its hits.
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const down = event.key === 'ArrowDown';
        const field = event.target.matches?.('.search input');
        const list = field ? section('search').querySelector('.list') : event.target.closest?.('.list');
        if (!list || (!field && !event.target.matches('button'))) return;
        const rows = [...list.querySelectorAll('button:not(.icon)')];
        const next = field ? (down ? rows[0] : null) : rows[rows.indexOf(event.target) + (down ? 1 : -1)];
        if (!next) return;
        event.preventDefault();
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
    });

    /// A choice made: the drawer goes from over the page. In a window of
    /// its own it stays, and the page takes the keys.
    function leave() {
        reader.landed?.();
        if (!reader.docked) return close();
        reader.page()?.focus();
        reader.left?.();
        return undefined;
    }

    // MARK: Contents

    /// A list that travels. The chapter the reader is in is marked — the
    /// last whose place is not past the page's.
    function drawContents() {
        const tracker = reader.tracker();
        const book = reader.book();
        const places = new Map(JSON.parse(tracker.getChapterPositions(book.chapters.map((chapter) => chapter.id))).map((p) => [p.id, p.progress]));
        const here = (tracker.getPosition().progress || 0) + 0.0005;
        let current = -1;
        book.chapters.forEach((chapter, index) => { if (places.has(chapter.id) && places.get(chapter.id) <= here) current = index; });
        section('contents').replaceChildren(...book.chapters.map((chapter, index) => {
            const row = make('button', { type: 'button', text: chapter.title });
            row.classList.toggle('chosen', index === current);
            row.addEventListener('click', () => {
                leave();
                tracker.scrollToElementId(chapter.id);
                [...section('contents').children].forEach((other) => other.classList.toggle('chosen', other === row));
            });
            return row;
        }));
        section('contents').querySelector('.chosen')?.scrollIntoView({ block: 'center' });
    }

    // MARK: Search

    const words = section('search').querySelector('input');
    const said = section('search').querySelector('output');
    const hits = section('search').querySelector('.list');
    /// The list stops here: a common word has thousands of hits, and
    /// nobody reads them; the steps still walk them all.
    const listed = 300;
    let waiting = 0;
    let found = 0;
    let at = -1;

    function drawSearch() {
        words.focus();
        words.select();
        if (words.value.trim()) find();
    }

    /// The hits lit on the page and listed; the page stays where it is
    /// until one is chosen.
    function find() {
        clearTimeout(waiting);
        const query = words.value.trim();
        const tracker = reader.tracker();
        at = -1;
        found = 0;
        if (query) {
            tracker.searchNoScroll(query, false);
            reader.settled?.();
            const results = JSON.parse(tracker.getSearchResults());
            found = results.length;
            hits.replaceChildren(...results.slice(0, listed).map((hit, index) => {
                const row = make('button', { type: 'button' }, snippet(hit.text, query), make('span', { class: 'where', text: percent(hit.progress) }));
                row.addEventListener('click', () => { at = reader.tracker().searchGoTo(index); mark(index); reader.landed?.(); });
                return row;
            }));
            if (found > listed) hits.append(make('p', { class: 'rest', text: t('The first {n} are listed.').replace('{n}', listed) }));
        } else {
            tracker.searchClear();
            reader.settled?.();
            hits.replaceChildren();
        }
        said.textContent = !query ? '' : found ? t('Found: {n}').replace('{n}', found) : t('Nothing found');
        for (const step of section('search').querySelectorAll('[data-step]')) step.disabled = !found;
    }

    /// The words asked for, told apart in the line they stand in.
    function snippet(text, query) {
        const line = make('span', { class: 'line' });
        const start = text.toLowerCase().indexOf(query.toLowerCase().replace(/\s+/g, ' '));
        if (start < 0) { line.textContent = text; return line; }
        line.append(text.slice(0, start), make('b', { text: text.slice(start, start + query.length) }), text.slice(start + query.length));
        return line;
    }

    function mark(index) {
        at = index;
        [...hits.querySelectorAll('button')].forEach((row, number) => row.classList.toggle('chosen', number === index));
        hits.querySelector('.chosen')?.scrollIntoView({ block: 'nearest' });
        said.textContent = t('{i} of {n}').replace('{i}', index + 1).replace('{n}', found);
    }

    function step(delta) {
        if (!found) return;
        // The first step goes to the first hit, or back to the last.
        const next = at < 0 ? (delta > 0 ? 0 : found - 1) : (at + delta + found) % found;
        reader.tracker().searchGoTo(next);
        mark(next);
        reader.landed?.();
    }

    function clearSearch() {
        clearTimeout(waiting);
        if (found) { reader.tracker()?.searchClear(); reader.settled?.(); }
        found = 0;
        at = -1;
    }

    words.addEventListener('input', () => { clearTimeout(waiting); waiting = setTimeout(find, 250); });
    words.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        // Typed and Return before the pause: searched first.
        if (!found) find();
        step(event.shiftKey ? -1 : 1);
    });
    section('search').addEventListener('click', (event) => {
        const delta = Number(event.target.closest('[data-step]')?.dataset.step);
        if (delta) step(delta);
    });

    // MARK: Pictures

    /// The book's pictures in their order, the small ones (a flourish, a
    /// rule) left out.
    function pictures() {
        const page = reader.page();
        const tracker = reader.tracker();
        if (!page || !tracker) return [];
        const nodes = [...page.document.querySelectorAll('img')];
        return JSON.parse(tracker.getImagePositions())
            .map((place) => ({ ...place, node: nodes[place.index] }))
            .filter(({ node, src }) => src && node && node.naturalWidth >= 80 && node.naturalHeight >= 80);
    }

    function drawPictures() {
        const list = pictures();
        section('pictures').replaceChildren(...list.map((picture, index) => {
            const tile = make('button', { type: 'button', title: percent(picture.progress), tabIndex: index === 0 ? 0 : -1 }, make('img', { src: picture.node.src, alt: '', loading: 'lazy' }));
            tile.setAttribute('aria-label', `${t('Pictures')}, ${index + 1}`);
            // A list's way (user, 26.11.2026): a click chooses; a double one,
            // or Return, goes to the picture; Space shows it alone; the
            // arrows walk the grid.
            const go = () => {
                reader.tracker().scrollToImage(picture.src, picture.progress);
                reader.tracker().pulseImage(picture.src, reader.accent());
                reader.landed?.();
            };
            tile.addEventListener('click', () => choosePicture(tile));
            tile.addEventListener('dblclick', go);
            tile.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') { event.preventDefault(); go(); }
                else if (event.key === ' ') { event.preventDefault(); reader.left?.(); zoom(list, index); }
                else {
                    const next = pictureStep(tile, event.key);
                    if (next) { event.preventDefault(); choosePicture(next); }
                }
            });
            return tile;
        }));
    }

    function choosePicture(tile) {
        for (const other of section('pictures').children) { const it = other === tile; other.classList.toggle('chosen', it); other.tabIndex = it ? 0 : -1; }
        tile.focus();
        tile.scrollIntoView({ block: 'nearest' });
    }

    /// A picture alone on the screen; the arrows go to the next.
    function zoom(list, start) {
        const box = document.getElementById('picture');
        const image = box.querySelector('img');
        let index = start;
        const show = () => { image.src = list[index].node.src; };
        const keys = (event) => {
            const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
            if (!delta) return;
            event.preventDefault();
            index = (index + delta + list.length) % list.length;
            show();
        };
        show();
        box.addEventListener('keydown', keys);
        box.addEventListener('close', () => box.removeEventListener('keydown', keys), { once: true });
        box.showModal();
    }
    document.getElementById('picture').addEventListener('click', (event) => event.currentTarget.close());

    // MARK: A place to go to

    const goField = host.querySelector('.go input');
    host.querySelector('.go').addEventListener('submit', (event) => {
        event.preventDefault();
        const text = goField.value.trim().replace(',', '.');
        const number = parseFloat(text);
        if (!Number.isFinite(number)) return;
        const tracker = reader.tracker();
        const pages = reader.pages();
        if (text.endsWith('%')) tracker.scrollToProgress(Math.min(1, Math.max(0, number / 100)));
        // The line under the page counts columns; a turn goes by spreads.
        else if (reader.turning()) tracker.goToPage(Math.floor((Math.min(pages, Math.max(1, Math.round(number))) - 1) / (reader.columns?.() || 1)));
        else tracker.scrollToProgress(Math.min(1, Math.max(0, (number - 1) / Math.max(1, pages - 1))));
        leave();
    });

    const draw = {
        contents: drawContents,
        search: drawSearch,
        pictures: drawPictures,
        marks: () => reader.marks.draw(section('marks'), { leave }),
        notes: () => reader.marks.drawNote(section('notes')),
    };

    return {
        open,
        close,
        /// The same door again shuts it.
        toggle(tab) { if (!host.hidden && shown === tab) close(); else open(tab); },
        redraw(tab) { if (!host.hidden && shown === tab) draw[tab](); },
        get isOpen() { return !host.hidden; },
        get tab() { return shown; },
        offered,
        /// The shell's language changed.
        speak() {
            words.placeholder = t('Search in the book');
            words.setAttribute('aria-label', t('Search in the book'));
            for (const button of strip.children) button.textContent = t(button.dataset.word);
        },
        pageLabel,
    };
}
