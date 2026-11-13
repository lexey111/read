// Plain text and a web page into the family's page (ReaderCore's
// `TXTConverter` and `HTMLConverter`).

import { page } from './template.js';
import { decode, looksRightToLeft } from './bytes.js';
import { sanitize } from './sanitize.js';

const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';

/// A line a paragraph.
export function convertText(bytes, name) {
    const text = decode(bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (!text.trim()) throw new Error('This text file is empty.');
    const holder = document.implementation.createHTMLDocument('');
    const body = holder.createElement('div');
    for (const line of text.split('\n')) {
        const words = line.trim();
        if (!words) continue;
        const paragraph = holder.createElement('p');
        paragraph.textContent = words;
        body.appendChild(paragraph);
    }
    const title = stem(name);
    return { title, author: '', language: '', rightToLeft: looksRightToLeft(text), chapters: [], html: page(body.innerHTML, title, '') };
}

/// The headings of the first two levels are the chapters; a heading with
/// an id keeps it.
export function chaptersFromHeadings(root) {
    const chapters = [];
    for (const heading of root.querySelectorAll('h1, h2')) {
        const title = heading.textContent.replace(/\s+/g, ' ').trim();
        if (!heading.id) heading.id = '_cr_ch' + chapters.length;
        chapters.push({ id: heading.id, title: title || `Chapter ${chapters.length + 1}` });
    }
    return chapters;
}

/// A saved page: its text, cleaned; no pictures (they were not saved with
/// it), no link out of the page but to the web.
export function convertHTML(bytes, name) {
    const source = new DOMParser().parseFromString(decode(bytes), 'text/html');
    const title = source.title.trim() || stem(name);
    const language = (source.documentElement.getAttribute('lang') || '').split('-')[0].toLowerCase();
    const holder = document.implementation.createHTMLDocument('');
    const body = holder.createElement('div');
    for (const child of [...source.body.childNodes]) body.appendChild(holder.importNode(child, true));
    sanitize(body);
    body.querySelectorAll('img, picture, nav, header, footer, aside[role="complementary"]').forEach((node) => node.remove());
    links(body);
    if (!body.textContent.trim()) throw new Error('This page has no text to show.');
    const chapters = chaptersFromHeadings(body);
    return { title, author: '', language, rightToLeft: looksRightToLeft(body.textContent.slice(0, 20000)), chapters: chapters.length >= 2 ? chapters : [], html: page(body.innerHTML, title, language) };
}

/// Links as the reader takes them: a place in the page through the
/// page's handler, the web in a new tab, anything else inert.
export function links(root) {
    const ids = new Set([...root.querySelectorAll('[id]')].map((node) => node.id));
    for (const link of root.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href').trim();
        if (/^https?:\/\//i.test(href)) {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
            continue;
        }
        link.removeAttribute('href');
        const id = href.startsWith('#') ? decodeURIComponentSafe(href.slice(1)) : '';
        if (id && ids.has(id)) {
            link.classList.add('_cr_jump');
            link.dataset.footnoteId = id;
        } else if (!link.id && !link.classList.contains('footnote-ref')) {
            // A link to nowhere is its words: it must not look like a link.
            link.replaceWith(...link.childNodes);
        }
    }
}

function decodeURIComponentSafe(text) {
    try { return decodeURIComponent(text); } catch { return text; }
}
