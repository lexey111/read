// A zip of pictures — CBZ, or a plain zip of pages — into the family's book
// of pictures (ReaderCore's `PagesConverter`): a `<div class="_cr_page">`
// per page with its picture's size on it, the reader's script lays them
// out. ComicInfo.xml says the title and the direction.

import { pagesPage } from './template.js';

const pictureTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
const extension = (name) => name.split('.').pop().toLowerCase();

/// macOS's resource forks, hidden files.
const isJunk = (path) => path.includes('__MACOSX') || path.split('/').some((part) => part.startsWith('.'));
export const isPicture = (path) => !isJunk(path) && !!pictureTypes[extension(path)];

/// Pictures and nothing to read: a book of pictures.
export function looksLikePictureBook(names) {
    const files = names.filter((name) => !name.endsWith('/') && !isJunk(name));
    const pictures = files.filter(isPicture).length;
    const text = files.filter((name) => /\.(x?html?|fb2|txt|md|epub|pdf)$/i.test(name)).length;
    return pictures >= 2 && text === 0;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/// The names' order with numbers as numbers — but a picture at the root
/// before any in a folder: a packer leaves each chapter's credits page in
/// a folder of its own.
const readingOrder = (a, b) => (a.split('/').length - b.split('/').length) || collator.compare(a, b);

/// A picture's size from its header alone, nothing decoded; null where the
/// header says nothing this reads.
function headerSize(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length > 24 && view.getUint32(0) === 0x89504E47) return [view.getUint32(16), view.getUint32(20)];
    if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return [view.getUint16(6, true), view.getUint16(8, true)];
    if (bytes.length > 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
        const chunk = String.fromCharCode(...bytes.subarray(12, 16));
        if (chunk === 'VP8 ') return [view.getUint16(26, true) & 0x3FFF, view.getUint16(28, true) & 0x3FFF];
        if (chunk === 'VP8L') { const b = view.getUint32(21, true); return [(b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1]; }
        if (chunk === 'VP8X') return [1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16), 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16)];
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        for (let at = 2; at + 9 < bytes.length;) {
            if (bytes[at] !== 0xFF) { at++; continue; }
            const marker = bytes[at + 1];
            if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return [view.getUint16(at + 7), view.getUint16(at + 5)];
            if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { at += 2; continue; }
            at += 2 + view.getUint16(at + 2);
        }
    }
    return null;
}

async function sizeOf(bytes, type) {
    const size = headerSize(bytes);
    if (size && size[0] > 0 && size[1] > 0) return size;
    try {
        const bitmap = await createImageBitmap(new Blob([bytes], { type }));
        const result = [bitmap.width, bitmap.height];
        bitmap.close();
        return result;
    } catch {
        return null;
    }
}

/// A page drawn in ink: the family's `ImageProcessor.analyze` — on a 64×64
/// copy, the visible pixels' mean saturation near zero and saturated ones
/// rare. Such a page is tagged `.mono.` and the reader's script turns its
/// white transparent and its black into the theme's ink.
async function isInk(blob) {
    try {
        const side = 64;
        const bitmap = await createImageBitmap(blob, { resizeWidth: side, resizeHeight: side, resizeQuality: 'medium' });
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = side;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0, side, side);
        bitmap.close();
        const pixels = context.getImageData(0, 0, side, side).data;
        let sum = 0, saturated = 0, counted = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 10) continue;
            counted++;
            const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            if (max <= 8) continue;
            const saturation = (max - Math.min(pixels[i], pixels[i + 1], pixels[i + 2])) / max;
            sum += saturation;
            if (saturation > 0.2) saturated++;
        }
        return counted > 0 && sum / counted < 0.08 && saturated / counted < 0.02;
    } catch {
        return false;
    }
}

function comicInfo(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return {};
    const read = (name) => doc.getElementsByTagName(name)[0]?.textContent.trim() || '';
    const authors = [];
    for (const role of ['Writer', 'Penciller', 'Inker']) {
        for (const person of read(role).split(',').map((part) => part.trim())) if (person && !authors.includes(person)) authors.push(person);
    }
    return { title: read('Title'), series: read('Series'), number: read('Number'), authors, language: read('LanguageISO').toLowerCase(), manga: read('Manga').toLowerCase() };
}

/// "Vinland_Saga_v01 (digital)" → "Vinland Saga v01".
const nameFromFile = (name) => name.replace(/\.[^.]+$/, '').replace(/\.(cbz|zip)$/i, '').replace(/[_]+/g, ' ').replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim() || 'Pictures';

export async function convertPages(entries, name) {
    const names = [...entries.keys()].filter(isPicture).sort(readingOrder);
    if (!names.length) throw new Error('No pictures in this archive.');
    const infoName = [...entries.keys()].find((entry) => /(^|\/)comicinfo\.xml$/i.test(entry));
    const info = infoName ? comicInfo(new TextDecoder().decode(await entries.get(infoName)())) : {};

    // Read four at a time: the ink test decodes each page once.
    const read = async (path) => {
        const bytes = await entries.get(path)();
        const type = pictureTypes[extension(path)];
        const size = await sizeOf(bytes, type);
        if (!size) return null;
        const blob = new Blob([bytes], { type });
        return { blob, size, ink: await isInk(blob), ext: extension(path) };
    };
    const found = [];
    for (let start = 0; start < names.length; start += 4) found.push(...await Promise.all(names.slice(start, start + 4).map(read)));

    const urls = [];
    const holder = document.implementation.createHTMLDocument('');
    const body = holder.createElement('div');
    const aspects = [];
    for (const picture of found) {
        if (!picture) continue;
        const { blob, size } = picture;
        // The tag rides the URL's fragment: a blob URL is read without it,
        // and the reader's script finds `.mono.` in the src as it does in
        // a file's name.
        const url = URL.createObjectURL(blob);
        urls.push(url);
        aspects.push(size[1] / Math.max(1, size[0]));
        const slot = holder.createElement('div');
        slot.className = '_cr_page';
        slot.id = '_cr_p' + aspects.length;
        const img = holder.createElement('img');
        img.src = `${url}#p${aspects.length}${picture.ink ? '.mono' : ''}.${picture.ext}`;
        img.width = size[0];
        img.height = size[1];
        img.alt = '';
        img.setAttribute('loading', 'lazy');
        slot.appendChild(img);
        body.appendChild(slot);
    }
    if (!aspects.length) throw new Error('No picture in this archive could be read.');

    // A webtoon is told by its pages: strips several times taller than
    // wide, most of them. Read by scrolling, never in spreads.
    const median = [...aspects].sort((a, b) => a - b)[Math.floor(aspects.length / 2)];
    const strip = aspects.length >= 2 && median > 2.2;
    const rightToLeft = info.manga ? info.manga.startsWith('yes') : info.language === 'ja';
    const title = info.title || (info.series ? `${info.series}${info.number ? ' ' + info.number : ''}` : nameFromFile(name));
    return {
        title, author: (info.authors || []).join(', '), language: info.language || '',
        rightToLeft, chapters: [], urls,
        pages: { rtl: rightToLeft, strip, firstAlone: true },
        html: pagesPage(body.innerHTML, title),
    };
}
