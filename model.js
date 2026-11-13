// The reader's choices and what they become: the settings kept in the
// browser, and the payload the page script takes (ReaderCore
// `ReaderSettings.cssInjectionJS`).

// The family's five palettes, seven tones each, Bright → Void
// (ReaderCore `ReaderTheme`: bgColor, textColor, linkColor).
export const palettes = {
    neutral: {
        name: 'Neutral',
        bg: ['#ffffff', '#d8d8d8', '#b0b0b0', '#808080', '#3a3a3a', '#2a2a2a', '#000000'],
        text: ['#1a1a1a', '#2a2a2a', '#1a1a1a', '#e8e8e8', '#b8b8b8', '#c8c8c8', '#ffffff'],
        link: ['#2563eb', '#1d4ed8', '#1e40af', '#1e40af', '#93c5fd', '#60a5fa', '#6699ff'],
    },
    ochre: {
        name: 'Ochre',
        bg: ['#ffffff', '#f8f1e3', '#f2e8d0', '#d4c0a0', '#4a3822', '#140c04', '#000000'],
        text: ['#92400e', '#4a3525', '#4a3525', '#2e1e10', '#d4b896', '#c8a878', '#daa520'],
        link: ['#92400e', '#92400e', '#92400e', '#7a3408', '#d4945a', '#c8864a', '#c8864a'],
    },
    celestial: {
        name: 'Celestial',
        bg: ['#ffffff', '#e8eef8', '#d6e3f5', '#a8c0dc', '#283a50', '#080e18', '#000000'],
        text: ['#3b82f6', '#1e2d42', '#1e2d42', '#0e1a2a', '#a8c0dc', '#90b0d4', '#6699ff'],
        link: ['#3b82f6', '#3b82f6', '#3b82f6', '#2563eb', '#6da4f0', '#5890e0', '#5890e0'],
    },
    lime: {
        name: 'Lime',
        bg: ['#ffffff', '#f8f9e2', '#f5f7d0', '#c8cc92', '#3a3c22', '#0e1004', '#000000'],
        text: ['#65660a', '#3a3818', '#3a3818', '#222408', '#c4c890', '#b0b478', '#d8d833'],
        link: ['#65660a', '#65660a', '#65660a', '#4a4c06', '#98a040', '#889030', '#889030'],
    },
    rose: {
        name: 'Rose',
        bg: ['#ffffff', '#f9ecf0', '#f3e0e7', '#d0a8b7', '#4c2b36', '#180a0f', '#000000'],
        text: ['#a03860', '#4f2e38', '#4f2e38', '#381a24', '#dab5c3', '#cca3b3', '#f58cc0'],
        link: ['#a03860', '#a03860', '#a03860', '#882850', '#d88aa8', '#c87898', '#c87898'],
    },
};
export const toneNames = ['Bright', 'Light', 'Soft', 'Mid', 'Dusk', 'Deep', 'Void'];
/// The first tone that reads as a dark page.
export const firstDarkTone = 3;

// A face is a stack that lands on something everywhere: the Mac's and
// Windows' own faces first, Android's Noto and Roboto after. `scale` is the
// family's optical compensation (Georgia's small x-height), `book` the
// paragraph's shape: an indent and no space, or a space and no indent.
export const faces = {
    serif: { name: 'Serif', stack: 'Georgia, Noto Serif, serif', scale: 1.07, book: true, leading: 1.50 },
    book: { name: 'Book', stack: 'Iowan Old Style, Palatino, Palatino Linotype, Book Antiqua, Noto Serif, serif', scale: 1.07, book: true, leading: 1.50 },
    sans: { name: 'Sans', stack: '-apple-system, system-ui, Segoe UI, Roboto, sans-serif', scale: 1, book: false, leading: 1.55 },
    mono: { name: 'Mono', stack: 'Menlo, Consolas, Roboto Mono, DejaVu Sans Mono, monospace', scale: 0.94, book: false, leading: 1.55 },
};

export const papers = ['none', 'lined', 'squared', 'sand', 'kraft', 'fibre', 'laid'];
export const paperNames = { none: 'Plain', lined: 'Lined', squared: 'Squared', sand: 'Sand', kraft: 'Kraft', fibre: 'Fibre', laid: 'Laid' };

export const ranges = {
    size: { min: 12, max: 32, step: 1 },
    /// Added to the leading derived from the face and the size.
    leading: { min: -0.15, max: 0.35, step: 0.05 },
    /// A side margin, per cent of the page's width.
    margins: { min: 0, max: 20, step: 1 },
    /// The text toward the paper on a dark page, per cent.
    nightText: { min: 50, max: 100, step: 1 },
    /// A book of pictures on dark paper, per cent.
    nightPages: { min: 30, max: 100, step: 1 },
    /// The paper's grain, per cent.
    paperStrength: { min: 10, max: 100, step: 5 },
};

export const defaults = {
    version: 2,
    light: 'auto', palette: 'ochre', dayTone: 1, nightTone: 5, nightText: 100, nightPages: 100,
    paper: 'none', paperStrength: 50,
    face: 'serif', size: 18, leading: 0, align: 'justify',
    layout: 'scroll', columns: '2', turn: 'on', margins: 5, frame: 'shadow',
    pagesColumns: '2', transparentPages: true, language: 'auto',
};

/// The settings as stored, older shapes read into the present one.
export function load() {
    const stored = JSON.parse(localStorage.getItem('nano.settings') || '{}');
    const settings = Object.assign({}, defaults, stored);
    if (!palettes[settings.palette]) settings.palette = defaults.palette;
    if (typeof settings.leading === 'string') settings.leading = { tight: -0.15, normal: 0, loose: 0.2 }[settings.leading] ?? 0;
    if (typeof settings.margins === 'string') settings.margins = { narrow: 2, normal: 5, wide: 10, widest: 16 }[settings.margins] ?? 5;
    if (settings.layout === 'page') Object.assign(settings, { layout: 'pages', columns: '1' });
    if (settings.layout === 'two') Object.assign(settings, { layout: 'pages', columns: '2' });
    if (!faces[settings.face]) settings.face = defaults.face;
    // 2: the columns' separators joined the frames; «none» had meant
    // Comfort's shadow and lines.
    if ((settings.version || 1) < 2) {
        if (settings.frame === 'none') settings.frame = 'shadow';
        settings.version = 2;
    }
    return settings;
}

export const save = (settings) => localStorage.setItem('nano.settings', JSON.stringify(settings));

const systemDark = matchMedia('(prefers-color-scheme: dark)');
export const onSystemLight = (handler) => systemDark.addEventListener('change', handler);

export const isNight = (s) => s.light === 'night' || (s.light === 'auto' && systemDark.matches);
export const tone = (s) => (isNight(s) ? s.nightTone : s.dayTone);
export const paged = (s) => s.layout !== 'scroll';

/// Two colours mixed, `share` of the second.
export function mix(a, b, share) {
    const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [x, y] = [parse(a), parse(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * share).toString(16).padStart(2, '0')).join('');
}

/// The page's colours. On a dark page the text can be dimmed toward the
/// paper (the reader's text brightness).
export function theme(s, pictures = false) {
    const palette = palettes[s.palette];
    const index = tone(s);
    const dark = index >= firstDarkTone;
    const text = dark && !pictures && s.nightText < 100 ? mix(palette.text[index], palette.bg[index], 1 - s.nightText / 100) : palette.text[index];
    return { bg: palette.bg[index], text, link: palette.link[index], dark };
}

const textFrames = new Set(['single', 'double', 'notched', 'vintage']);
const separators = { shadow: 'shadow', lines: 'line', none: 'none' };

/// What every payload carries, the text's or the pictures'.
function base(s, book, colours) {
    return {
        maxWidth: '100%', bgColor: colours.bg, textColor: colours.text, linkColor: colours.link,
        imageDisplay: 'show', fontWeight: 400, fontStretch: 'normal',
        columnsMinChars: 24, columnsNeedLandscape: false,
        pageTransition: s.turn === 'on', pageFlip: false, pageCards: false, pageSink: false,
        comfort: null, pageCarriage: false, pageCrumble: false,
        pageSeparator: 'shadow', pageSeparatorRest: 'shadow', pageTapZone: 'horizontal', invertTapZones: false,
        topReservedZone: 0, scrollAnimation: true, nativeLineKeys: false,
        nortonFrame: false, nortonInk: '', nortonPlate: '', nortonHit: '', nortonHitInk: '',
        tintMonoImages: false, pagesBrightness: 1,
        pageTextureOpacity: s.paperStrength / 100, pageTextureDark: colours.dark, pageTextureOn: s.paper !== 'none',
        frameRail: 0, bookAuthor: book ? book.author || '' : '',
        isFullscreen: false, bottomSafeArea: 0, isPhone: false, fullscreenClockMode: 'no',
        scrollTopPad: 0, onSheet: false, comfortStrip: 0,
    };
}

/// The book's own direction unless the reader turned it.
export function direction(book) {
    if (!book) return 'ltr';
    return localStorage.getItem('nano.direction.' + book.key) || (book.rightToLeft ? 'rtl' : 'ltr');
}

/// A book of pictures is a strip or pages by its own kind (a webtoon is a
/// strip) until the reader says otherwise, for that book.
export function pictureStrip(book) {
    const kept = localStorage.getItem('nano.strip.' + book.key);
    return kept === null ? !!book.pages.strip : kept === '1';
}

/// Whether the book turns pages, the text's way or the pictures'.
export const turning = (s, book) => (book?.pages ? !pictureStrip(book) : paged(s));

/// The payload. Leading follows the face and the size as Comfort's does
/// (`ComfortTypography.derive`), then the reader's step.
export function payload(s, book, width) {
    if (book?.pages) {
        // A book of pictures reads one way whatever the text's settings
        // say: a column a page, no margins, no frame; scroll is the strip.
        const colours = theme(s, true);
        const strip = pictureStrip(book);
        return Object.assign(base(s, book, colours), {
            fontFamily: 'Georgia, serif', fontSize: 18, lineHeight: 1.5, padding: 0,
            textIndent: false, textAlign: 'left', paragraphSpacing: '0.2em', hyphenation: false,
            navigationMode: strip ? 'scroll' : 'page',
            pageColumns: s.pagesColumns === '1' ? '1' : '2',
            pages: { rtl: direction(book) === 'rtl', strip, firstAlone: book.pages.firstAlone !== false },
            // The page's white is the paper: ink pages in the theme's ink,
            // colour pages multiplied into the paper by day.
            tintMonoImages: s.transparentPages,
            pagesBrightness: colours.dark ? s.nightPages / 100 : 1,
            textFrame: 'none', textRTL: false,
        });
    }
    const face = faces[s.face] || faces.serif;
    const derived = Math.round(Math.max(1.30, Math.min(1.60, face.leading - 0.012 * (s.size - 18))) * 20) / 20;
    const colours = theme(s);
    const justified = s.align === 'justify' && s.face !== 'mono';
    return Object.assign(base(s, book, colours), {
        fontFamily: face.stack,
        fontSize: Number((s.size * face.scale).toFixed(2)),
        lineHeight: Number((derived + s.leading).toFixed(2)),
        padding: Math.max(12, Math.round(width * s.margins / 100)),
        textIndent: face.book,
        textAlign: justified ? 'justify' : 'left',
        paragraphSpacing: face.book ? '0.2em' : '0.8em',
        hyphenation: justified,
        navigationMode: paged(s) ? 'page' : 'scroll',
        pageColumns: s.columns,
        pages: null,
        // The frames and the columns' separators are one choice: a frame
        // round the text, or every gutter alike — a shadow, a line or
        // nothing (the engine's first gutter and the rest set the same).
        textFrame: textFrames.has(s.frame) ? s.frame : 'none',
        pageSeparator: separators[s.frame] ?? 'none',
        pageSeparatorRest: separators[s.frame] ?? 'none',
        textRTL: direction(book) === 'rtl',
    });
}

/// The line height a reader would see, for the slider's number.
export function lineHeight(s) {
    const face = faces[s.face] || faces.serif;
    const derived = Math.round(Math.max(1.30, Math.min(1.60, face.leading - 0.012 * (s.size - 18))) * 20) / 20;
    return derived + s.leading;
}
