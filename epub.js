// EPUB into the family's page: the spine's documents joined into one, notes
// gathered for the page's popups, links between the files turned into
// travel inside the page, the book's own contents read.
//
// The decisions are ReaderCore's `EPUBConverter` (which files are notes,
// what a note is, what a link becomes); the work is done on the DOM the
// browser parses, where the Swift side has regular expressions. No
// dependency.

import { page } from './template.js';
import { decode, looksRightToLeft } from './bytes.js';
import { sanitize } from './sanitize.js';

function safeDecodeURI(text) {
    try { return decodeURIComponent(text); } catch { return text; }
}

/// `href` as a path in the archive, read from the file `base`.
function resolve(base, href) {
    const parts = base.split('/').slice(0, -1);
    for (const part of safeDecodeURI(href).split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.' && part !== '') parts.push(part);
    }
    return parts.join('/');
}

function xml(text, type = 'application/xml') {
    return new DOMParser().parseFromString(text, type);
}

const first = (node, name) => node.getElementsByTagNameNS('*', name)[0] || null;
const all = (node, name) => [...node.getElementsByTagNameNS('*', name)];

// MARK: - Notes

const textLength = (node) => node.textContent.trim().length;
const htmlLength = (html, holder) => { const box = holder.createElement('div'); box.innerHTML = html; return textLength(box); };

/// A note's length, in characters of text, that no chapter has.
const shortNote = 1500;
const noteTags = new Set(['aside', 'div', 'section', 'p', 'span', 'li', 'dd', 'td', 'a']);

/// The elements the links point at, as a note's HTML each: `{ id → html }`.
/// An inline anchor that is only the note's MARKER — `<a id="n1">[1]</a>
/// Note text…` — is not the note: the paragraph round it is, without the
/// marker.
function noteElements(item, ids) {
    const found = new Map();
    for (const id of ids) {
        const element = item.ids.get(id);
        if (!element) continue;
        const tag = element.localName.toLowerCase();
        if (!noteTags.has(tag)) continue;
        let content = element.innerHTML.trim();
        if ((tag === 'a' || tag === 'span') && textLength(element) <= 6) {
            const paragraph = element.closest('p, li, dd');
            if (paragraph && item.element.contains(paragraph)) {
                const copy = paragraph.cloneNode(true);
                [...copy.querySelectorAll('[id]')].find((node) => node.getAttribute('id') === id)?.remove();
                content = copy.innerHTML.trim();
            }
        }
        if (content) found.set(id, content);
    }
    return found;
}

/// A file is notes when links from other files point into it and it is
/// named for notes, or the pointed-at elements are most of its text and
/// none of them is a chapter in a note's place: a long one that is most of
/// the file is a section the contents point at.
function isNotesFile(item, targets, holder) {
    const ids = targets.get(item.path);
    if (!ids) return false;
    if (item.path.split('/').pop().toLowerCase().includes('note')) return true;
    const matched = [...ids].filter((id) => item.ids.has(id)).length;
    if (matched === 0 || matched < Math.floor(ids.size / 2)) return false;
    const notes = [...noteElements(item, ids).values()].map((html) => htmlLength(html, holder));
    const whole = Math.max(1, textLength(item.element));
    const longest = Math.max(0, ...notes);
    const noteSized = longest * 2 < whole || longest <= shortNote;
    return notes.reduce((sum, length) => sum + length, 0) / whole >= 0.5 && noteSized;
}

// MARK: - Contents

function contentsEntries(opf, opfPath, manifest, entries, text) {
    const read = async () => {
        const spine = first(opf, 'spine');
        const ncx = manifest.get(spine?.getAttribute('toc')) || [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml');
        if (ncx && entries.has(ncx.path)) {
            const doc = xml(await text(ncx.path));
            const list = all(doc, 'navPoint').map((point) => {
                const label = first(point, 'text')?.textContent || '';
                const source = first(point, 'content')?.getAttribute('src') || '';
                const [file, fragment] = source.split('#');
                return { title: label, path: resolve(ncx.path, file), fragment: fragment ? safeDecodeURI(fragment) : null };
            });
            if (list.length) return list;
        }
        const nav = [...manifest.values()].find((item) => /\bnav\b/.test(item.properties));
        if (nav && entries.has(nav.path)) {
            const source = await text(nav.path);
            let doc = xml(source, 'application/xhtml+xml');
            if (doc.getElementsByTagName('parsererror').length) doc = xml(source, 'text/html');
            const lists = all(doc, 'nav');
            const contents = lists.find((node) => /\btoc\b/.test(node.getAttribute('epub:type') || node.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || lists[0];
            if (contents) {
                return all(contents, 'a').filter((link) => link.getAttribute('href')).map((link) => {
                    const [file, fragment] = link.getAttribute('href').split('#');
                    return { title: link.textContent, path: file ? resolve(nav.path, file) : nav.path, fragment: fragment ? safeDecodeURI(fragment) : null };
                });
            }
        }
        return [];
    };
    return read().catch(() => []);
}

/// A file's own heading, where the book declares no contents; a line of
/// asterisks or dashes is a scene break, not a title.
function headingOf(element) {
    for (const tag of ['h1', 'h2', 'h3']) {
        for (const heading of element.querySelectorAll(tag)) {
            const title = heading.textContent.replace(/\s+/g, ' ').trim();
            if (title && title.replace(/[\s*·•—–-]/g, '')) return title;
        }
    }
    return null;
}

// MARK: - The book

const mimeByExtension = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
};

/// The archive's entries (`unzip`) into `{ title, author, language,
/// rightToLeft, chapters, html, urls }` — `chapters` are `{ title, id }` in reading order, `urls` the blob URLs
/// made for the pictures, to revoke when the book is closed.
export async function convertEPUB(entries) {
    const text = async (name) => {
        const read = entries.get(name);
        if (!read) throw new Error('Missing in the EPUB: ' + name);
        return decode(await read());
    };
    if (entries.has('META-INF/encryption.xml')) {
        // Text encrypted is DRM; obfuscated fonts are not.
        const encrypted = all(xml(await text('META-INF/encryption.xml')), 'CipherReference')
            .map((reference) => reference.getAttribute('URI') || '');
        if (encrypted.some((uri) => /\.(x?html?|xml)$/i.test(uri))) {
            throw new Error('This book is protected (DRM) and cannot be opened.');
        }
    }
    if (!entries.has('META-INF/container.xml')) throw new Error('Not an EPUB: no container.');
    const opfPath = first(xml(await text('META-INF/container.xml')), 'rootfile')?.getAttribute('full-path');
    if (!opfPath) throw new Error('Not an EPUB: no package file.');
    const opf = xml(await text(opfPath));

    const title = first(opf, 'title')?.textContent.trim() || 'Untitled';
    const author = all(opf, 'creator').map((creator) => creator.textContent.trim()).filter(Boolean).join(', ');
    const language = (first(opf, 'language')?.textContent.trim() || '').split('-')[0].toLowerCase();
    const spine = first(opf, 'spine');
    const declared = spine?.getAttribute('page-progression-direction');

    const manifest = new Map();
    for (const item of all(opf, 'item')) {
        manifest.set(item.getAttribute('id'), {
            path: resolve(opfPath, item.getAttribute('href') || ''),
            type: item.getAttribute('media-type') || '',
            properties: item.getAttribute('properties') || '',
        });
    }

    const urls = [];
    const pictures = new Map();
    const picture = async (path) => {
        if (pictures.has(path)) return pictures.get(path);
        const read = entries.get(path);
        if (!read) return null;
        const extension = path.split('.').pop().toLowerCase();
        const type = mimeByExtension[extension];
        if (!type) return null;
        const url = URL.createObjectURL(new Blob([await read()], { type }));
        urls.push(url);
        pictures.set(path, url);
        return url;
    };

    // The cover's picture, for the book's card at home: EPUB 3's
    // `cover-image`, else EPUB 2's <meta name="cover">.
    const coverMeta = all(opf, 'meta').find((meta) => meta.getAttribute('name') === 'cover')?.getAttribute('content');
    const coverItem = [...manifest.values()].find((item) => /\bcover-image\b/.test(item.properties))
        || (coverMeta && manifest.get(coverMeta)) || null;
    const cover = coverItem && /^image\//.test(coverItem.type) ? await picture(coverItem.path) : null;

    // Pass 1: every spine document as elements in one holder, cleaned, its
    // pictures in place, its links to other files noted.
    const holder = document.implementation.createHTMLDocument('');
    const items = [];
    /// file → the fragment ids links from OTHER files point at.
    const targets = new Map();
    /// `file#id` → the files such a link stands in.
    const sources = new Map();
    for (const reference of spine ? all(spine, 'itemref') : []) {
        const entry = manifest.get(reference.getAttribute('idref'));
        if (!entry || !/html|xml/.test(entry.type) || !entries.has(entry.path)) continue;
        const source = await text(entry.path);
        let doc = xml(source, 'application/xhtml+xml');
        if (doc.getElementsByTagName('parsererror').length || !doc.body) doc = xml(source, 'text/html');
        if (!doc.body) continue;

        // Through HTML text, so the elements are HTML's whatever the file was.
        const element = holder.createElement('div');
        const carrier = holder.createElement('div');
        for (const child of [...doc.body.childNodes]) carrier.appendChild(holder.importNode(child, true));
        element.innerHTML = carrier.innerHTML;
        sanitize(element);

        for (const img of [...element.querySelectorAll('img')]) {
            const source = (img.getAttribute('src') || '').trim();
            if (/^data:image\//i.test(source)) continue;
            // Nothing is fetched from outside: a book does not phone home.
            const url = !source || /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('//') ? null : await picture(resolve(entry.path, source));
            if (url) img.setAttribute('src', url); else img.remove();
        }

        const ids = new Map();
        for (const node of element.querySelectorAll('[id]')) {
            if (!ids.has(node.getAttribute('id'))) ids.set(node.getAttribute('id'), node);
        }
        const item = { path: entry.path, element, ids };
        items.push(item);

        for (const link of element.querySelectorAll('a[href]')) {
            const href = link.getAttribute('href').trim();
            if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || !href.includes('#')) continue;
            const [file, fragment] = href.split('#');
            const path = resolve(entry.path, file);
            const id = safeDecodeURI(fragment);
            if (!targets.has(path)) targets.set(path, new Set());
            targets.get(path).add(id);
            const key = path + '#' + id;
            if (!sources.has(key)) sources.set(key, new Set());
            sources.get(key).add(entry.path);
        }
    }

    // Pass 2: the notes — whole files of them, and the pointed-at elements
    // of any file, unless such a "note" is most of its file: that is a
    // chapter a contents page points at, a place to go and not a popup.
    const notesFiles = new Set(items.filter((item) => isNotesFile(item, targets, holder)).map((item) => item.path));
    const notes = new Map();
    for (const item of items) {
        const ids = targets.get(item.path);
        if (!ids) continue;
        const whole = Math.max(1, textLength(item.element));
        // A note's own marker links BACK to the one in the text: that is
        // the way back, not a second note made of the sentence.
        const fromText = notesFiles.has(item.path) ? ids
            : [...ids].filter((id) => [...sources.get(item.path + '#' + id)].some((path) => !notesFiles.has(path)));
        for (const [id, content] of noteElements(item, fromText)) {
            if (notes.has(id)) continue;
            if (notesFiles.has(item.path) || htmlLength(content, holder) * 2 < whole) notes.set(id, content);
        }
    }

    // EPUB 3's own way: a link marked `noteref` and the note it names, in
    // the same file or another. The note pops up whatever its size, and an
    // <aside> made for a popup leaves the text, as the standard asks.
    const noteRole = /\b(footnote|endnote|rearnote|note)\b/;
    for (const item of items) {
        if (notesFiles.has(item.path)) continue;
        for (const link of item.element.querySelectorAll('a[href]')) {
            if (!/\bnoteref\b/.test(`${link.getAttribute('epub:type') || ''} ${link.getAttribute('role') || ''}`)) continue;
            const [file, rawFragment] = link.getAttribute('href').trim().split('#');
            const id = rawFragment ? safeDecodeURI(rawFragment) : '';
            const owner = file ? items.find((candidate) => candidate.path === resolve(item.path, file)) : item;
            const target = id && owner ? owner.ids.get(id) : null;
            if (!target || notes.has(id)) continue;
            const content = noteElements(owner, [id]).get(id);
            if (!content) continue;
            notes.set(id, content);
            const isAside = target.localName.toLowerCase() === 'aside'
                && noteRole.test(`${target.getAttribute('epub:type') || ''} ${target.getAttribute('role') || ''}`);
            if (isAside) { target.remove(); owner.ids.delete(id); }
        }
    }

    // The files that are the book: each in a wrapper the contents can name.
    const kept = [];
    const wrappers = new Map();
    for (const item of items) {
        if (notesFiles.has(item.path)) continue;
        if (!textLength(item.element) && !item.element.querySelector('img')) continue;
        item.element.id = '_cr_ch' + kept.length;
        item.element.className = '_cr_chapter';
        wrappers.set(item.path, item.element.id);
        kept.push(item);
    }
    if (!kept.length) throw new Error('This EPUB has no text to show.');
    const placed = new Set(kept.flatMap((item) => [...item.ids.keys()]));

    // The links. A note opens in the page's popup; a place in the book is
    // travelled to — both through the page's own handler, which reads
    // `data-footnote-id` and tells a note from a place by what stands there.
    // Nothing keeps an `href` into the book: the frame must not navigate.
    for (const item of kept) {
        for (const link of [...item.element.querySelectorAll('a[href]')]) {
            const href = link.getAttribute('href').trim();
            if (/^https?:/i.test(href)) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
                continue;
            }
            link.removeAttribute('href');
            if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
            const [file, rawFragment] = href.split('#');
            const fragment = rawFragment ? safeDecodeURI(rawFragment) : '';
            const path = file ? resolve(item.path, file) : item.path;
            if (fragment && notes.has(fragment)) {
                link.classList.add('footnote-ref');
                link.dataset.footnoteId = fragment;
            } else if (fragment && placed.has(fragment)) {
                link.classList.add('_cr_jump');
                link.dataset.footnoteId = fragment;
            } else if (wrappers.has(path) && path !== item.path) {
                link.classList.add('_cr_jump');
                link.dataset.footnoteId = wrappers.get(path);
            }
        }
    }

    // The book's own contents beat a guess per file: a conversion from FB2
    // has neither headings nor a file a chapter.
    let chapters = [];
    for (const entry of await contentsEntries(opf, opfPath, manifest, entries, text)) {
        const wrapper = wrappers.get(entry.path);
        const name = entry.title.replace(/\s+/g, ' ').trim();
        if (!wrapper || !name) continue;
        const item = kept.find((candidate) => candidate.path === entry.path);
        chapters.push({ title: name, id: entry.fragment && item.ids.has(entry.fragment) ? entry.fragment : wrapper });
    }
    if (chapters.length < 2) {
        chapters = kept.map((item, index) => ({ title: headingOf(item.element) || `Chapter ${index + 1}`, id: item.element.id }));
    }

    let body = kept.map((item) => item.element.outerHTML).join('\n');
    if (notes.size) {
        const box = holder.createElement('div');
        box.id = '_cr_footnotes';
        box.setAttribute('style', 'display:none');
        for (const [id, content] of notes) {
            const note = holder.createElement('div');
            note.id = id;
            note.className = 'footnote-body';
            note.innerHTML = content;
            for (const link of note.querySelectorAll('a[href]')) link.removeAttribute('href');
            box.appendChild(note);
        }
        body += '\n' + box.outerHTML;
    }

    // The spine's word, else the letters' (the family's `TextDirection`).
    const rightToLeft = declared ? declared === 'rtl' : looksRightToLeft(kept.map((item) => item.element.textContent.slice(0, 4000)).join(' '));
    return { title, author, language, rightToLeft, chapters, html: page(body, title, language), urls, cover };
}
