// FictionBook into the family's page. The mapping is ReaderCore's
// `FB2Converter`: sections, titles, epigraphs, poems, cites; the notes
// body gathered for the page's popups; the pictures out of <binary>.
// The page is built as elements, never as text, so nothing in a book can
// write markup of its own.

import { page } from './template.js';
import { decode, looksRightToLeft } from './bytes.js';

// Entities HTML knows and XML does not, met in files typed by hand.
const entities = {
    nbsp: 160, laquo: 171, raquo: 187, mdash: 8212, ndash: 8211, hellip: 8230, copy: 169, reg: 174,
    trade: 8482, ldquo: 8220, rdquo: 8221, lsquo: 8216, rsquo: 8217, bull: 8226, middot: 183, euro: 8364,
    pound: 163, yen: 165, sect: 167, para: 182, deg: 176, plusmn: 177, times: 215, divide: 247,
    frac12: 189, frac14: 188, frac34: 190,
};

function parse(text) {
    const read = (source) => {
        const doc = new DOMParser().parseFromString(source, 'application/xml');
        return doc.getElementsByTagName('parsererror').length ? null : doc;
    };
    return read(text) || read(text
        .replace(/&([a-z0-9]+);/gi, (whole, name) => (entities[name] ? `&#${entities[name]};` : whole))
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''));
}

const children = (node, name) => [...node.children].filter((child) => child.localName === name);
const firstIn = (node, name) => node.getElementsByTagNameNS('*', name)[0] || null;
/// `l:href` or `xlink:href`, whatever the prefix was bound to.
const hrefOf = (node) => [...node.attributes].find((attribute) => attribute.localName === 'href')?.value.trim() || '';

const pictureTypes = /^image\/(png|jpe?g|gif|webp|bmp)$/i;

/// `{ title, author, language, rightToLeft, chapters, html, urls }`.
export function convertFB2(bytes) {
    const source = parse(decode(bytes));
    const root = source?.documentElement;
    if (!root || root.localName !== 'FictionBook') throw new Error('This file is not a readable FB2 book.');

    const info = firstIn(root, 'title-info') || root;
    const title = firstIn(info, 'book-title')?.textContent.trim() || 'Untitled';
    const author = children(info, 'author').map((person) =>
        ['first-name', 'middle-name', 'last-name'].map((part) => children(person, part)[0]?.textContent.trim() || '').filter(Boolean).join(' '))
        .filter(Boolean).join(', ');
    const language = (firstIn(info, 'lang')?.textContent.trim() || '').split('-')[0].toLowerCase();

    // The pictures: <binary id> as blob URLs.
    const urls = [];
    const pictures = new Map();
    for (const binary of children(root, 'binary')) {
        const id = binary.getAttribute('id');
        const type = binary.getAttribute('content-type') || 'image/jpeg';
        if (!id || !pictureTypes.test(type)) continue;
        try {
            const raw = atob(binary.textContent.replace(/\s+/g, ''));
            const data = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([data], { type }));
            urls.push(url);
            pictures.set(id, url);
        } catch { /* not base64: no picture */ }
    }

    const out = document.implementation.createHTMLDocument('');
    const make = (tag, className) => { const element = out.createElement(tag); if (className) element.className = className; return element; };

    const picture = (node) => {
        const url = pictures.get(hrefOf(node).replace(/^#/, ''));
        if (!url) return null;
        const box = make('div', 'book-image');
        const img = make('img');
        img.src = url;
        img.alt = '';
        box.appendChild(img);
        return box;
    };

    /// The text of a paragraph, a verse, a subtitle: words and what marks them.
    const inline = (node, into) => {
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
                into.appendChild(out.createTextNode(child.nodeValue));
                continue;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            const tag = { strong: 'strong', emphasis: 'em', strikethrough: 's', code: 'code', sup: 'sup', sub: 'sub' }[child.localName];
            if (tag) {
                inline(child, into.appendChild(make(tag)));
            } else if (child.localName === 'a') {
                const href = hrefOf(child);
                let link;
                if (child.getAttribute('type') === 'note' || href.startsWith('#')) {
                    // A note, or a place in the book: the page's handler
                    // tells them apart by what stands under the id.
                    link = make('a', 'footnote-ref');
                    link.dataset.footnoteId = href.replace(/^#/, '');
                } else if (/^https?:\/\//i.test(href)) {
                    link = make('a');
                    link.href = href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                } else {
                    link = make('span', 'note');
                }
                inline(child, into.appendChild(link));
            } else if (child.localName === 'image') {
                const box = picture(child);
                if (box) into.appendChild(box);
            } else {
                inline(child, into);
            }
        }
        return into;
    };

    const sections = [];
    /// A block of the book, as the element it becomes; null for nothing.
    const block = (node) => {
        const inner = (element) => {
            for (const child of node.children) { const made = block(child); if (made) element.appendChild(made); }
            return element;
        };
        switch (node.localName) {
        case 'section': {
            const section = make('section');
            section.id = '_cr_ch' + sections.length;
            sections.push(section);
            return inner(section);
        }
        case 'title': {
            // Its lines are paragraphs of their own inside the heading.
            const heading = make('h2');
            for (const child of node.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) { const made = block(child); if (made) heading.appendChild(made); }
                else if (child.nodeType === Node.TEXT_NODE) heading.appendChild(out.createTextNode(child.nodeValue));
            }
            return heading;
        }
        case 'epigraph': return inner(make('blockquote', 'epigraph'));
        case 'cite': return inner(make('blockquote'));
        case 'poem': return inner(make('div', 'poem'));
        case 'stanza': return inner(make('div', 'stanza'));
        case 'v': return inline(node, make('div', 'verse'));
        case 'subtitle': return inline(node, make('h3'));
        case 'empty-line': return make('br');
        case 'image': return picture(node);
        case 'p': {
            // The paragraph's own id stays: a note kept in the main body and
            // its place in the text point at each other by id.
            const paragraph = inline(node, make('p'));
            if (node.getAttribute('id')) paragraph.id = node.getAttribute('id');
            return paragraph;
        }
        default: {
            const text = node.textContent.trim();
            if (!text) return null;
            const paragraph = make('p');
            paragraph.textContent = text;
            return paragraph;
        }
        }
    };

    const main = make('div');
    const notes = make('div');
    notes.id = '_cr_footnotes';
    notes.setAttribute('style', 'display:none');

    // The cover first: this reader has no shelf to show it on.
    const cover = firstIn(info, 'coverpage');
    const coverPicture = cover && firstIn(cover, 'image') && picture(firstIn(cover, 'image'));
    if (coverPicture) main.appendChild(coverPicture);

    for (const body of children(root, 'body')) {
        const name = (body.getAttribute('name') || '').toLowerCase();
        if (name === 'notes' || name === 'comments') {
            for (const section of children(body, 'section')) {
                const id = section.getAttribute('id');
                if (!id) continue;
                const note = make('div', 'footnote-body');
                note.id = id;
                for (const child of section.children) { const made = block(child); if (made) note.appendChild(made); }
                notes.appendChild(note);
            }
        } else {
            for (const child of body.children) { const made = block(child); if (made) main.appendChild(made); }
        }
    }
    // A note's own sections are not chapters.
    const chapterSections = sections.filter((section) => main.contains(section));
    chapterSections.forEach((section, index) => { section.id = '_cr_ch' + index; });
    for (const section of notes.querySelectorAll('section')) section.removeAttribute('id');
    if (!main.textContent.trim() && !main.querySelector('img')) throw new Error('This FB2 has no text to show.');

    // A section's title is its own first heading — one that stands before
    // any section inside it. Untitled sections stay out of the contents
    // unless the book has no titles at all.
    const titled = chapterSections.map((section) => {
        const heading = [...section.children].find((child) => /^h[23]$/i.test(child.localName));
        const name = heading?.textContent.replace(/\s+/g, ' ').trim() || '';
        return { id: section.id, title: name.replace(/[\s*·•—–-]/g, '') ? name : '' };
    });
    const named = titled.filter((chapter) => chapter.title);
    const chapters = named.length >= 2 ? named : titled.map((chapter, index) => ({ id: chapter.id, title: chapter.title || `Chapter ${index + 1}` }));

    const body = main.innerHTML + (notes.children.length ? '\n' + notes.outerHTML : '');
    const css = `blockquote.epigraph { border-left: 3px solid #ccc; padding-left: 1em; }
        .footnote-ref { font-size: 0.85em; }
        .note { color: #666; font-size: 0.85em; }`;
    const rightToLeft = ['he', 'ar', 'fa', 'ur', 'yi'].includes(language) || looksRightToLeft(main.textContent.slice(0, 20000));
    return { title, author, language, rightToLeft, chapters, html: page(body, title, language, css), urls };
}
