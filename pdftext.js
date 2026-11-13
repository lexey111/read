// The text of a PDF read as a flow — ReaderCore's `PDFTextLayout` (#995,
// #1000), rule for rule, on what pdf.js hands over instead of PDFKit: the
// text items with their positions and type sizes are gathered into lines,
// then read into paragraphs and headings the way Calibre reads them —
// running headers and footers dropped, hyphens joined, two columns told
// apart, a paragraph carried across a column and a page, footnotes after
// their page, verse kept as lines. Pure: pdf.js in, blocks out.

export const defaults = {
    /// The bands, as a share of the page's height, where a line may be a
    /// running header or footer: one that repeats at the same height on
    /// page after page, or a bare number.
    headerZone: 0.2,
    footerZone: 0.2,
    dropRunningLines: true,
    joinHyphens: true,
    /// A gap above this many line pitches starts a paragraph.
    paragraphGap: 1.35,
    /// A type size this many times the body's is a heading.
    headingRatio: 1.18,
    /// 'auto', 'one', 'two'.
    columns: 'auto',
};

const half = (value) => Math.round(value * 2) / 2;
const isDigit = (ch) => /\p{N}/u.test(ch);
const isUpper = (ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();
const isLower = (ch) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();
const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

/// Enough of a text layer to read as text: most pages carry text, and a
/// text page carries more than a caption (`Stats.hasTextLayer`).
export const hasTextLayer = (stats) =>
    stats.pages > 0 && stats.pagesWithText * 10 >= stats.pages * 7 && stats.pagesWithText > 0 && stats.characters / stats.pagesWithText >= 200;

/// Text or pages, from a sample: up to `sample` pages spread over the book,
/// their characters counted and scaled to the whole (`quickAnalysis`).
export async function sampleText(doc, sample = 32) {
    const count = doc.numPages;
    const step = Math.max(1, Math.floor(count / sample));
    let looked = 0, withText = 0, characters = 0;
    for (let n = 1; n <= count; n += step) {
        const content = await (await doc.getPage(n)).getTextContent();
        const chars = content.items.reduce((sum, item) => sum + (item.str || '').replace(/\s/g, '').length, 0);
        looked++;
        if (chars > 0) { withText++; characters += chars; }
    }
    return {
        pages: count,
        pagesWithText: looked ? Math.round((withText / looked) * count) : 0,
        characters: looked ? Math.round((characters / looked) * count) : 0,
    };
}

// MARK: - Lines

/// A page's lines from pdf.js's text items: the items in the order the
/// page draws them, a new line where the baseline moves, the pen goes back
/// left, or jumps right further than a word's gap — a column's gutter is
/// two ems or so, and the columns are told apart by the lines' edges, so a
/// line is cut there and put together again within its column (`rejoin`).
/// Text set at an angle — a watermark, an axis's label — is not the book's.
async function linesOf(proxy, number) {
    const content = await proxy.getTextContent();
    const out = [];
    let parts = [], ended = false;

    function finish() {
        if (!parts.length) return;
        let text = '', end = null;
        for (const part of parts) {
            if (end != null && text && !/\s$/.test(text) && !/^\s/.test(part.str) && part.x - end > part.size * 0.15) text += ' ';
            text += part.str;
            end = part.x + part.width;
        }
        text = text.replace(/￼/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
        if (text) {
            // The size most of the line's characters are set in — a drop
            // cap or a superscript does not name the line — and the largest.
            const weight = new Map();
            let largest = 0;
            for (const part of parts) {
                const chars = part.str.replace(/\s/g, '').length;
                if (!chars) continue;
                const size = half(part.size);
                weight.set(size, (weight.get(size) || 0) + chars);
                largest = Math.max(largest, size);
            }
            const size = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] || half(parts[0].size);
            const base = (parts.find((part) => half(part.size) === size) || parts[0]).y;
            const minX = Math.min(...parts.map((part) => part.x));
            const maxX = Math.max(...parts.map((part) => part.x + part.width));
            out.push({
                index: out.length, text, page: number, size, maxSize: Math.max(size, largest),
                rect: rect(minX, base - size * 0.22, maxX, base + size * 0.78),
                full: false, column: 0, columnLeft: 0, columnRight: 0, note: false, breakBefore: false,
            });
        }
        parts = [];
    }

    for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const [a, b, c, d, x, y] = item.transform;
        const size = Math.hypot(c, d);
        const upright = a > 0 && d > 0 && Math.abs(b) <= Math.abs(a) * 0.01 && Math.abs(c) <= Math.abs(d) * 0.01;
        if (!upright || !size) {
            if (item.hasEOL) ended = true;
            continue;
        }
        if (!item.str.trim()) {
            if (parts.length) parts.push({ str: ' ', x, y, width: item.width, size });
            if (item.hasEOL) ended = true;
            continue;
        }
        if (parts.length) {
            const first = parts[0], last = parts[parts.length - 1];
            const lineSize = Math.max(first.size, size);
            const right = Math.max(...parts.map((part) => part.x + part.width));
            // A bold faked by drawing the words twice, a hair apart.
            if (last.str === item.str && Math.abs(last.x - x) < size * 0.2 && Math.abs(last.y - y) < size * 0.2) continue;
            if (ended || Math.abs(y - first.y) > lineSize * 0.5 || x < right - lineSize * 0.5 || x - right > lineSize * 1.5) finish();
        }
        ended = false;
        parts.push({ str: item.str, x, y, width: item.width, size });
        if (item.hasEOL) ended = true;
    }
    finish();
    return joinDropCaps(out);
}

const rect = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, midX: (minX + maxX) / 2 });

/// A drop cap is drawn on its own, low and large: it goes back to the line
/// it begins, the topmost beside it, as the line's first letter.
function joinDropCaps(lines) {
    const gone = new Set();
    for (const cap of lines) {
        if (cap.text.length > 2 || !/^\p{L}+$/u.test(cap.text)) continue;
        let into = null;
        for (const line of lines) {
            if (line === cap || gone.has(line.index) || line.size * 1.8 > cap.size) continue;
            const beside = line.rect.minX >= cap.rect.maxX - cap.size * 0.3 && line.rect.minX - cap.rect.maxX < line.size * 3;
            const within = line.rect.maxY <= cap.rect.maxY + line.size && line.rect.minY >= cap.rect.minY - line.size;
            if (beside && within && (!into || line.rect.maxY > into.rect.maxY)) into = line;
        }
        if (!into) continue;
        into.text = cap.text + into.text;
        into.maxSize = Math.max(into.maxSize, cap.size);
        into.rect = rect(cap.rect.minX, into.rect.minY, into.rect.maxX, into.rect.maxY);
        gone.add(cap.index);
    }
    return lines.filter((line) => !gone.has(line.index)).map((line, index) => ({ ...line, index }));
}

/// The body's type size: the one most characters are set in.
function bodySize(pages) {
    const weight = new Map();
    for (const page of pages) for (const line of page.lines) weight.set(line.size, (weight.get(line.size) || 0) + line.text.length);
    return [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
}

// MARK: - Running headers and footers

function dropRunningLines(pages, sample, options) {
    if (sample.length < 2) {
        for (const page of pages) page.lines = page.lines.filter((line) => !(inBand(line, page, options) && isNumber(line.text)));
        return;
    }
    // The same words at the same height, page after page: the key is the
    // text with its digits folded and the line's height in 4 pt.
    const key = (line) => normalized(line.text) + '@' + Math.trunc(line.rect.minY / 4);
    const seen = new Map();
    for (const page of sample) {
        for (const line of page.lines) {
            if (!inBand(line, page, options)) continue;
            const k = key(line);
            if (!seen.has(k)) seen.set(k, new Set());
            seen.get(k).add(page.number);
        }
    }
    const needed = sample.length >= 6 ? 3 : 2;
    for (const page of pages) {
        page.lines = page.lines.filter((line) => {
            if (!inBand(line, page, options)) return true;
            if (isNumber(line.text)) return false;
            return (seen.get(key(line))?.size || 0) < needed;
        });
    }
}

const inBand = (line, page, options) =>
    line.rect.maxY > page.box.maxY - page.box.height * options.headerZone || line.rect.minY < page.box.minY + page.box.height * options.footerZone;

/// Digits as one, so "Page 12" and "Page 13" are the same line.
function normalized(text) {
    let out = '', lastWasDigit = false;
    for (const ch of text.toLowerCase()) {
        if (isDigit(ch)) {
            if (!lastWasDigit) out += '#';
            lastWasDigit = true;
        } else {
            out += /\s/.test(ch) ? ' ' : ch;
            lastWasDigit = false;
        }
    }
    return out.trim();
}

function isNumber(text) {
    const t = text.toLowerCase().trim();
    if (!t || [...t].length > 12) return false;
    return [...t].every((ch) => isDigit(ch) || 'ivxlcdm-–—.· '.includes(ch));
}

// MARK: - Columns and reading order

/// The page's lines in reading order: one column, or two with the left read
/// first — a line across the page (a title, a centred one) flushes both
/// columns before it, as the eye does.
function order(page, columns, body) {
    const lines = page.lines.map((line) => ({ ...line }));
    if (!lines.length) return { lines: [], two: false };
    const width = page.box.width, centre = page.box.midX;
    // The modal line width tells a column line from one across the page.
    const modal = median(lines.map((line) => line.rect.width));
    const spans = (r) => r.width > width * 0.55
        || (r.width > modal * 1.1 && Math.abs(r.midX - centre) < width * 0.04)
        || Math.abs(r.midX - centre) < width * 0.02;
    // Two columns show as two clusters of LEFT edges among the real text
    // lines (a label in a figure is short and sits anywhere).
    const real = lines.filter((line) => !spans(line.rect) && line.rect.width >= modal * 0.6);
    const middle = real.length ? (Math.min(...real.map((line) => line.rect.minX)) + Math.max(...real.map((line) => line.rect.maxX))) / 2 : centre;
    const tolerance = width * 0.02;
    let two = false, split = 0;
    if (columns !== 'one' && real.length >= 6) {
        const lefts = real.map((line) => line.rect.minX).sort((a, b) => a - b);
        let bestGap = 0, at = 0;
        for (let i = 1; i < lefts.length; i++) {
            if (lefts[i] - lefts[i - 1] > bestGap) { bestGap = lefts[i] - lefts[i - 1]; at = (lefts[i] + lefts[i - 1]) / 2; }
        }
        const leftCount = lefts.filter((x) => x < at).length;
        const balanced = Math.min(leftCount, lefts.length - leftCount) >= 3;
        // Or: the text stands either side of the block's middle and hardly a
        // line crosses it — a title block's short lines (an affiliation, an
        // address) put the left edges anywhere, and pdf.js's line boxes are
        // wider than PDFKit's (WebReader's own rule).
        const crossing = real.filter((line) => line.rect.minX < middle - tolerance && line.rect.maxX > middle + tolerance).length;
        const leftSide = real.filter((line) => line.rect.maxX <= middle + tolerance).length;
        const rightSide = real.filter((line) => line.rect.minX >= middle - tolerance).length;
        const halves = crossing * 10 <= real.length && Math.min(leftSide, rightSide) >= 3;
        if (halves && !(bestGap > width * 0.25 && balanced)) at = middle;
        if (columns === 'two' || (bestGap > width * 0.25 && balanced) || halves) {
            two = true;
            // The seam: between the left column's right edge and the right's
            // left — a title block's line across the middle has no say.
            const sides = real.filter((line) => !(line.rect.minX < middle - tolerance && line.rect.maxX > middle + tolerance));
            const leftRight = Math.max(...sides.filter((line) => line.rect.minX < at).map((line) => line.rect.maxX), -Infinity);
            const rightLeft = Math.min(...sides.filter((line) => line.rect.minX >= at).map((line) => line.rect.minX), Infinity);
            split = ((Number.isFinite(leftRight) ? leftRight : at) + (Number.isFinite(rightLeft) ? rightLeft : at)) / 2;
        }
    }
    if (two) {
        for (const line of lines) {
            // A line across the gutter is the page's, not a column's.
            line.full = spans(line.rect) || (line.rect.minX < split - tolerance && line.rect.maxX > split + tolerance);
            if (!line.full) line.column = line.rect.midX < split ? 0 : 1;
        }
    }
    rejoin(lines);
    // Every line carries its column's edges: the real lines' extent.
    for (let c = 0; c <= (two ? 1 : 0); c++) {
        const inColumn = lines.filter((line) => !line.full && line.column === c);
        const members = inColumn.filter((line) => line.rect.width >= modal * 0.6);
        const from = members.length ? members : inColumn;
        const left = from.length ? Math.min(...from.map((line) => line.rect.minX)) : 0;
        const right = from.length ? Math.max(...from.map((line) => line.rect.maxX)) : width;
        for (const line of inColumn) { line.columnLeft = left; line.columnRight = right; }
    }
    const pageLeft = Math.min(...lines.map((line) => line.rect.minX)), pageRight = Math.max(...lines.map((line) => line.rect.maxX));
    for (const line of lines) if (line.full) { line.columnLeft = pageLeft; line.columnRight = pageRight; }
    // Top to bottom, the taller first on a tie.
    lines.sort((a, b) => (a.rect.maxY !== b.rect.maxY ? b.rect.maxY - a.rect.maxY : a.rect.minX - b.rect.minX));
    // The footnotes: small type under the last line of a column's text —
    // read after the page, as the eye reads them. A figure's caption is
    // set nearer the body's size, and stays where it is.
    let notes = [];
    if (body > 0) {
        for (let c = 0; c <= (two ? 1 : 0); c++) {
            const column = lines.filter((line) => !line.full && line.column === c);
            const bodyLines = column.filter((line) => line.size >= body * 0.95);
            if (!bodyLines.length) continue;
            const bottom = Math.min(...bodyLines.map((line) => line.rect.minY));
            const under = column.filter((line) => line.size <= body * 0.85 && line.rect.maxY < bottom);
            // A few lines under the text, not a column OF small type — a
            // paper's references under its last paragraph are not notes.
            if (!under.length || under.length > Math.max(3, Math.floor(column.length / 3))) continue;
            notes.push(...under.map((line) => ({ ...line, note: true })));
        }
        if (notes.length) {
            const ids = new Set(notes.map((line) => line.index));
            for (let i = lines.length - 1; i >= 0; i--) if (ids.has(lines[i].index)) lines.splice(i, 1);
        }
    }
    if (!two) return { lines: lines.concat(notes), two: false };
    const out = [];
    let left = [], right = [];
    const flush = () => { out.push(...left, ...right); left = []; right = []; };
    for (const line of lines) {
        if (line.full) { flush(); out.push(line); }
        else if (line.column === 0) left.push(line);
        else right.push(line);
    }
    flush();
    return { lines: out.concat(notes), two: true };
}

/// The pieces of one line within one column — cut where the pen jumped
/// right — put together again, left to right.
function rejoin(lines) {
    lines.sort((a, b) => (a.rect.maxY !== b.rect.maxY ? b.rect.maxY - a.rect.maxY : a.rect.minX - b.rect.minX));
    for (let i = lines.length - 1; i > 0; i--) {
        for (let j = i - 1; j >= 0 && Math.abs(lines[j].rect.minY - lines[i].rect.minY) < Math.min(lines[i].size, lines[j].size) * 0.3; j--) {
            const left = lines[j], right = lines[i];
            if (left.full || right.full || left.column !== right.column || right.rect.minX < left.rect.maxX - left.size * 0.5) continue;
            if (right.text.length > left.text.length) left.size = right.size;
            left.text += ' ' + right.text;
            left.maxSize = Math.max(left.maxSize, right.maxSize);
            left.rect = rect(left.rect.minX, Math.min(left.rect.minY, right.rect.minY), right.rect.maxX, Math.max(left.rect.maxY, right.rect.maxY));
            lines.splice(i, 1);
            break;
        }
    }
}

// MARK: - Paragraphs and headings

function blocksOf(lines, body, options) {
    if (!lines.length) return [];
    const pitch = modalPitch(lines, body);
    // The heading sizes, largest first: the largest is the title's.
    const headingSizes = [...new Set(lines.filter((line) => line.size >= body * options.headingRatio).map((line) => line.size))].sort((a, b) => b - a);
    const titleSize = headingSizes[0];

    const blocks = [];
    let current = [], currentKind = 'paragraph';
    const close = () => {
        if (!current.length) return;
        blocks.push({ kind: currentKind, text: join(current, options), page: current[0].page });
        current = [];
    };
    const sameColumn = (p, line) => p.page === line.page && p.column === line.column && p.full === line.full
        && Math.abs(p.rect.minX - line.rect.minX) < line.size * 12;

    // The title's block: the lines of a heading size set right under the
    // title, on its axis — a subtitle, the authors — are the title's own,
    // not the first section.
    const byline = new Set();
    {
        let inTitle = false, titleMidX = 0;
        lines.forEach((line, i) => {
            if (titleSize != null && line.size === titleSize) { inTitle = true; titleMidX = line.rect.midX; return; }
            if (!(inTitle && i > 0 && headingSizes.length > 1 && headingSizes.includes(line.size) && line.page === lines[i - 1].page
                && Math.abs(line.rect.midX - titleMidX) < Math.max(line.columnRight - line.columnLeft, 1) * 0.05)) { inTitle = false; return; }
            byline.add(i);
        });
    }
    const kindOf = (line, i) => {
        if (line.note) return 'note';
        if (byline.has(i)) return 'paragraph';
        const at = headingSizes.indexOf(line.size);
        if (line.size < body * options.headingRatio || at < 0) return 'paragraph';
        return headingSizes.length > 1 && at === 0 ? 'h1' : 'h2';
    };
    // A verse: a run of body lines at the normal pitch where most start
    // with a capital and every one but the last stops short of the measure.
    const verse = new Array(lines.length).fill(false);
    {
        let run = [];
        const judge = () => {
            if (run.length >= 2) {
                const capitals = run.filter((i) => startsCapital(lines[i].text)).length;
                const short = run.slice(0, -1).every((i) => lines[i].rect.maxX < lines[i].columnRight - lines[i].size);
                if (capitals * 10 >= run.length * 7 && short) for (const i of run) verse[i] = true;
            }
            run = [];
        };
        lines.forEach((line, i) => {
            const bodyLine = line.size === body && !line.note;
            const last = run[run.length - 1];
            if (bodyLine && last != null && sameColumn(lines[last], line) && lines[last].rect.minY - line.rect.minY <= pitch * options.paragraphGap) {
                run.push(i);
            } else {
                judge();
                if (bodyLine) run = [i];
            }
        });
        judge();
    }

    let prev = null;
    lines.forEach((source, i) => {
        const line = { ...source };
        const k = kindOf(line, i);
        let breaks = false;
        if (prev) {
            const same = sameColumn(prev, line);
            const gap = prev.rect.minY - line.rect.minY;
            if (byline.has(i) && (byline.has(i - 1) || prev.size === titleSize)) {
                // The title's lines, each on its own.
                breaks = prev.size === titleSize;
                line.breakBefore = !breaks;
            } else if (k !== currentKind || prev.size !== line.size) {
                breaks = true;
            } else if (k !== 'paragraph' && k !== 'note') {
                // The lines of one heading sit close; a wider gap is the next.
                if (!same || gap > line.size * 2) breaks = true;
            } else if (verse[i] && verse[i - 1] && same && gap <= pitch * options.paragraphGap) {
                line.breakBefore = true;
            } else {
                // Beside a drop cap the lines stand in from the edge; that is
                // the cap's doing, not a paragraph's.
                const dropCap = prev.maxSize >= body * 1.8 && prev.size <= body * 1.05;
                const indented = line.rect.minX - line.columnLeft > line.size * 0.8 && !dropCap;
                const short = prev.rect.maxX < prev.columnRight - line.size * 2;
                if (same) {
                    if (gap > pitch * options.paragraphGap) breaks = true;
                    else if (indented) breaks = true;
                    else if (short && endsSentence(prev.text)) breaks = true;
                } else if (short || indented) {
                    // A new column or page: the paragraph goes on unless its
                    // last line was short or the next is indented.
                    breaks = true;
                }
            }
        }
        if (breaks) close();
        if (!current.length) currentKind = k;
        current.push(line);
        prev = line;
    });
    close();
    return blocks;
}

/// A verse's line starts with a capital — past an opening quote or a
/// bracket, if one stands first.
function startsCapital(text) {
    const first = [...text].find((ch) => !'‘“"\'([—–-*'.includes(ch) && !/\s/.test(ch));
    return !!first && isUpper(first);
}

/// A figure's labels: a word or three, a fraction of a line wide, alone
/// between wide gaps, body size or less. A verse's short lines sit close to
/// their neighbours and stay.
function dropIsolatedLabels(lines, body) {
    const pitch = modalPitch(lines, body);
    const labelish = (l) => l.size <= body * 1.05 && l.text.split(' ').length <= 3
        && (l.rect.width < (l.columnRight - l.columnLeft) * 0.3 || l.rect.minX - l.columnLeft > l.size * 3);
    const far = (a, b) => a.page !== b.page || a.column !== b.column || Math.abs(a.rect.minY - b.rect.minY) > pitch * 1.8;
    const keep = new Array(lines.length).fill(true);
    let i = 0;
    while (i < lines.length) {
        if (!labelish(lines[i])) { i++; continue; }
        let j = i;
        while (j + 1 < lines.length && labelish(lines[j + 1]) && !far(lines[j], lines[j + 1])) j++;
        const before = i === 0 || far(lines[i - 1], lines[i]);
        const after = j === lines.length - 1 || far(lines[j], lines[j + 1]);
        let small = true;
        for (let k = i; k <= j; k++) if (lines[k].size >= body) small = false;
        if ((before && after) || j - i + 1 >= 3 || ((before || after) && small)) for (let k = i; k <= j; k++) keep[k] = false;
        i = j + 1;
    }
    return lines.filter((_, index) => keep[index]);
}

/// The modal distance between the baselines of consecutive body lines.
function modalPitch(lines, body) {
    const weight = new Map();
    for (let i = 1; i < lines.length; i++) {
        const a = lines[i - 1], b = lines[i];
        if (a.page !== b.page || a.column !== b.column || a.size !== body || b.size !== body) continue;
        const d = a.rect.minY - b.rect.minY;
        if (d <= body * 0.6 || d >= body * 3) continue;
        const key = half(d);
        weight.set(key, (weight.get(key) || 0) + 1);
    }
    return [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] || body * 1.3;
}

function endsSentence(text) {
    const last = text[text.length - 1];
    return !!last && ('.!?…»”’")'.includes(last) || text.endsWith('.)') || text.endsWith('.”'));
}

/// The lines of a block as one text: a hyphen at a line's end joins the
/// halves, every other line end is a space.
function join(lines, options) {
    let out = '';
    lines.forEach((line, i) => {
        const t = line.text;
        if (i === 0) { out = t; return; }
        if (line.breakBefore) { out += '\n' + t; return; }
        const last = out[out.length - 1];
        if (options.joinHyphens && last && '-‐­'.includes(last) && t[0] && isLower(t[0])) out = out.slice(0, -1) + t;
        // A compound's hyphen before a capital stays, with no space after it.
        else if (last === '-' && t[0] && isUpper(t[0])) out += t;
        else out += ' ' + t;
    });
    return out.replace(/­/g, '');
}

// MARK: - The document

/// The PDF's blocks and the numbers on them. `progress(done, total)` is
/// told as pages are read.
export async function readText(doc, options = {}, progress = () => {}) {
    const o = { ...defaults, ...options };
    const count = doc.numPages;
    const pages = [];
    for (let n = 1; n <= count; n++) {
        const proxy = await doc.getPage(n);
        const [x0, y0, x1, y1] = proxy.view;
        pages.push({ number: n, box: { ...rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)) }, lines: await linesOf(proxy, n) });
        proxy.cleanup();
        if (n % 8 === 0 || n === count) progress(n, count);
    }
    const stats = { pages: count, pagesWithText: 0, characters: 0, bodySize: 0, twoColumnPages: 0 };
    const body = bodySize(pages);
    stats.bodySize = body;
    if (o.dropRunningLines) dropRunningLines(pages, pages, o);
    // Figure labels, axis ticks, the like: type well under the body's.
    for (const page of pages) page.lines = page.lines.filter((line) => line.size >= body * 0.55);
    let ordered = [];
    for (const page of pages) {
        const { lines, two } = order(page, o.columns, body);
        if (two) stats.twoColumnPages++;
        if (lines.length) stats.pagesWithText++;
        ordered = ordered.concat(lines);
    }
    ordered = dropIsolatedLabels(ordered, body);
    stats.characters = ordered.reduce((sum, line) => sum + line.text.length, 0);
    return { blocks: blocksOf(ordered, body, o), stats };
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/// The blocks as the page's HTML. A heading has an id for the contents, and
/// so has a block the outline points at (`anchor`).
export function html(blocks) {
    return blocks.map((block, index) => {
        const text = escape(block.text).replace(/\n/g, '<br>');
        const heading = block.kind === 'h1' || block.kind === 'h2';
        const id = heading || block.anchor ? ` id="_cr_b${index}"` : '';
        if (heading) return `<${block.kind}${id}>${text}</${block.kind}>`;
        if (block.kind === 'note') return `<p class="footnote"${id}><small>${text}</small></p>`;
        return `<p${id}>${text}</p>`;
    }).join('\n');
}

/// For the tests: the steps on their own.
export const steps = { linesOf, order, rejoin };
