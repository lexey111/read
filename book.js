// A file into a book: what it is is read from its bytes; the name only
// tells Markdown from plain text, which bytes cannot.

import { unzip } from './zip.js';
import { convertEPUB } from './epub.js';
import { convertFB2 } from './fb2.js';
import { convertText, convertHTML } from './text.js';
import { convertMarkdown } from './markdown.js';
import { convertPages, looksLikePictureBook } from './pages.js';
import { convertPDF, isPDF } from './pdf.js';

export const formats = 'EPUB, FB2, PDF, CBZ, Markdown, TXT, HTML and their ZIPs';
export const accept = '.epub,.fb2,.pdf,.cbz,.zip,.md,.markdown,.txt,.html,.htm,.xhtml,application/epub+zip,application/pdf';

const isMarkdown = (name) => /\.(md|markdown|mdown|mkd)$/i.test(name);
const isHTML = (name) => /\.x?html?$/i.test(name);

function single(bytes, name) {
    if (isPDF(bytes, name)) return convertPDF(bytes, name);
    // FictionBook by its root element, wherever the declaration puts it
    // (the zero bytes of a UTF-16 file are dropped for the look).
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 65536)).replace(/\0/g, '');
    if (/<FictionBook[\s>]/.test(head)) return convertFB2(bytes);
    if (isMarkdown(name)) return convertMarkdown(bytes, name);
    if (isHTML(name) || /^\s*(<!--[\s\S]*?-->\s*)*<(!doctype html|html[\s>])/i.test(head.replace(/^﻿|^ï»¿/, ''))) return convertHTML(bytes, name);
    // Text, if it reads as text: no control bytes but the line's own.
    const sample = bytes.subarray(0, 8192);
    const binary = [...sample].filter((b) => b < 9 || (b > 13 && b < 32)).length;
    const utf16 = (bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF);
    if (utf16 || binary <= sample.length / 200) return convertText(bytes, name);
    throw new Error(`This reader opens ${formats}.`);
}

export async function convert(buffer, name = '') {
    const bytes = new Uint8Array(buffer);
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4B)) return single(bytes, name);

    // A zip: an EPUB by its container, a book of pictures by its contents,
    // else the one book inside.
    const entries = await unzip(buffer);
    if (entries.has('META-INF/container.xml')) return convertEPUB(entries);
    const names = [...entries.keys()];
    if (looksLikePictureBook(names)) return convertPages(entries, name);
    const books = names.filter((entry) => /\.(fb2|pdf|md|markdown|txt|x?html?)$/i.test(entry) && !entry.includes('__MACOSX') && !entry.split('/').pop().startsWith('.'));
    if (books.length === 1) {
        const inner = books[0].split('/').pop();
        return single(await entries.get(books[0])(), inner);
    }
    if (books.length > 1) throw new Error('This archive holds several books. Unpack it and open one.');
    throw new Error('No book in this archive.');
}
