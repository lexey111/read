// The reader's marks on the page (NanoReader): a bar over a selection with
// the family's seven colours, the drawer's tab with the marks and the
// book's note, and the window where a mark's note is written. The page
// script finds the words again and tints them, as it does for the apps.

import { t } from './i18n.js';
import { make, percent } from './drawer.js';
import { marksOf, addMark, changeMark, removeMark, setNote } from './desk.js';

/// The family's colours in their order (`BookColor`), as the page tints
/// them.
export const colours = [
    ['Red', '#ff3b30'], ['Orange', '#ff9500'], ['Yellow', '#ffcc00'], ['Green', '#34c759'],
    ['Blue', '#3b82f6'], ['Purple', '#af52de'], ['Gray', '#8e8e93'],
];

const icon = (path) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', path);
    svg.append(line);
    return svg;
};
const pencil = 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3';
const copyIcon = 'M9 9h10v11H9zM5 15V4h10';

/// `reader`: the open book, its tracker, its frame.
export function bookMarks(reader) {
    const bar = document.getElementById('markBar');
    const edit = document.getElementById('markEdit');
    let colour = Number(localStorage.getItem('nano.mark.colour') ?? 2);
    /// The mark the selection stands in, if it does.
    let under = null;
    let redraw = () => {};

    const key = () => reader.book()?.key;
    const list = () => marksOf(key()).list;

    /// The page's tints, as the marks stand.
    function paint() {
        const tracker = reader.tracker();
        if (!tracker || !key()) return;
        tracker.highlightBookmarks(list().map((mark) => ({
            id: mark.id, progress: mark.progress, preview: mark.text, xpath: mark.xpath, colorIndex: mark.colour, charOffset: mark.charOffset || 0,
            // A selection's words are the mark, however short.
            exact: mark.kind === 'text',
        })));
        reader.settled?.();
    }

    function choose(index) {
        colour = index;
        localStorage.setItem('nano.mark.colour', String(index));
    }

    /// The selection marked, or with nothing selected the place — unless
    /// only a selection is asked for (the menu's command).
    function add({ colour: wanted = colour, write = false, selected = false } = {}) {
        const tracker = reader.tracker();
        if (!tracker || !key() || reader.book().pages) return null;
        if (selected && !(tracker.getSelectedText() || '').trim()) return null;
        choose(wanted);
        const id = tracker.markAtSelection?.();
        const standing = id && list().find((mark) => mark.id === id);
        if (standing) {
            changeMark(key(), id, { colour: wanted });
            settle(standing, write);
            return standing;
        }
        const words = (tracker.getSelectedText() || '').trim();
        const at = words ? tracker.getSelectionPosition() : tracker.getPosition();
        const text = words || (tracker.getVisibleText?.() || '').trim() || t('Bookmark');
        const mark = addMark(key(), {
            kind: words ? 'text' : 'place', text, colour: wanted,
            xpath: at.xpath || '', charOffset: at.charOffset || 0, progress: at.progress || 0,
        });
        settle(mark, write);
        return mark;
    }

    function settle(mark, write) {
        paint();
        reader.page()?.getSelection()?.removeAllRanges();
        hide();
        redraw();
        if (write) open(mark.id);
    }

    // MARK: The bar over a selection

    const dots = (chosen, pick) => colours.map(([name, value], index) => {
        const dot = make('button', { type: 'button', class: 'dot', title: t(name), 'aria-label': t(name) });
        dot.style.setProperty('--dot', value);
        dot.classList.toggle('chosen', index === chosen);
        dot.addEventListener('click', () => pick(index));
        return dot;
    });

    function selection(words) {
        if (!words || !words.trim() || reader.book()?.pages) return hide();
        const tracker = reader.tracker();
        const id = tracker.markAtSelection?.();
        under = (id && list().find((mark) => mark.id === id)) || null;
        const note = make('button', { type: 'button', class: 'icon', title: t('Note'), 'aria-label': t('Note') }, icon(pencil));
        note.addEventListener('click', () => (under ? (hide(), open(under.id)) : add({ write: true })));
        const copy = make('button', { type: 'button', class: 'icon', title: t('Copy'), 'aria-label': t('Copy') }, icon(copyIcon));
        copy.addEventListener('click', () => { navigator.clipboard?.writeText(words).catch(() => {}); hide(); });
        bar.replaceChildren(...dots(under ? under.colour : -1, (index) => add({ colour: index })), note, copy);
        bar.hidden = false;
        stand();
    }

    /// Over the selection, or under it where the top has no room.
    function stand() {
        if (bar.hidden) return;
        const picked = reader.page()?.getSelection();
        if (!picked || picked.isCollapsed || !picked.rangeCount) return hide();
        const rects = [...picked.getRangeAt(0).getClientRects()].filter((rect) => rect.width && rect.right > 0 && rect.left < reader.page().innerWidth);
        if (!rects.length) return hide();
        const frame = reader.frame().getBoundingClientRect();
        const first = rects[0], last = rects[rects.length - 1];
        const above = frame.top + first.top - bar.offsetHeight - 8;
        const top = above >= 6 ? above : Math.min(innerHeight - bar.offsetHeight - 6, frame.top + last.bottom + 8);
        const left = frame.left + first.left + Math.min(first.width, 200) / 2 - bar.offsetWidth / 2;
        bar.style.top = `${Math.round(top)}px`;
        bar.style.left = `${Math.round(Math.max(6, Math.min(innerWidth - bar.offsetWidth - 6, left)))}px`;
    }

    function hide() {
        bar.hidden = true;
        under = null;
    }
    // A press on the bar leaves the page its selection.
    bar.addEventListener('pointerdown', (event) => event.preventDefault());
    bar.addEventListener('mousedown', (event) => event.preventDefault());

    // MARK: A mark's window

    function open(id) {
        const own = key();
        const mark = list().find((one) => one.id === id);
        if (!mark) return;
        const words = make('textarea', { rows: 4, value: mark.note || '', placeholder: t('Note') });
        words.setAttribute('aria-label', t('Note'));
        let gone = false;
        const row = make('div', { class: 'dots' });
        const fill = () => row.replaceChildren(...dots(mark.colour, (index) => {
            choose(index);
            changeMark(own, id, { colour: index });
            fill();
            paint();
            redraw();
        }));
        fill();
        const remove = make('button', { type: 'button', class: 'quiet', text: t('Delete') });
        remove.addEventListener('click', () => { gone = true; removeMark(own, id); edit.close(); });
        const done = make('button', { type: 'button', class: 'prominent', text: t('Done') });
        done.addEventListener('click', () => edit.close());
        edit.replaceChildren(make('blockquote', { text: mark.text }), words, row, make('footer', {}, remove, done));
        edit.setAttribute('aria-label', t('Note'));
        edit.addEventListener('close', () => {
            if (!gone) changeMark(own, id, { note: words.value.trim() });
            if (key() === own) { paint(); redraw(); reader.page()?.focus(); }
        }, { once: true });
        // ⌘Return, Ctrl+Return: done.
        words.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); edit.close(); }
        });
        edit.showModal();
        words.focus();
    }

    // MARK: The drawer's tab

    let noteTimer = 0;
    function draw(section, { leave }) {
        const own = key();
        redraw = () => { if (!section.hidden && key()) draw(section, { leave }); };
        const marks = [...list()].sort((a, b) => a.progress - b.progress);
        const rows = marks.map((mark) => {
            const dot = make('i', { class: 'dot', 'aria-hidden': 'true' });
            dot.style.setProperty('--dot', colours[mark.colour]?.[1] || colours[4][1]);
            const travel = make('button', { type: 'button', class: 'travel' }, dot,
                make('span', { class: 'words' }, make('span', { class: 'line', text: mark.text }), mark.note ? make('span', { class: 'note', text: mark.note }) : null),
                make('span', { class: 'where', text: percent(mark.progress) }));
            travel.addEventListener('click', () => { leave(); go(mark); });
            const change = make('button', { type: 'button', class: 'icon', title: t('Note'), 'aria-label': t('Note') }, icon(pencil));
            change.addEventListener('click', () => open(mark.id));
            return make('div', { class: 'mark' }, travel, change);
        });
        // Marks come from a selection and its bar; a place marked unseen
        // (the top paragraph) was a surprise (user, 26.11.2026).
        section.replaceChildren(make('div', { class: 'list' }, ...(rows.length ? rows : [make('p', { class: 'rest', text: t('No bookmarks yet') })])));
    }

    /// The book's own note, a tab of its own (user, 26.11.2026): the whole
    /// height to write in, not a few lines under the marks.
    function drawNote(section) {
        const own = key();
        const note = make('textarea', { value: marksOf(own).note, placeholder: t('Your comment on the book') });
        note.setAttribute('aria-label', t('Your comment on the book'));
        note.addEventListener('input', () => { clearTimeout(noteTimer); noteTimer = setTimeout(() => setNote(own, note.value), 400); });
        note.addEventListener('change', () => { clearTimeout(noteTimer); setNote(own, note.value); });
        section.replaceChildren(note);
    }

    function go(mark) {
        reader.tracker()?.scrollToXPath(mark.xpath, mark.progress, false);
        reader.landed?.();
        reader.page()?.focus();
    }

    return {
        add, draw, drawNote, paint, selection, stand, hide, go, open,
        redraw: () => redraw(),
        /// A press on a marked place of the page opens the mark.
        pressed(event) {
            const id = event.target.closest?.('[data-crbm]')?.getAttribute('data-crbm');
            if (!id || event.target.closest('a[href]') || !reader.page().getSelection().isCollapsed) return false;
            if (!list().some((mark) => mark.id === id)) return false;
            open(id);
            return true;
        },
        get offered() { return !!key() && !reader.book().pages; },
    };
}
