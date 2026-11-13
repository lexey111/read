// ReaderCore's `HTMLSanitizer`, on elements. The page lives beside the
// shell, so nothing of the book's may run: no script, no handler, no
// script URL — and the page's own policy forbids them a second time.
const removedWhole = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'applet', 'link', 'meta', 'base', 'embed', 'audio', 'video', 'title', 'head', 'math']);
const unwrapped = new Set(['form', 'button', 'select', 'textarea', 'option', 'optgroup', 'fieldset', 'legend', 'datalist', 'output', 'font', 'center', 'big', 'picture']);
const removedVoid = new Set(['input', 'basefont', 'source', 'track', 'param']);
const removedAttributes = new Set(['style', 'align', 'bgcolor', 'valign', 'srcset', 'sizes', 'action', 'formaction', 'background', 'ping', 'target']);

/// A URL that runs something, as a browser reads the value: the blanks and
/// control characters it ignores dropped. A `data:` URL is a picture or
/// nothing.
function isScriptURL(value) {
    const read = value.replace(/[\x00-\x20\x7f]+/g, '');
    return /^(javascript|vbscript):/i.test(read) || (/^data:/i.test(read) && !/^data:image\/(png|jpe?g|gif|webp|avif|bmp)[;,]/i.test(read));
}

export function sanitize(root) {
    for (const node of [...root.querySelectorAll('*')]) {
        // Gone with a parent taken out before it.
        if (!root.contains(node)) continue;
        const tag = node.localName.toLowerCase();
        if (removedWhole.has(tag) || removedVoid.has(tag)) { node.remove(); continue; }
        if (tag === 'svg') {
            // A cover is often an <svg> round one picture: the picture stays.
            const picture = node.querySelector('image');
            const href = picture && (picture.getAttribute('xlink:href') || picture.getAttribute('href'));
            if (href && node.querySelectorAll('image').length === 1) {
                const img = root.ownerDocument.createElement('img');
                img.setAttribute('src', href);
                node.replaceWith(img);
            } else {
                node.remove();
            }
            continue;
        }
        if (unwrapped.has(tag)) { node.replaceWith(...node.childNodes); continue; }
        for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || removedAttributes.has(name)) node.removeAttribute(attribute.name);
            else if ((name === 'href' || name === 'src' || name === 'xlink:href') && isScriptURL(attribute.value)) node.removeAttribute(attribute.name);
        }
    }
}
