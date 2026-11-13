// Kindle books into the family's page: MOBI/PRC (the MOBI7 shape), AZW3
// (KF8) and the hybrid files KindleGen writes with both halves.
//
// ReaderCore's `MOBIContainer`, `KF8Reader` and `MOBIConverter`, rule for
// rule: the Palm database and its records, the MOBI header and EXTH, the
// text undone from PalmDOC or HUFF/CDIC (our own code: no dependency, no
// wasm), the INDX tables. A KF8 book is its skeletons with their fragments
// put back into one document, `kindle:embed:` pictures and `kindle:pos:`
// links resolved to the `aid`/`id` there; a MOBI7 book is one stream whose
// NCX and `filepos` links are byte offsets, anchored before it is decoded.
// A hybrid reads as KF8, its MOBI7 half the fallback.
//
// Then as every converter here: the HTML cleaned by `sanitize`, the pictures
// as blob URLs, a link inside the book a jump through the page's handler.

import { page } from './template.js';
import { looksRightToLeft } from './bytes.js';
import { sanitize } from './sanitize.js';
import { links, chaptersFromHeadings } from './text.js';

const PROTECTED = 'This book is protected (DRM) and cannot be opened.';
const UNREADABLE = 'This Kindle book could not be read.';
const EMPTY = 'This Kindle book has no text to show.';

/// A decompression that grows past this is not a book (a bomb).
const MAX_TEXT = 150 * 1024 * 1024;

class KindleError extends Error {}
const unreadable = () => new KindleError(UNREADABLE);

// MARK: - Bytes

const u16 = (b, o) => (o >= 0 && o + 2 <= b.length ? (b[o] << 8) | b[o + 1] : 0);
const u32 = (b, o) => (o >= 0 && o + 4 <= b.length ? ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 : 0);
const ascii = (b, start, end) => String.fromCharCode(...b.subarray(start, end));
const utf8 = new TextDecoder('utf-8');

/// A forward variable-width integer: 7 bits a byte, the high bit on the
/// LAST byte. `{ value, consumed }`, or null past the end.
function varint(b, offset) {
    let value = 0;
    let consumed = 0;
    for (let i = offset; i < b.length && consumed < 10; i++) {
        const c = b[i];
        consumed++;
        value = value * 128 + (c & 0x7F);
        if (c & 0x80) return { value, consumed };
    }
    return null;
}

/// A growing byte buffer, bounded against a bomb.
class Sink {
    constructor(capacity = 4096) {
        this.buf = new Uint8Array(Math.max(64, Math.min(capacity, MAX_TEXT)));
        this.length = 0;
    }

    ensure(extra) {
        const needed = this.length + extra;
        if (needed <= this.buf.length) return;
        if (needed > MAX_TEXT) throw unreadable();
        const grown = new Uint8Array(Math.min(MAX_TEXT, Math.max(needed, this.buf.length * 2)));
        grown.set(this.buf.subarray(0, this.length));
        this.buf = grown;
    }

    append(bytes) {
        this.ensure(bytes.length);
        this.buf.set(bytes, this.length);
        this.length += bytes.length;
    }

    bytes() { return this.buf.subarray(0, this.length); }
}

// MARK: - The Palm database

/// `{ bytes, name, identity, offsets, count, record(i) }`; a record is a
/// view into the file.
function readPDB(bytes) {
    if (bytes.length < 78) throw unreadable();
    let nameEnd = 0;
    while (nameEnd < 32 && bytes[nameEnd] !== 0) nameEnd++;
    const name = utf8.decode(bytes.subarray(0, nameEnd)).replace(/^[\p{Cc}]+|[\p{Cc}]+$/gu, '');
    const count = u16(bytes, 76);
    if (!count) throw unreadable();
    const offsets = [];
    for (let i = 0; i < count; i++) {
        const at = 78 + i * 8;
        if (at + 4 > bytes.length) break;
        const offset = u32(bytes, at);
        // Offsets must climb and stay inside the file; a record list that
        // does neither is not a book.
        if (offset > bytes.length || offset < (offsets.length ? offsets[offsets.length - 1] : 0)) break;
        offsets.push(offset);
    }
    if (!offsets.length) throw unreadable();
    const record = (i) => {
        if (i == null || i < 0 || i >= offsets.length) return null;
        const end = i + 1 < offsets.length ? offsets[i + 1] : bytes.length;
        return bytes.subarray(offsets[i], end);
    };
    const magic = (i) => { const r = record(i); return r && r.length >= 4 ? ascii(r, 0, 4) : null; };
    return { bytes, name, identity: ascii(bytes, 60, 68), count: offsets.length, record, magic };
}

/// A Kindle file by its bytes: a Palm database of type `BOOKMOBI`.
export function isMOBI(bytes) {
    return bytes.length >= 78 && ascii(bytes, 60, 68) === 'BOOKMOBI';
}

// MARK: - The MOBI header

/// Text in the header's own codepage: 1252, else UTF-8.
function decodeIn(bytes, codepage) {
    return new TextDecoder(codepage === 1252 ? 'windows-1252' : 'utf-8').decode(bytes);
}

function readEXTH(r, offset, codepage) {
    const exth = { authors: [], coverOffset: 0, hasCoverOffset: false };
    if (offset + 12 > r.length || ascii(r, offset, offset + 4) !== 'EXTH') return exth;
    const count = u32(r, offset + 8);
    let at = offset + 12;
    for (let n = 0; n < Math.min(count, 4096); n++) {
        if (at + 8 > r.length) break;
        const type = u32(r, at);
        const length = u32(r, at + 4);
        if (length < 8 || at + length > r.length) break;
        const value = r.subarray(at + 8, at + length);
        const text = () => decodeIn(value, codepage).trim();
        switch (type) {
        case 100: { const s = text(); if (s) exth.authors.push(s); break; }
        case 103: exth.description = text(); break;
        case 121: if (value.length >= 4) exth.kf8Boundary = u32(value, 0); break;
        case 201:
            if (value.length >= 4 && u32(value, 0) !== 0xFFFFFFFF) { exth.coverOffset = u32(value, 0); exth.hasCoverOffset = true; }
            break;
        case 503: exth.title = text(); break;
        case 524: exth.language = text(); break;
        // KF8's page progression (KindleUnpack's 527): `rtl` for a book
        // read right to left.
        case 527: exth.direction = text(); break;
        default: break;
        }
        at += length;
    }
    return exth;
}

/// Offsets counted from the start of the header RECORD (record 0 for a
/// MOBI7 book or a pure KF8, the record after the boundary for the KF8 half
/// of a hybrid); record numbers in that half are relative to it, which
/// `absolute` settles.
function readHeader(pdb, index) {
    const r = pdb.record(index);
    if (!r || r.length < 16 + 0x20) throw unreadable();
    if (ascii(r, 16, 20) !== 'MOBI') throw unreadable();
    const headerLength = u32(r, 0x14);
    const codepage = u32(r, 0x1C);
    // A field exists when the header is long enough to hold it.
    const field = (offset) => {
        if (offset + 4 > 16 + headerLength || offset + 4 > r.length) return null;
        const v = u32(r, offset);
        return v === 0xFFFFFFFF ? null : v;
    };
    const titleOffset = u32(r, 0x54);
    const titleLength = u32(r, 0x58);
    const fullName = titleLength > 0 && titleOffset > 0 && titleOffset + titleLength <= r.length
        ? decodeIn(r.subarray(titleOffset, titleOffset + titleLength), codepage).trim() : null;
    const header = {
        recordIndex: index,
        compression: u16(r, 0),
        textLength: u32(r, 4),
        textRecordCount: u16(r, 8),
        encryption: u16(r, 12),
        codepage,
        version: u32(r, 0x24),
        fullName,
        firstResource: field(0x6C),
        huffOffset: field(0x70),
        huffCount: field(0x74) ?? 0,
        fdstIndex: field(0xC0),
        fdstCount: field(0xC4) ?? 0,
        // #365: the trailing-entry flags, present when the header reaches them.
        extraFlags: headerLength >= 0xE4 && r.length >= 0xF4 ? u16(r, 0xF2) : 0,
        ncxIndex: field(0xF4),
        fragIndex: field(0xF8),
        skelIndex: field(0xFC),
        exth: (u32(r, 0x80) & 0x40) ? readEXTH(r, 16 + headerLength, codepage) : { authors: [], coverOffset: 0, hasCoverOffset: false },
    };
    header.isKF8 = header.version >= 8;
    header.absolute = (relative) => (relative == null ? null : index === 0 ? relative : relative + index);
    return header;
}

// MARK: - The text

/// One trailing entry's size: a BACKWARD variable-width integer in the
/// record's last (up to) 4 bytes, the high bit marking its first byte.
function trailingEntrySize(bytes, end) {
    let num = 0;
    for (let i = Math.max(0, end - 4); i < end; i++) {
        const v = bytes[i];
        if (v & 0x80) num = 0;
        num = (num << 7) | (v & 0x7F);
    }
    return num;
}

/// What a record carries after its text under `flags`: each set bit above
/// bit 0 owns one variable-width entry (consumed back to front); bit 0 is
/// the multibyte overlap — (last byte & 3) + 1.
function trailingEntriesSize(bytes, flags) {
    if (!flags || !bytes.length) return 0;
    let num = 0;
    for (let f = flags >> 1; f; f >>= 1) {
        if (f & 1) {
            const end = bytes.length - num;
            if (end <= 0) return num;
            num += trailingEntrySize(bytes, end);
        }
    }
    if (flags & 1) {
        const at = bytes.length - num - 1;
        if (at >= 0) num += (bytes[at] & 0x3) + 1;
    }
    return num;
}

/// PalmDOC's LZ77, into the sink; a back reference reaches into this
/// record's output only.
function palmDOC(bytes, sink) {
    // At most five bytes out for one in (a pair says up to ten).
    sink.ensure(bytes.length * 5 + 16);
    const out = sink.buf;
    const start = sink.length;
    let o = start;
    const count = bytes.length;
    let i = 0;
    while (i < count) {
        const byte = bytes[i++];
        if (byte === 0) {
            out[o++] = 0;
        } else if (byte <= 8) {
            const end = Math.min(i + byte, count);
            while (i < end) out[o++] = bytes[i++];
        } else if (byte <= 0x7F) {
            out[o++] = byte;
        } else if (byte <= 0xBF) {
            if (i >= count) break;
            const combined = (byte << 8) | bytes[i++];
            const distance = (combined >> 3) & 0x7FF;
            const length = (combined & 0x07) + 3;
            if (!distance) continue;
            for (let k = 0; k < length; k++) {
                const from = o - distance;
                if (from >= start) out[o++] = out[from];
            }
        } else {
            out[o++] = 0x20;
            out[o++] = byte ^ 0x80;
        }
    }
    sink.length = o;
}

/// HUFF/CDIC, the dictionary compression KindleGen uses by default —
/// Calibre's `huffcdic.py`. Its 64-bit window is read here as the 32 bits
/// at a bit position; the code bounds are doubles, exact to 2^53.
class HuffCdic {
    constructor(records, failure) {
        const huff = records[0];
        if (!huff || huff.length < 24 || ascii(huff, 0, 4) !== 'HUFF' || u32(huff, 4) !== 0x18) throw failure();
        const off1 = u32(huff, 8);
        const off2 = u32(huff, 12);
        if (off1 + 256 * 4 > huff.length || off2 + 64 * 4 > huff.length) throw failure();
        this.codelen = new Uint8Array(256);
        this.term = new Uint8Array(256);
        this.dictMax = new Float64Array(256);
        for (let i = 0; i < 256; i++) {
            const v = u32(huff, off1 + i * 4);
            const codelen = v & 0x1F;
            if (codelen === 0) throw failure();
            this.codelen[i] = codelen;
            this.term[i] = v & 0x80 ? 1 : 0;
            this.dictMax[i] = ((v >>> 8) + 1) * 2 ** (32 - codelen) - 1;
        }
        this.mincode = new Float64Array(33);
        this.maxcode = new Float64Array(33);
        for (let codelen = 1; codelen <= 32; codelen++) {
            this.mincode[codelen] = u32(huff, off2 + (codelen - 1) * 8) * 2 ** (32 - codelen);
            this.maxcode[codelen] = (u32(huff, off2 + (codelen - 1) * 8 + 4) + 1) * 2 ** (32 - codelen) - 1;
        }
        this.entries = [];
        this.unpacked = [];
        for (const cdic of records.slice(1)) {
            if (cdic.length < 16 || ascii(cdic, 0, 4) !== 'CDIC' || u32(cdic, 4) !== 0x10) throw failure();
            const phrases = u32(cdic, 8);
            const bits = u32(cdic, 12);
            if (bits >= 31) throw failure();
            const n = Math.max(0, Math.min(2 ** bits, phrases - this.entries.length));
            const h = cdic.subarray(0x10);
            for (let i = 0; i < n; i++) {
                const off = u16(h, i * 2);
                const blen = u16(h, off);
                const start = off + 2;
                const end = Math.min(start + (blen & 0x7FFF), h.length);
                if (start > end) throw failure();
                this.entries.push(h.subarray(start, end));
                this.unpacked.push(blen & 0x8000 ? 1 : 0);
            }
        }
        this.depth = 0;
    }

    unpack(data, sink) {
        if (++this.depth >= 64) throw unreadable();
        try {
            // The data and eight zero bytes: a window never reads past it.
            const buf = new Uint8Array(data.length + 8);
            buf.set(data);
            const bits = data.length * 8;
            const { codelen: lengths, term, dictMax, mincode, maxcode, entries, unpacked } = this;
            let at = 0;
            for (;;) {
                const p = at >>> 3;
                const shift = at & 7;
                const word = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
                const code = shift ? ((word << shift) | (buf[p + 4] >>> (8 - shift))) >>> 0 : word;
                const top = code >>> 24;
                let codelen = lengths[top];
                let max = dictMax[top];
                if (!term[top]) {
                    while (codelen <= 32 && code < mincode[codelen]) codelen++;
                    if (codelen > 32) throw unreadable();
                    max = maxcode[codelen];
                }
                at += codelen;
                if (at > bits) break;
                if (max < code) throw unreadable();
                const r = Math.floor((max - code) / 2 ** (32 - codelen));
                if (r >= entries.length || !entries[r]) throw unreadable();
                let slice = entries[r];
                if (!unpacked[r]) {
                    entries[r] = null;
                    const inner = new Sink(slice.length * 4);
                    this.unpack(slice, inner);
                    slice = inner.bytes().slice();
                    entries[r] = slice;
                    unpacked[r] = 1;
                }
                sink.append(slice);
            }
        } finally {
            this.depth--;
        }
    }
}

/// The book's text, decompressed and trimmed to the declared length: the
/// records after the header, trailing entries dropped, PalmDOC or HUFF/CDIC
/// undone.
function decompress(pdb, header, name) {
    const unsupported = () => new KindleError('Unsupported compression in ' + name);
    const first = header.recordIndex + 1;
    const last = Math.min(header.recordIndex + header.textRecordCount, pdb.count - 1);
    if (last < first) throw unreadable();

    let huff = null;
    if (header.compression === 17480) {
        const start = header.absolute(header.huffOffset);
        if (start == null || header.huffCount < 1) throw unsupported();
        const records = [];
        for (let i = start; i < start + header.huffCount; i++) {
            const r = pdb.record(i);
            if (!r) throw unsupported();
            records.push(r);
        }
        huff = new HuffCdic(records, unsupported);
    } else if (header.compression !== 1 && header.compression !== 2) {
        throw unsupported();
    }

    // The declared length is a hint, bounded against a lying header.
    const sink = new Sink(Math.min(header.textLength || 1 << 20, 64 << 20));
    for (let i = first; i <= last; i++) {
        let record = pdb.record(i);
        if (!record || !record.length) continue;
        const trailing = trailingEntriesSize(record, header.extraFlags);
        if (trailing > 0 && trailing < record.length) record = record.subarray(0, record.length - trailing);
        if (header.compression === 1) sink.append(record);
        else if (header.compression === 2) palmDOC(record, sink);
        else huff.unpack(record, sink);
    }
    if (header.textLength > 0 && sink.length > header.textLength) sink.length = header.textLength;
    return sink.bytes();
}

// MARK: - INDX

function readTagx(data, start) {
    if (start + 12 > data.length || ascii(data, start, start + 4) !== 'TAGX') return null;
    const length = u32(data, start + 4);
    const controlByteCount = u32(data, start + 8);
    const table = [];
    for (let i = 12; i + 4 <= length && start + i + 4 <= data.length; i += 4) {
        const p = start + i;
        table.push({ tag: data[p], perEntry: data[p + 1], mask: data[p + 2], end: data[p + 3] });
    }
    return { controlByteCount, table };
}

const bitCount = (n) => { let c = 0; for (; n; n &= n - 1) c++; return c; };

/// Tag → its values, in the order the TAGX table lists them.
function tagMap(controlByteCount, table, data, start) {
    const found = [];
    let controlIndex = 0;
    let at = start + controlByteCount;
    for (const t of table) {
        if (t.end === 0x01) { controlIndex++; continue; }
        if (start + controlIndex >= data.length) break;
        const control = data[start + controlIndex];
        let mask = t.mask;
        let value = control & mask;
        if (!value) continue;
        if (value === mask) {
            if (bitCount(mask) > 1) {
                // Every bit set: a variable-width BYTE count follows the
                // control bytes, then that many bytes of values.
                const v = varint(data, at);
                if (!v) break;
                at += v.consumed;
                found.push({ tag: t.tag, count: null, bytes: v.value, perEntry: t.perEntry });
            } else {
                found.push({ tag: t.tag, count: 1, bytes: null, perEntry: t.perEntry });
            }
        } else {
            while (!(mask & 1)) { mask >>= 1; value >>= 1; }
            found.push({ tag: t.tag, count: value, bytes: null, perEntry: t.perEntry });
        }
    }
    const map = new Map();
    for (const f of found) {
        const values = [];
        if (f.count != null) {
            outer: for (let k = 0; k < f.count; k++) {
                for (let j = 0; j < f.perEntry; j++) {
                    const v = varint(data, at);
                    if (!v) break outer;
                    at += v.consumed;
                    values.push(v.value);
                }
            }
        } else if (f.bytes != null) {
            let consumed = 0;
            while (consumed < f.bytes) {
                const v = varint(data, at);
                if (!v) break;
                at += v.consumed;
                consumed += v.consumed;
                values.push(v.value);
            }
        }
        map.set(f.tag, values);
    }
    return map;
}

/// The index at `record` (the INDX header) and its data records, plus the
/// CTOC strings the entries point into: `{ entries: [{ label, tags }], ctoc }`.
function readIndex(pdb, record) {
    const header = pdb.record(record);
    if (!header || header.length < 56 || ascii(header, 0, 4) !== 'INDX') return null;
    const headerLength = u32(header, 4);
    const count = Math.min(u32(header, 24), pdb.count);
    const nctoc = u32(header, 52);
    const tagx = readTagx(header, headerLength);
    if (!tagx) return null;

    const ctoc = new Map();
    let recordOffset = 0;
    for (let j = 0; j < Math.min(nctoc, 64); j++) {
        const c = pdb.record(record + count + 1 + j);
        if (!c) break;
        let o = 0;
        while (o < c.length) {
            if (c[o] === 0) break;
            const v = varint(c, o);
            if (!v) break;
            const start = o + v.consumed;
            ctoc.set(o + recordOffset, c.subarray(start, Math.min(start + v.value, c.length)));
            o += v.consumed + v.value;
        }
        recordOffset += 0x10000;
    }

    const entries = [];
    for (let i = record + 1; i < record + 1 + count; i++) {
        const data = pdb.record(i);
        if (!data || data.length < 28 || ascii(data, 0, 4) !== 'INDX') continue;
        const idxt = u32(data, 20);
        if (idxt + 4 > data.length) continue;
        const entryCount = Math.min(u32(data, 24), (data.length - idxt - 4) >> 1);
        for (let j = 0; j < entryCount; j++) {
            const startPos = u16(data, idxt + 4 + 2 * j);
            const endPos = j + 1 < entryCount ? u16(data, idxt + 4 + 2 * (j + 1)) : idxt;
            if (startPos >= data.length || !(startPos < endPos || endPos === idxt)) continue;
            const labelLength = data[startPos];
            const labelStart = startPos + 1;
            if (labelStart + labelLength > data.length) continue;
            entries.push({
                label: data.subarray(labelStart, labelStart + labelLength),
                tags: tagMap(tagx.controlByteCount, tagx.table, data, labelStart + labelLength),
            });
        }
    }
    return { entries, ctoc };
}

// MARK: - Pictures

function pictureType(r) {
    if (!r || r.length < 4) return null;
    if (r[0] === 0xFF && r[1] === 0xD8) return 'image/jpeg';
    if (r[0] === 0x89 && r[1] === 0x50 && r[2] === 0x4E && r[3] === 0x47) return 'image/png';
    if (r[0] === 0x47 && r[1] === 0x49 && r[2] === 0x46) return 'image/gif';
    if (r[0] === 0x42 && r[1] === 0x4D) return 'image/bmp';
    return null;
}

/// Every record in `ranges`, in order, is one resource index — pictures and
/// placeholders alike, because `kindle:embed:` and MOBI7's `recindex` both
/// count records, not pictures. A picture becomes a blob URL when the text
/// asks for it.
function resources(pdb, ranges, urls) {
    const records = [];
    for (const [start, end] of ranges) for (let i = start; i < end; i++) records.push(i);
    const made = new Map();
    return {
        url(index) {
            if (made.has(index)) return made.get(index);
            const record = index >= 0 && index < records.length ? pdb.record(records[index]) : null;
            const type = pictureType(record);
            const url = type ? URL.createObjectURL(new Blob([record], { type })) : null;
            if (url) urls.push(url);
            made.set(index, url);
            return url;
        },
    };
}

/// The base-32 KF8 writes into `kindle:embed:XXXX` and
/// `kindle:pos:fid:XXXX:off:YYYYYYYYYY`.
function base32(text) {
    if (!text) return null;
    let v = 0;
    for (const ch of text.toUpperCase()) {
        const d = '0123456789ABCDEFGHIJKLMNOPQRSTUV'.indexOf(ch);
        if (d < 0) return null;
        v = v * 32 + d;
        if (v > 2 ** 40) return null;
    }
    return v;
}

// MARK: - KF8

const partId = (index) => '_kf8_part' + index;

/// Flow 0 is the text; the flows after it are CSS and SVG, which the
/// cleaning drops anyway.
function flowZero(raw, pdb, header) {
    const rec = header.absolute(header.fdstIndex);
    const fd = header.fdstCount > 1 ? pdb.record(rec) : null;
    if (!fd || fd.length < 20 || pdb.magic(rec) !== 'FDST') return raw;
    if (u32(fd, 8) < 1) return raw;
    const start = u32(fd, 12);
    const end = u32(fd, 16);
    if (start >= end || start >= raw.length) return raw;
    return raw.subarray(start, Math.min(end, raw.length));
}

function readSkeletons(pdb, header) {
    const index = header.skelIndex == null ? null : readIndex(pdb, header.absolute(header.skelIndex));
    if (!index) return [];
    return index.entries.flatMap((e) => {
        const count = e.tags.get(1)?.[0];
        const geometry = e.tags.get(6);
        return count != null && geometry?.length >= 2 ? [{ fragmentCount: count, start: geometry[0], length: geometry[1] }] : [];
    });
}

function readFragments(pdb, header) {
    const index = header.fragIndex == null ? null : readIndex(pdb, header.absolute(header.fragIndex));
    if (!index) return [];
    return index.entries.flatMap((e) => {
        const label = utf8.decode(e.label);
        const geometry = e.tags.get(6);
        return /^\d+$/.test(label) && geometry?.length >= 2 ? [{ insertPosition: Number(label), length: geometry[1] }] : [];
    });
}

/// Skeleton by skeleton: the frame, then its fragments inserted one after
/// another at the positions the FRAG index gives — positions in the
/// ASSEMBLED text, so each insertion counts the ones before it. The parts,
/// and where each starts in flow 0 (the coordinate `kindle:pos` and the
/// NCX use).
function assemble(text, skeletons, fragments) {
    if (!skeletons.length || !fragments.length) return { parts: [text], starts: [0] };
    const parts = [];
    const starts = [];
    let next = 0;
    for (const skel of skeletons) {
        if (skel.start + skel.length > text.length) break;
        let base = skel.start + skel.length;
        let skeleton = text.subarray(skel.start, base);
        for (let k = 0; k < skel.fragmentCount; k++) {
            if (next >= fragments.length) break;
            const fragment = fragments[next++];
            if (base + fragment.length > text.length) break;
            const at = Math.min(Math.max(fragment.insertPosition - skel.start, 0), skeleton.length);
            const merged = new Uint8Array(skeleton.length + fragment.length);
            merged.set(skeleton.subarray(0, at));
            merged.set(text.subarray(base, base + fragment.length), at);
            merged.set(skeleton.subarray(at), at + fragment.length);
            skeleton = merged;
            base += fragment.length;
        }
        parts.push(skeleton);
        starts.push(skel.start);
    }
    return parts.length ? { parts, starts } : { parts: [text], starts: [0] };
}

const isSpace = (c) => c === 0x20 || c === 0x0A || c === 0x09 || c === 0x0D;

/// `name="value"` inside one tag's bytes, the name preceded by a blank.
function attribute(tag, name) {
    const needle = [...name].map((c) => c.charCodeAt(0) | 0x20);
    for (let i = 1; i + needle.length + 2 < tag.length; i++) {
        if (!isSpace(tag[i - 1]) || !needle.every((c, k) => (tag[i + k] | 0x20) === c)) continue;
        let j = i + needle.length;
        while (j < tag.length && tag[j] === 0x20) j++;
        if (j >= tag.length || tag[j] !== 0x3D) continue;
        j++;
        while (j < tag.length && tag[j] === 0x20) j++;
        if (j >= tag.length) return null;
        const quote = tag[j];
        if (quote !== 0x22 && quote !== 0x27) continue;
        const start = ++j;
        while (j < tag.length && tag[j] !== quote) j++;
        return utf8.decode(tag.subarray(start, j)) || null;
    }
    return null;
}

const isBodyTag = (tag) => tag.length >= 5
    && (tag[1] | 0x20) === 0x62 && (tag[2] | 0x20) === 0x6F && (tag[3] | 0x20) === 0x64 && (tag[4] | 0x20) === 0x79
    && (tag.length === 6 || [0x20, 0x0A, 0x09, 0x3E].includes(tag[5]));

/// Positions in flow 0 → the element to land on: the nearest tag at or
/// before the position that carries an `id`, a `name` or an `aid`; the
/// part's top when the search reaches `<body>` or finds nothing.
function resolver(parts, starts, fragments) {
    const anchor = (pos) => {
        let pi = 0;
        starts.forEach((start, i) => { if (start <= pos) pi = i; });
        const block = parts[pi];
        let npos = Math.min(Math.max(pos - starts[pi], 0), block.length);
        // Inside a tag (or right at its `<`): include that tag.
        const gt = block.indexOf(0x3E, npos);
        const lt = block.indexOf(0x3C, npos);
        if (gt >= 0 && (lt === npos || lt < 0 || gt < lt)) npos = Math.min(gt + 1, block.length);
        let end = npos;
        for (let hops = 0; hops < 20000 && end > 0; hops++) {
            const close = block.lastIndexOf(0x3E, end - 1);
            const open = close > 0 ? block.lastIndexOf(0x3C, close - 1) : -1;
            if (close < 0 || open < 0) break;
            const tag = block.subarray(open, close + 1);
            if (isBodyTag(tag)) return { part: pi, id: null };
            const id = attribute(tag, 'id') ?? attribute(tag, 'name');
            if (id) return { part: pi, id };
            const aid = attribute(tag, 'aid');
            if (aid) return { part: pi, id: 'kf8_' + aid };
            end = open;
        }
        return { part: pi, id: null };
    };
    return {
        anchor,
        at(fid, offset) {
            if (fid == null || offset == null || fid < 0 || fid >= fragments.length || offset < 0) return null;
            return anchor(fragments[fid].insertPosition + offset);
        },
    };
}

const bodyPattern = /<body\b[^>]*>([\s\S]*?)<\/body>/i;
const headPattern = /<\?xml[^>]*>|<!DOCTYPE[^>]*>|<head\b[^>]*>[\s\S]*?<\/head>|<\/?html\b[^>]*>/gi;
const tagPattern = /<([a-zA-Z][^\s>/]*)((?:\s[^>]*)?)>/g;
const aidPattern = /\s+aid\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const idPattern = /\s(?:id|name)\s*=\s*["']/i;
const svgImagePattern = /<svg\b[^>]*>(?:(?!<\/svg>)[\s\S])*?<image\b[^>]*?(?:xlink:)?href\s*=\s*"(kindle:embed:[^"]*)"(?:(?!<\/svg>)[\s\S])*?<\/svg>/gi;
const imgPattern = /<img\b[^>]*>/gi;
const srcPattern = /\ssrc\s*=\s*"([^"]*)"/i;
const srcsetPattern = /\ssrcset\s*=\s*(?:"[^"]*"|'[^']*')/gi;
const posLinkPattern = /\shref\s*=\s*"kindle:pos:fid:([0-9A-Za-z]+):off:([0-9A-Za-z]+)[^"]*"/gi;
const otherKindleHrefPattern = /\shref\s*=\s*"kindle:[^"]*"/gi;
const mediaPattern = /<(audio|video)\b[^>]*>[\s\S]*?<\/\1>|<(?:audio|video|source|track)\b[^>]*\/?>/gi;
const leftoverKindleAttrPattern = /\s[a-zA-Z:-]+\s*=\s*"kindle:[^"]*"/gi;

/// One part's body, its `aid`s ids, its pictures and links resolved, in a
/// wrapper the contents can name.
function rewritePart(part, index, anchors, pictures) {
    const found = part.match(bodyPattern);
    let html = found ? found[1] : part.replace(headPattern, '');

    // Every KF8 element wears an `aid`; it becomes the id the anchors name,
    // unless the element has an id of its own.
    html = html.replace(tagPattern, (tag) => {
        if (!/aid/i.test(tag)) return tag;
        const aid = tag.match(aidPattern);
        if (!aid) return tag;
        const value = aid[1] ?? aid[2] ?? '';
        const replacement = idPattern.test(tag) || !value ? '' : ` id="kf8_${value}"`;
        return tag.slice(0, aid.index) + replacement + tag.slice(aid.index + aid[0].length);
    });

    // A cover drawn as <svg><image href="kindle:embed:…"/></svg> is a picture.
    html = html.replace(svgImagePattern, (_, embed) => `<img src="${embed}"/>`);
    html = html.replace(imgPattern, (tag) => {
        const src = tag.match(srcPattern);
        if (!src || !src[1].toLowerCase().startsWith('kindle:embed:')) return tag;
        const n = base32(src[1].slice('kindle:embed:'.length).split('?')[0]);
        const url = n != null && n >= 1 ? pictures.url(n - 1) : null;
        if (!url) return '';
        // A srcset of paths that never existed here would beat the src.
        return (tag.slice(0, src.index) + ` src="${url}"` + tag.slice(src.index + src[0].length)).replace(srcsetPattern, '');
    });

    // Links: a fragment and an offset → the element there.
    html = html.replace(posLinkPattern, (_, fid, off) => {
        const a = anchors.at(base32(fid), base32(off));
        return a ? ` href="#${a.id ?? partId(a.part)}"` : '';
    });
    html = html.replace(otherKindleHrefPattern, '');
    // Sound and film have no player here; whatever else still points into
    // the container loses the attribute, not the element.
    html = html.replace(mediaPattern, '');
    html = html.replace(leftoverKindleAttrPattern, '');
    return `<div id="${partId(index)}" class="_cr_part">\n${html}\n</div>`;
}

function readKF8(pdb, header0, kf8Start, name, urls) {
    const h8 = kf8Start === 0 ? header0 : readHeader(pdb, kf8Start);
    if (!h8.isKF8) throw unreadable();
    if (h8.encryption !== 0) throw new KindleError(PROTECTED);

    const text = flowZero(decompress(pdb, h8, name), pdb, h8);
    const skeletons = readSkeletons(pdb, h8);
    const fragments = readFragments(pdb, h8);
    // A header that names the tables and no table to be read: a file cut
    // short, its text frames without their contents (a hybrid still has
    // its MOBI7 half).
    if ((h8.skelIndex != null && !skeletons.length) || (h8.fragIndex != null && !fragments.length)) throw unreadable();
    const { parts, starts } = assemble(text, skeletons, fragments);

    // Pictures: the resource records of the MOBI7 half up to the boundary,
    // then whatever the KF8 half adds after its own text — KindleUnpack's
    // list, which `kindle:embed:` indexes 1-based.
    const ranges = [];
    if (kf8Start > 0) {
        const first0 = header0.firstResource;
        if (first0 > 0 && first0 < kf8Start) ranges.push([first0, kf8Start]);
        const first8 = h8.absolute(h8.firstResource);
        if (first8 != null && first8 < pdb.count && first8 > kf8Start) ranges.push([first8, pdb.count]);
    } else if (h8.firstResource > 0 && h8.firstResource < pdb.count) {
        ranges.push([h8.firstResource, pdb.count]);
    }
    const pictures = resources(pdb, ranges, urls);
    const anchors = resolver(parts, starts, fragments);

    const body = parts.map((part, i) => rewritePart(decodeIn(part, h8.codepage), i, anchors, pictures)).join('\n');

    const ncx = h8.ncxIndex == null ? null : readIndex(pdb, h8.absolute(h8.ncxIndex));
    const chapters = [];
    for (const e of ncx?.entries || []) {
        const position = e.tags.get(6);
        const label = ncx.ctoc.get(e.tags.get(3)?.[0]);
        if (!position || position.length < 2 || !label) continue;
        const title = cleanTitle(decodeIn(label, h8.codepage));
        const a = title && anchors.at(position[0], position[1]);
        if (a) chapters.push({ title, id: a.id ?? partId(a.part), part: partId(a.part) });
    }

    const exth = h8.exth;
    const cover = exth.hasCoverOffset ? exth.coverOffset : header0.exth.hasCoverOffset ? header0.exth.coverOffset : null;
    return {
        body,
        chapters,
        headingsWhenNone: true,
        title: exth.title || header0.exth.title || h8.fullName || header0.fullName,
        authors: exth.authors.length ? exth.authors : header0.exth.authors,
        language: exth.language || header0.exth.language,
        direction: exth.direction || header0.exth.direction,
        cover: cover == null ? null : pictures.url(cover),
    };
}

// MARK: - MOBI7

/// Every `filepos=NNNNNNNNNN` the text points at.
function fileposTargets(text) {
    const needle = [0x66, 0x69, 0x6C, 0x65, 0x70, 0x6F, 0x73, 0x3D]; // filepos=
    const out = new Set();
    const n = text.length;
    let i = 0;
    while (i + needle.length < n) {
        let k = 0;
        if (text[i] === 0x66) while (k < needle.length && text[i + k] === needle[k]) k++;
        if (k !== needle.length) { i++; continue; }
        let j = i + needle.length;
        if (j < n && (text[j] === 0x22 || text[j] === 0x27)) j++;
        let value = 0;
        let digits = 0;
        while (j < n && text[j] >= 0x30 && text[j] <= 0x39 && digits < 12) {
            value = value * 10 + text[j] - 0x30;
            j++;
            digits++;
        }
        if (digits > 0 && value <= n) out.add(value);
        i = j;
    }
    return out;
}

/// `<a id="_cr_posN"></a>` at every position — nudged past the tag when the
/// position falls inside one — in a single pass.
function insertAnchors(text, positions) {
    const landing = [];
    for (const pos of positions) {
        let at = Math.min(Math.max(pos, 0), text.length);
        // Inside a tag when the nearest bracket behind is an opening one.
        let inside = false;
        for (let k = at - 1; k >= 0; k--) {
            if (text[k] === 0x3E) break;
            if (text[k] === 0x3C) { inside = true; break; }
        }
        if (inside) {
            let j = at;
            while (j < text.length && text[j] !== 0x3E) j++;
            at = Math.min(j + 1, text.length);
        }
        landing.push({ at, pos });
    }
    landing.sort((a, b) => a.at - b.at || a.pos - b.pos);
    const encoder = new TextEncoder();
    const sink = new Sink(text.length + landing.length * 24);
    let last = 0;
    for (const l of landing) {
        if (l.at > last) sink.append(text.subarray(last, l.at));
        sink.append(encoder.encode(`<a id="_cr_pos${l.pos}"></a>`));
        last = Math.max(last, l.at);
    }
    if (last < text.length) sink.append(text.subarray(last));
    return sink.bytes();
}

/// Text encoded to UTF-8 twice (each byte of the first encoding encoded
/// again), told by its signature and undone at the byte level.
function undoDoubleUTF8(bytes) {
    const limit = Math.min(bytes.length, 4000);
    let signatures = 0;
    for (let i = 0; i + 3 < limit;) {
        if (bytes[i] === 0xC3 && bytes[i + 1] >= 0x80 && bytes[i + 1] <= 0x9F && bytes[i + 2] === 0xC2 && bytes[i + 3] >= 0x80 && bytes[i + 3] <= 0xBF) {
            signatures++;
            i += 4;
        } else {
            i++;
        }
    }
    if (signatures <= 5) return bytes;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return bytes; }
    const encoder = new TextEncoder();
    const sink = new Sink(bytes.length);
    for (const ch of text) {
        const v = ch.codePointAt(0);
        if (v <= 0xFF) { sink.ensure(1); sink.buf[sink.length++] = v; } else sink.append(encoder.encode(ch));
    }
    const out = sink.bytes();
    try { new TextDecoder('utf-8', { fatal: true }).decode(out); return out; } catch { return bytes; }
}

/// 1252 as declared; else UTF-8, and a stream that is mostly replacement
/// characters was never UTF-8 — the Russian libraries' Windows-1251.
function decodeBook(text, codepage) {
    if (codepage === 1252) return new TextDecoder('windows-1252').decode(text);
    const html = utf8.decode(text);
    const sample = html.slice(0, 2000);
    const replacements = sample.split('\uFFFD').length - 1;
    return replacements > sample.length / 4 ? new TextDecoder('windows-1251').decode(text) : html;
}

const imgTagPattern = /<img\b[^>]*>/gi;
const recindexPattern = /\s(?:hi|lo|low)?recindex\s*=\s*["']?0*(\d+)["']?/gi;
const fileposPattern = /\bfilepos\s*=\s*["']?0*(\d+)["']?/gi;
const kindleWrapperPattern = /<\?xml[^>]*>|<!DOCTYPE[^>]*>|<head\b[^>]*>[\s\S]*?<\/head>|<guide\b[^>]*>[\s\S]*?<\/guide>|<\/?html\b[^>]*>|<\/?body\b[^>]*>|<\/br\s*>|<\/img\s*>|<mbp:pagebreak\b[^>]*>|<\/mbp:pagebreak\s*>/gi;

function readMOBI7(pdb, header, name, urls) {
    let text = decompress(pdb, header, name);

    // Chapters from the NCX, internal links from `filepos` — both are byte
    // offsets into the text, so the anchors go in before it is decoded.
    const chapters = [];
    const positions = new Set();
    const ncx = header.ncxIndex == null ? null : readIndex(pdb, header.absolute(header.ncxIndex));
    for (const e of ncx?.entries || []) {
        const pos = e.tags.get(1)?.[0];
        const label = ncx.ctoc.get(e.tags.get(3)?.[0]);
        if (pos == null || pos > text.length || !label) continue;
        const title = cleanTitle(decodeIn(label, header.codepage));
        if (!title) continue;
        chapters.push({ title, id: '_cr_pos' + pos });
        positions.add(pos);
    }
    for (const pos of fileposTargets(text)) positions.add(pos);
    if (positions.size) text = insertAnchors(text, positions);

    let html = decodeBook(undoDoubleUTF8(text), header.codepage);

    // Pictures: every record from the first resource on counts as one
    // index, which is what `recindex` names — from 1, as `kindle:embed:`.
    const first = header.firstResource;
    const end = header.exth.kf8Boundary != null ? Math.min(header.exth.kf8Boundary, pdb.count) : pdb.count;
    const pictures = resources(pdb, first > 0 && first < pdb.count && end > first ? [[first, end]] : [], urls);
    html = html.replace(imgTagPattern, (tag) => {
        const refs = [...tag.matchAll(recindexPattern)];
        if (!refs.length) return tag;
        const primary = refs.find((m) => !/hirecindex|lowrecindex|lorecindex/i.test(m[0])) || refs[0];
        const url = pictures.url(Number(primary[1]) - 1);
        // A picture that is not there takes its tag with it.
        if (!url) return '';
        let rebuilt = tag;
        for (const m of refs.reverse()) rebuilt = rebuilt.slice(0, m.index) + (m === primary ? ` src="${url}"` : '') + rebuilt.slice(m.index + m[0].length);
        return rebuilt;
    });
    // KF8-style embeds have no home in the MOBI7 half.
    html = html.replace(/kindle:embed:[0-9A-Za-z]+(?:\?[^"']*)?/g, '');
    html = html.replace(fileposPattern, (_, digits) => `href="#_cr_pos${Number(digits)}"`);
    // The Kindle document's own wrapper, `<guide>` and page-break marks
    // go, and the closing tags KindleGen writes for void elements — a
    // parser reads `</br>` as a second `<br>`.
    html = html.replace(kindleWrapperPattern, '');

    return {
        body: html,
        chapters,
        title: header.exth.title || header.fullName,
        authors: header.exth.authors,
        language: header.exth.language,
        direction: header.exth.direction,
        cover: header.exth.hasCoverOffset ? pictures.url(header.exth.coverOffset) : null,
    };
}

// MARK: - The page

const formattingTags = new Set(['b', 'i', 'em', 'strong', 'u', 's', 'strike', 'big', 'small', 'sub', 'sup']);
const blockTags = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol', 'td', 'th', 'tr', 'table', 'section', 'article', 'body', 'html']);

/// ReaderCore's `balanceInlineFormatting` (#364): a corrupted stream that
/// lost a `</b>` would bold the rest of the book — the parser carries open
/// formatting across paragraphs — so whatever is still open closes at a
/// block's edge; a stray close with no opener goes.
function balanceInlineFormatting(html) {
    const out = [];
    const open = [];
    let cursor = 0;
    for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
        out.push(html.slice(cursor, m.index));
        cursor = m.index + m[0].length;
        const name = m[2].toLowerCase();
        if (formattingTags.has(name)) {
            if (m[1]) {
                const at = open.lastIndexOf(name);
                if (at >= 0) { open.splice(at, 1); out.push(m[0]); }
            } else {
                open.push(name);
                out.push(m[0]);
            }
        } else if (blockTags.has(name)) {
            for (let k = open.length - 1; k >= 0; k--) out.push(`</${open[k]}>`);
            open.length = 0;
            out.push(m[0]);
        } else {
            out.push(m[0]);
        }
    }
    out.push(html.slice(cursor));
    for (let k = open.length - 1; k >= 0; k--) out.push(`</${open[k]}>`);
    return out.join('');
}

/// A label of the NCX: text, its tags dropped and its entities read (a
/// no-break space stays one).
let scratch = null;
function cleanTitle(label) {
    scratch ??= document.implementation.createHTMLDocument('').createElement('textarea');
    scratch.innerHTML = label.replace(/<[^>]+>/g, '');
    return scratch.value.replace(/[ \t\n\r\f\v]+/g, ' ').trim();
}

const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

/// A Kindle file into `{ title, author, language, rightToLeft, chapters,
/// html, urls }` — `urls` the blob URLs made for the pictures, to revoke
/// when the book is closed.
export function convertMOBI(bytes, name = '') {
    const urls = [];
    try {
        return convert(bytes, name, urls);
    } catch (error) {
        for (const url of urls) URL.revokeObjectURL(url);
        // Our own words pass; anything else thrown on the way (a book cut
        // short, a table that lies) is a file that cannot be read.
        throw error instanceof KindleError ? new Error(error.message) : new Error(UNREADABLE);
    }
}

function convert(bytes, name, urls) {
    const pdb = readPDB(bytes);
    const header = readHeader(pdb, 0);
    if (header.encryption !== 0) throw new KindleError(PROTECTED);

    // EXTH 121 names the KF8 header's record in a hybrid; a pure KF8 (an
    // AZW3) has it in record 0 and no boundary.
    const kf8Start = header.exth.kf8Boundary ?? (header.isKF8 ? 0 : null);
    let book = null;
    if (kf8Start != null && kf8Start < pdb.count) {
        try {
            book = readKF8(pdb, header, kf8Start, name, urls);
        } catch (error) {
            // A hybrid still has its MOBI7 half; a pure KF8 has nothing else.
            if (kf8Start === 0) throw error;
            for (const url of urls.splice(0)) URL.revokeObjectURL(url);
        }
    }
    book ??= readMOBI7(pdb, header, name, urls);

    const title = book.title || pdb.name || stem(name) || 'Untitled';
    const author = book.authors.join(', ');
    const language = (book.language || '').split(/[-_]/)[0].toLowerCase();

    const holder = document.implementation.createHTMLDocument('');
    const root = holder.createElement('div');
    root.innerHTML = balanceInlineFormatting(book.body.replace(/<\/?\uFFFD[^>]*>/g, ''));
    sanitize(root);
    // A picture that came to nothing — a KF8 cover drawn as an SVG flow, a
    // path that never existed here — goes, as an EPUB's does.
    for (const img of root.querySelectorAll('img')) {
        if (!/^(blob:|data:image\/)/i.test((img.getAttribute('src') || '').trim())) img.remove();
    }
    if (!root.textContent.trim() && !root.querySelector('img')) throw new KindleError(EMPTY);

    // An anchor by its old `name` alone is a place too: the resolver lands
    // on it, and the page finds places by id.
    const ids = new Set([...root.querySelectorAll('[id]')].map((node) => node.id));
    for (const node of root.querySelectorAll('a[name]:not([id])')) {
        const id = node.getAttribute('name');
        if (id && !ids.has(id)) { node.id = id; ids.add(id); }
    }

    // The contents land on an element that exists: the part's top where
    // the one named went with the cleaning.
    let chapters = book.chapters
        .map((chapter) => ({ title: chapter.title, id: ids.has(chapter.id) ? chapter.id : chapter.part }))
        .filter((chapter) => chapter.id && ids.has(chapter.id));
    if (!chapters.length && book.headingsWhenNone) chapters = chaptersFromHeadings(root);

    // The cover first, when the text does not show it: this reader has no
    // shelf to show it on.
    if (book.cover && !root.querySelector(`img[src="${book.cover}"]`)) {
        const box = holder.createElement('div');
        box.className = 'book-image';
        const img = holder.createElement('img');
        img.setAttribute('src', book.cover);
        img.setAttribute('alt', '');
        box.appendChild(img);
        root.prepend(box);
    }
    // The URLs the text never asked for are let go at once.
    const used = new Set([...root.querySelectorAll('img[src^="blob:"]')].map((img) => img.getAttribute('src')));
    for (const url of urls.filter((url) => !used.has(url))) URL.revokeObjectURL(url);
    const kept = urls.filter((url) => used.has(url));

    links(root);

    // The book's word (EXTH 527), else the letters' (the family's `TextDirection`).
    const declared = (book.direction || '').toLowerCase();
    const rightToLeft = declared === 'rtl' || (declared !== 'ltr' && looksRightToLeft(root.textContent.slice(0, 20000)));
    return { title, author, language, rightToLeft, chapters, html: page(root.innerHTML, title, language), urls: kept, cover: book.cover && used.has(book.cover) ? book.cover : null };
}
