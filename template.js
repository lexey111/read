// The family's page template (ReaderCore `HTMLTemplate.full`), with the
// web's own first line: a policy under which nothing of the book's can
// run. The reader's script is evaluated from the shell (`'unsafe-eval'`
// is for that call alone); inline scripts, handlers and script URLs are
// refused, and nothing loads from anywhere but the book's own pictures.

const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function policy() {
    return [
        "default-src 'none'",
        "script-src 'unsafe-eval'",
        "style-src 'unsafe-inline'",
        `img-src blob: data: ${location.origin}`,
        "font-src data:",
        "form-action 'none'",
        "base-uri 'none'",
    ].join('; ');
}

export function page(body, title, language, extraCSS = '') {
    return `<!DOCTYPE html>
<html${language ? ` lang="${escape(language)}"` : ''}>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${policy()}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escape(title)}</title>
    <style>
        :root {
            --font-family: Georgia, serif;
            --font-size: 18px;
            --line-height: 1.6;
            --max-width: 680px;
            --bg-color: #ffffff;
            --text-color: #1a1a1a;
            --text-indent: 1.5em;
            --text-align: left;
        }
        html { background: var(--bg-color); }
        body {
            font-family: var(--font-family);
            font-size: var(--font-size);
            line-height: var(--line-height);
            max-width: var(--max-width);
            margin: 0 auto;
            padding: 2rem 1.5rem 8rem;
            background: transparent;
            color: var(--text-color);
            overflow-wrap: break-word;
            word-break: break-word;
        }
        h1 { font-size: 1.6em; margin: 2em 0 0.5em; }
        h2 { font-size: 1.4em; margin: 2em 0 0.5em; }
        h3 { font-size: 1.1em; margin: 1.5em 0 0.5em; }
        p { margin: 0 0 0.6em; text-indent: var(--text-indent); text-align: var(--text-align); }
        p:first-of-type { text-indent: 0; }
        section { margin-bottom: 2em; }
        blockquote { margin: 1em 2em; font-style: italic; }
        .poem { margin: 1em 2em; }
        .verse { margin: 0; }
        .stanza { margin-bottom: 1em; }
        code { font-family: monospace; background: #f4f4f4; padding: 0.1em 0.3em; }
        .book-image { text-align: center; margin: 1em 0; }
        img { max-width: 100%; height: auto; }
        .footnote-ref { color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; cursor: pointer; }
        a._cr_jump { cursor: pointer; }
        ${extraCSS}
    </style>
</head>
<body>
${body}
</body>
</html>`;
}

/// A book of pictures (ReaderCore `HTMLTemplate.pages`): the reader's
/// script lays the pages out; this sheet only keeps a page from flowing
/// like prose before the script arrives.
export function pagesPage(body, title) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${policy()}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escape(title)}</title>
    <style>
        :root { --bg-color: #ffffff; }
        html { background: var(--bg-color); }
        body { margin: 0; padding: 0; background: transparent; }
        ._cr_page { margin: 0; padding: 0; text-align: center; }
        ._cr_page img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
    </style>
</head>
<body class="_cr_pages">
${body}
</body>
</html>`;
}
