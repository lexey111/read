// Markdown into the family's page (ReaderCore's `MarkdownConverter`): a small
// CommonMark + GFM pass of its own — headings are the chapters, a front
// matter block names the book, footnotes take the reader's popup shape,
// whatever HTML the author typed is cleaned like any page.

import { page } from './template.js';
import { decode, looksRightToLeft } from './bytes.js';
import { sanitize } from './sanitize.js';
import { chaptersFromHeadings, links } from './text.js';

const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/// Text for the page: `&` alone escaped where it starts no entity.
const textOut = (text) => text.replace(/&(?![a-z][a-z0-9]*;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/// The flat `key: value` and `key: [a, b]` / `- item` shapes.
function frontMatter(text) {
    const match = text.match(/^---[ \t]*\n([\s\S]*?)\n(---|\.\.\.)[ \t]*(\n|$)/);
    if (!match) return { meta: {}, rest: text };
    const meta = {};
    let key = null;
    for (const line of match[1].split('\n')) {
        const item = line.match(/^\s+-\s+(.*)$/);
        if (item && key) { (meta[key] = Array.isArray(meta[key]) ? meta[key] : []).push(unquote(item[1])); continue; }
        const pair = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (!pair) continue;
        key = pair[1].toLowerCase();
        const value = pair[2].trim();
        meta[key] = value.startsWith('[') ? value.slice(1, -1).split(',').map(unquote).filter(Boolean) : unquote(value);
    }
    return { meta, rest: text.slice(match[0].length) };
}
const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, '$2');
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

// MARK: - Inline

/// A note's number by its label, for the whole book.
const numbers = new Map();

function inline(text, notes) {
    const kept = [];
    const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
    let s = text
        // Code spans first: nothing reaches inside them.
        .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, ticks, code) => keep(`<code>${escape(code.replace(/^ (.*) $/, '$1'))}</code>`))
        // An escaped character is itself.
        .replace(/\\([!-\/:-@\[-`{-~])/g, (_, c) => keep(escape(c)))
        // Footnote references.
        // Footnote references, numbered in the order they are first met.
        .replace(/\[\^([^\]\s]+)\]/g, (whole, label) => {
            if (!notes.has(label)) return whole;
            if (!numbers.has(label)) numbers.set(label, numbers.size + 1);
            return keep(`<sup><a class="footnote-ref" data-footnote-id="_cr_fn_${escape(label)}">${numbers.get(label)}</a></sup>`);
        })
        // Pictures: no file beside a Markdown file in a browser — the words stay.
        .replace(/!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g, (_, alt) => keep(alt ? `<em>${escape(alt)}</em>` : ''))
        .replace(/\[([^\]]+)\]\(<?([^)\s>]*)>?(?:\s+"([^"]*)")?\)/g, (_, words, href, title) => keep(`<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}>`) + words + keep('</a>'))
        .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) => keep(`<a href="${escape(url)}">${escape(url)}</a>`))
        // The author's own HTML, cleaned with the rest of the page later.
        .replace(/<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/g, (tag) => keep(tag));
    s = textOut(s)
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
        .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1(?![A-Za-z0-9])/g, '<em>$2</em>')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
        .replace(/ {2,}\n|\\\n/g, '<br>\n');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[+i]);
}

// MARK: - Blocks

const starts = {
    fence: /^ {0,3}(```+|~~~+)\s*([\w+-]*)/,
    heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
    rule: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    quote: /^ {0,3}>/,
    item: /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/,
    html: /^ {0,3}<(\/?)(div|p|table|pre|blockquote|section|aside|figure|details|ul|ol|dl|h[1-6]|hr|center)\b/i,
};

function blocks(lines, notes) {
    let out = '';
    let i = 0;
    const paragraphEnds = (line) => !line.trim() || starts.fence.test(line) || starts.heading.test(line) || starts.rule.test(line) || starts.quote.test(line) || starts.html.test(line) || (starts.item.test(line) && !/^\s*\d/.test(line));
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        let m;
        if ((m = line.match(starts.fence))) {
            const fence = m[1];
            const code = [];
            for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) code.push(lines[i]);
            i++;
            out += `<pre><code>${escape(code.join('\n'))}</code></pre>\n`;
        } else if ((m = line.match(starts.heading))) {
            out += `<h${m[1].length}>${inline(m[2] || '', notes)}</h${m[1].length}>\n`;
            i++;
        } else if (starts.rule.test(line)) {
            out += '<hr>\n';
            i++;
        } else if (/^( {4}|\t)/.test(line)) {
            const code = [];
            while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) code.push(lines[i++].replace(/^( {4}|\t)/, ''));
            out += `<pre><code>${escape(code.join('\n').replace(/\n+$/, ''))}</code></pre>\n`;
        } else if (starts.quote.test(line)) {
            const inner = [];
            while (i < lines.length && lines[i].trim() && (starts.quote.test(lines[i]) || !paragraphEnds(lines[i]))) inner.push(lines[i++].replace(/^ {0,3}> ?/, ''));
            out += `<blockquote>${blocks(inner, notes)}</blockquote>\n`;
        } else if ((m = line.match(starts.item))) {
            const ordered = /\d/.test(m[2]);
            const items = [];
            while (i < lines.length) {
                const head = lines[i].match(starts.item);
                if (!head || /\d/.test(head[2]) !== ordered) break;
                const indent = head[0].length;
                const body = [lines[i].slice(indent)];
                for (i++; i < lines.length; i++) {
                    const next = lines[i];
                    if (!next.trim()) {
                        if (i + 1 < lines.length && /^\s+/.test(lines[i + 1]) && lines[i + 1].match(/^\s*/)[0].length >= Math.min(indent, 2)) { body.push(''); continue; }
                        break;
                    }
                    const nested = next.match(/^\s*/)[0].length >= Math.min(indent, 2);
                    if (!nested && (starts.item.test(next) || paragraphEnds(next))) break;
                    body.push(nested ? next.replace(new RegExp(`^ {0,${indent}}`), '') : next);
                }
                items.push(body);
                while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && starts.item.test(lines[i + 1])) i++;
            }
            const start = ordered && +m[2].replace(/\D/g, '') !== 1 ? ` start="${+m[2].replace(/\D/g, '')}"` : '';
            out += `<${ordered ? 'ol' : 'ul'}${start}>` + items.map((body) => {
                const task = body[0].match(/^\[([ xX])\][ \t]+/);
                if (task) body[0] = body[0].slice(task[0].length);
                const html = body.length === 1 ? inline(body[0], notes) : blocks(body, notes).replace(/^<p>([\s\S]*?)<\/p>\n(?![\s\S]*<p>)/, '$1');
                return `<li>${task ? (task[1] === ' ' ? '☐ ' : '☑ ') : ''}${html}</li>`;
            }).join('') + `</${ordered ? 'ol' : 'ul'}>\n`;
        } else if (starts.html.test(line)) {
            const raw = [];
            while (i < lines.length && lines[i].trim()) raw.push(lines[i++]);
            out += raw.join('\n') + '\n';
        } else if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
            const cells = (row) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
            const aligns = cells(lines[i + 1]).map((cell) => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : ''));
            const row = (values, tag) => '<tr>' + values.map((value, k) => `<${tag}${aligns[k] ? ` class="_cr_align_${aligns[k]}"` : ''}>${inline(value, notes)}</${tag}>`).join('') + '</tr>';
            let html = `<table><thead>${row(cells(line), 'th')}</thead><tbody>`;
            for (i += 2; i < lines.length && lines[i].trim() && /\|/.test(lines[i]); i++) html += row(cells(lines[i]), 'td');
            out += html + '</tbody></table>\n';
        } else {
            const text = [line];
            for (i++; i < lines.length && !paragraphEnds(lines[i]); i++) {
                // A setext heading: the paragraph above a line of = or -.
                if (/^ {0,3}(=+|-+)[ \t]*$/.test(lines[i])) break;
                text.push(lines[i]);
            }
            const setext = i < lines.length && lines[i].match(/^ {0,3}(=+|-+)[ \t]*$/);
            if (setext) {
                const level = setext[1][0] === '=' ? 1 : 2;
                out += `<h${level}>${inline(text.join('\n').trim(), notes)}</h${level}>\n`;
                i++;
            } else {
                out += `<p>${inline(text.join('\n').trim(), notes)}</p>\n`;
            }
        }
    }
    return out;
}

export function convertMarkdown(bytes, name) {
    numbers.clear();
    const { meta, rest } = frontMatter(decode(bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n'));
    // Footnote definitions out of the flow first: `[^label]: text`, and the
    // indented lines after it.
    const notes = new Map();
    const lines = [];
    const source = rest.split('\n');
    for (let i = 0; i < source.length; i++) {
        const m = source[i].match(/^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/);
        if (!m) { lines.push(source[i]); continue; }
        const body = [m[2]];
        while (i + 1 < source.length && (/^( {2,}|\t)/.test(source[i + 1]) || (!source[i + 1].trim() && /^( {2,}|\t)/.test(source[i + 2] || '')))) body.push(source[++i].replace(/^( {4}|\t| {2})/, ''));
        notes.set(m[1], body);
    }
    let html = blocks(lines, notes);
    if (notes.size) {
        html += '\n<div id="_cr_footnotes" style="display:none">\n' +
            [...notes].map(([label, body]) => `<div id="_cr_fn_${escape(label)}" class="footnote-body">${blocks(body, notes)}</div>`).join('\n') + '\n</div>';
    }

    // Built as text, cleaned as elements in a document that runs nothing.
    const holder = document.implementation.createHTMLDocument('');
    const root = holder.createElement('div');
    root.innerHTML = html;
    sanitize(root);
    root.querySelectorAll('img').forEach((img) => { if (!/^data:image\//i.test(img.getAttribute('src') || '')) img.remove(); });
    links(root);
    if (!root.textContent.trim()) throw new Error('This Markdown file is empty.');

    const firstHeading = root.querySelector('h1')?.textContent.trim();
    const title = list(meta.title)[0] || firstHeading || name.replace(/\.[^.]+$/, '') || 'Untitled';
    const author = [...list(meta.authors), ...list(meta.author)].join(', ');
    const language = (list(meta.lang)[0] || list(meta.language)[0] || '').split('-')[0].toLowerCase();
    const chapters = chaptersFromHeadings(root);
    const css = `table { border-collapse: collapse; margin: 1em 0; } th, td { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); padding: 0.3em 0.6em; }
        ._cr_align_center { text-align: center; } ._cr_align_right { text-align: right; }
        pre { white-space: pre-wrap; font-size: 0.9em; } pre code { background: none; }
        hr { border: 0; border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent); margin: 1.5em 0; }`;
    return {
        title, author, language,
        rightToLeft: looksRightToLeft(root.textContent.slice(0, 20000)),
        chapters: chapters.length >= 2 ? chapters : [],
        html: page(root.innerHTML, title, language, css),
    };
}
