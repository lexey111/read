// The reader's notes as a file: Markdown for the notes apps, CSV for the
// tables, RIS for the reference managers (Zotero, EndNote, Mendeley), JSON
// for a program. `books`: [{ title, author, note, marks: [{ text, note,
// colour, progress, made }] }], the marks in the book's order.

const percent = (share) => `${Math.round(share * 100)}%`;
const day = (at) => (at ? new Date(at).toISOString() : '');

export const formats = [
    ['md', 'Markdown'],
    ['csv', 'CSV'],
    ['json', 'JSON'],
    ['ris', 'RIS (Zotero, EndNote, Mendeley)'],
];

function markdown(books) {
    return books.map(({ title, author, note, marks }) => [
        `# ${title}${author ? ` — ${author}` : ''}`,
        note,
        ...marks.map((mark) => [
            mark.text.split(/\n+/).map((line) => `> ${line}`).join('\n>\n'),
            mark.note, `*${percent(mark.progress)}*`,
        ].filter(Boolean).join('\n\n')),
    ].filter(Boolean).join('\n\n')).join('\n\n---\n\n') + '\n';
}

/// With the mark Excel wants to read it as UTF-8.
function csv(books) {
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['title', 'author', 'place', 'colour', 'text', 'note', 'made']];
    for (const { title, author, note, marks } of books) {
        if (note) rows.push([title, author, '', '', '', note, '']);
        for (const mark of marks) rows.push([title, author, percent(mark.progress), mark.colour, mark.text, mark.note, day(mark.made)]);
    }
    return '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

function json(books) {
    return JSON.stringify(books.map(({ title, author, note, marks }) => ({
        title, author, note,
        marks: marks.map((mark) => ({ text: mark.text, note: mark.note, colour: mark.colour, progress: Number(mark.progress.toFixed(4)), made: day(mark.made) })),
    })), null, 2) + '\n';
}

/// A record a book, a note a mark: Zotero makes child notes of them. A
/// value is one line.
function ris(books) {
    const line = (tag, value) => `${tag}  - ${String(value).replace(/\s*\n+\s*/g, ' ').trim()}`;
    return books.map(({ title, author, note, marks }) => [
        line('TY', 'BOOK'),
        line('TI', title),
        ...(author || '').split(/\s*[,;&]\s*/).filter(Boolean).map((one) => line('AU', one)),
        ...(note ? [line('N1', note)] : []),
        ...marks.map((mark) => line('N1', `“${mark.text}” (${percent(mark.progress)})${mark.note ? ` — ${mark.note}` : ''}`)),
        'ER  - ',
    ].join('\r\n')).join('\r\n\r\n') + '\r\n';
}

export const write = (format, books) => ({ md: markdown, csv, json, ris })[format](books);
