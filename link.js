// A book from a link: the page downloads the file when the site lets it,
// and the file goes the usual way. A browser lets a page read another
// site's file only when that site says so (CORS: `Access-Control-Allow-
// Origin`). Standard Ebooks, GitHub's raw files and many OPDS mirrors do;
// Project Gutenberg, the shops and the file hosts do not, and then the
// fetch fails before a byte arrives — the reader is told to download the
// book and open the file. There is no server in between: the link goes
// from this page to the site and nowhere else.

const LIMIT = 200 * 1024 * 1024;
const bookName = /\.(epub|fb2|pdf|cbz|zip|mobi|azw3?|prc|md|markdown|txt|x?html?)$/i;

/// The http(s) link in a pasted or dropped text, or null: the first line
/// that is not a comment (a uri-list), its first word.
export function linkIn(text) {
    const line = (text || '').split(/\r?\n/).map((part) => part.trim()).find((part) => part && !part.startsWith('#')) || '';
    try {
        const url = new URL(line.split(/\s+/)[0]);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

/// The file behind `url`, as a File named by the site or the address.
/// `progress(received, total)` as it comes; `total` is 0 when the site
/// does not say.
export async function download(url, progress = () => {}) {
    const address = new URL(url);
    // A secure page cannot read an http:// link: its https:// is asked.
    if (address.protocol === 'http:' && location.protocol === 'https:') address.protocol = 'https:';
    let answer;
    try {
        answer = await fetch(address.href, { mode: 'cors', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' });
    } catch {
        throw new Error(navigator.onLine === false ? 'No connection.' : 'This site does not let other pages download its files. Download the book, then open the file.');
    }
    if (!answer.ok) throw new Error(`The link answered with an error (${answer.status}).`);
    const type = (answer.headers.get('Content-Type') || '').toLowerCase();
    const name = nameOf(answer, address);
    if (type.startsWith('text/html') && !bookName.test(name)) throw new Error('This link leads to a web page, not a book.');
    const total = Number(answer.headers.get('Content-Length')) || 0;
    if (total > LIMIT) throw new Error('The file is too large to download here.');
    const reader = answer.body?.getReader?.();
    if (!reader) return new File([await answer.blob()], name, { type });
    const parts = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        received += value.length;
        if (received > LIMIT) {
            reader.cancel().catch(() => {});
            throw new Error('The file is too large to download here.');
        }
        progress(received, total);
    }
    return new File(parts, name, { type });
}

/// The site's name for the file (`Content-Disposition`, when it lets the
/// page see it), else the address's last part — after the redirects.
function nameOf(answer, address) {
    const disposition = answer.headers.get('Content-Disposition') || '';
    const encoded = /filename\*\s*=\s*[\w-]+''([^;]+)/i.exec(disposition);
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
    let name = '';
    try {
        name = encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] : '';
        if (!name) name = decodeURIComponent(new URL(answer.url || address.href).pathname.split('/').filter(Boolean).pop() || '');
    } catch {
        name = '';
    }
    return name.trim() || 'book';
}
