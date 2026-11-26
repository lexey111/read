// What NanoReader keeps of the reader's own: the books that were opened
// (the history's ten and what is known of each), the marks and notes, the
// sittings. All of it stands in the program's files (`desktop.js`,
// `kept`), not in the page's storage, which a system may clean; in a
// browser nothing of this runs.
//
// A book is known by its key, `name:size` — the one the shelf uses — so
// its marks, notes and place outlive the file's slot.

import { desktop, kept, keepHere } from './desktop.js';

/// The history's length, as JustReader's.
export const historyLength = 10;

/// A sitting shorter than this is a glance, not reading; without a touch
/// for `idle` the clock stands; after `pause` the next touch begins another
/// sitting. The apps' numbers (`ReaderView+BottomBar`).
const shortest = 10;
const idle = 5 * 60 * 1000;
const pause = 30 * 60 * 1000;

/// `books[key]`: { title, author, pages, progress, xpath, scrollY, opens, opened, path?, link? }
/// `marks[key]`: { note, list: [{ id, kind, text, note, colour, xpath, charOffset, progress, made }] }
/// `history`: [{ key, title, author, name, path?, link?, opened }], the newest first
/// `journal`: [{ id, key, title, author, start, end, seconds, from, to, pages }], the oldest first
export const desk = { books: {}, marks: {}, history: [], journal: [] };

export async function openDesk() {
    if (!desktop) return;
    const [books, marks, history, journal] = await Promise.all([kept('books', {}), kept('marks', {}), kept('history', []), kept('journal', [])]);
    Object.assign(desk, { books, marks, history, journal });
}

/// Written whole, one write at a time, the last state always the last
/// written.
const writing = {};
export function store(name) {
    const line = writing[name] ||= { busy: false, again: false };
    if (line.busy) { line.again = true; return; }
    line.busy = true;
    Promise.resolve(keepHere(name, desk[name])).catch(() => {}).finally(() => {
        line.busy = false;
        if (line.again) { line.again = false; store(name); }
    });
}

// MARK: - The history and the books

/// A book opened: first in the history, and one more opening of it.
export function noteOpened(key, book, file) {
    const now = Date.now();
    const before = desk.history.find((entry) => entry.key === key);
    const entry = {
        key, title: book.title, author: book.author || '', name: file.name,
        // A book loaded into its place and read from it later: where it came
        // from is what its loading said.
        path: file.path || before?.path || desk.books[key]?.path, link: bare(file.link) || before?.link || desk.books[key]?.link, opened: now,
    };
    desk.history = [entry, ...desk.history.filter((other) => other.key !== key)].slice(0, historyLength);
    store('history');
    const known = desk.books[key] || { opens: 0, progress: 0 };
    desk.books[key] = { ...known, title: book.title, author: book.author || '', opens: known.opens + 1, opened: now, path: entry.path, link: entry.link };
    store('books');
}

/// A link as it is remembered: without a name and a password in it.
function bare(link) {
    if (!link) return undefined;
    const url = new URL(link);
    url.username = '';
    url.password = '';
    return url.href;
}

/// A book loaded into a place, not opened: where its file is, for the
/// closed books later.
export function noteLoaded(key, book, file) {
    const known = desk.books[key] || { opens: 0, progress: 0 };
    desk.books[key] = { ...known, title: book.title, author: book.author || '', name: file.name, path: file.path || known.path, link: bare(file.link) || known.link, loaded: Date.now() };
    store('books');
}

/// A book let go from its place: among the closed books, opened or not.
export function noteClosed(key) {
    const known = desk.books[key];
    if (!known) return;
    const before = desk.history.find((entry) => entry.key === key);
    const entry = before || { key, title: known.title, author: known.author || '', name: known.name || '', path: known.path, link: known.link, opened: known.opened || known.loaded || Date.now() };
    desk.history = [{ ...entry, closed: Date.now() }, ...desk.history.filter((other) => other.key !== key)].slice(0, historyLength);
    store('history');
}

export function dropFromHistory(key) {
    desk.history = desk.history.filter((entry) => entry.key !== key);
    store('history');
}

/// Where the reader is, kept with the book; not written at every turn of
/// a page — the clock's tick and the book's closing write it.
export function notePlace(key, place, pages) {
    const known = desk.books[key];
    if (!known) return;
    Object.assign(known, { progress: place.progress || 0, xpath: place.xpath || '', scrollY: place.scrollY || 0 });
    if (pages) known.pages = pages;
}

// MARK: - Marks

export const marksOf = (key) => desk.marks[key] || { note: '', list: [] };

function ownMarks(key) {
    return (desk.marks[key] ||= { note: '', list: [] });
}

export function addMark(key, mark) {
    const made = { id: crypto.randomUUID(), note: '', made: Date.now(), ...mark };
    ownMarks(key).list.push(made);
    store('marks');
    return made;
}

export function changeMark(key, id, fields) {
    const mark = ownMarks(key).list.find((one) => one.id === id);
    if (mark) { Object.assign(mark, fields); store('marks'); }
    return mark;
}

export function removeMark(key, id) {
    const own = ownMarks(key);
    own.list = own.list.filter((one) => one.id !== id);
    sweep(key);
}

export function setNote(key, note) {
    ownMarks(key).note = note;
    sweep(key);
}

function sweep(key) {
    const own = desk.marks[key];
    if (own && !own.list.length && !own.note.trim()) delete desk.marks[key];
    store('marks');
}

// MARK: - The sittings

let sitting = null;
let book = null;
let touched = 0;
let tickedAt = 0;
let timer = 0;
let where = () => ({ progress: 0 });

const reading = () => document.visibilityState === 'visible' && document.hasFocus() && Date.now() - touched < idle;

/// A book is on the screen: `{ key, title, author, pages }`; `at()` says
/// where the reader is.
export function beginReading(next, at) {
    endReading();
    if (!desktop) return;
    book = next;
    where = at;
    touched = Date.now();
    tickedAt = Date.now();
    timer = setInterval(tick, 10_000);
}

/// The reader did something. The first sign after a long break begins
/// another sitting.
export function touch() {
    if (!book) return;
    const now = Date.now();
    if (sitting && now - touched > pause) { tick(); sitting = null; }
    if (now - touched >= idle) tickedAt = now;
    touched = now;
}

/// The time since the last tick, where the reader was reading. A gap
/// longer than a tick can be is a sleep, and is not counted.
function tick({ leaving = false } = {}) {
    const now = Date.now();
    const past = now - tickedAt;
    tickedAt = now;
    if (!book) return;
    if ((leaving ? now - touched < idle : reading()) && past > 0 && past < 30_000) {
        const progress = where().progress || 0;
        sitting ||= { id: crypto.randomUUID(), key: book.key, title: book.title, author: book.author || '', start: now - past, seconds: 0, from: progress, to: progress, pages: 0 };
        sitting.seconds += past / 1000;
        sitting.end = now;
    }
    write();
}

/// The sitting as it stands, kept at every tick: a program that ends
/// without a word loses no more than ten seconds.
function write() {
    if (!book) return;
    const at = where();
    notePlace(book.key, at, book.pages);
    store('books');
    if (!sitting || sitting.seconds < shortest) return;
    sitting.to = at.progress || 0;
    sitting.pages = Math.max(0, Math.round((sitting.to - sitting.from) * (book.pages || 0)));
    const record = { ...sitting, seconds: Math.round(sitting.seconds) };
    const index = desk.journal.findIndex((one) => one.id === record.id);
    if (index < 0) desk.journal.push(record); else desk.journal[index] = record;
    store('journal');
}

export function endReading() {
    clearInterval(timer);
    if (!book) return;
    tick();
    book = null;
    sitting = null;
}

if (desktop) {
    // The window left: the clock stops there, not at the next tick. The
    // page in its frame taking the focus blurs this window too, and is no
    // leaving: the document still has the focus then.
    let away = false;
    const leave = () => { if (away) return; away = true; tick({ leaving: true }); };
    const back = () => { if (!away) return; away = false; tickedAt = Date.now(); touch(); };
    addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) leave(); }, 0));
    addEventListener('focus', back);
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? leave() : back()));
}

/// For the tests: the clock moved on by hand.
export const clock = { tick, get sitting() { return sitting; } };
