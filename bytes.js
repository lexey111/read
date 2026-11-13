// Bytes into text, and what the text's letters say.

/// A document's text in its own encoding: a byte order mark, then what it
/// declares, then UTF-8.
export function decode(bytes) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    const declared = (head.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i) || head.match(/<meta[^>]*charset\s*=\s*["']?([\w-]+)/i) || [])[1];
    if (declared && !/^utf-?8$/i.test(declared)) {
        try {
            return new TextDecoder(declared).decode(bytes).replace(/(<\?xml[^>]*encoding\s*=\s*["'])[^"']+/i, '$1UTF-8');
        } catch { /* a name the browser does not know: UTF-8 below */ }
    }
    // Nothing declared: UTF-8 if it reads as such, else the old Cyrillic
    // page most such books were typed in.
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder('windows-1251').decode(bytes);
    }
}

/// Hebrew and Arabic letters outnumber the rest, two hundred at the least.
export function looksRightToLeft(text) {
    let rtl = 0, other = 0;
    for (const letter of text.slice(0, 20000)) {
        const code = letter.codePointAt(0);
        if ((code >= 0x0590 && code <= 0x08FF) || (code >= 0xFB1D && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF)) rtl++;
        else if (/\p{L}/u.test(letter)) other++;
    }
    return rtl >= 200 && rtl > other;
}
