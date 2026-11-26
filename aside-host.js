// The book's drawer in a window of its own (NanoReader): it floats over the
// reader's window, goes past its edge, and never behind it — a child of
// the reader's window. One searches and marks in it with the page in view.
//
// The drawer stays the reader's window's (drawer.js, marks.js): its DOM is
// kept there out of sight, and mirrored into the other window
// (aside.html, aside.js), which draws it and sends back what the reader
// does there, to be done again on the original. In a browser, or where the
// window cannot be made, the drawer lies over the page as before.

import { desktop } from './desktop.js';

const tauri = window.__TAURI__;
const label = 'book';

/// `host`: the drawer's element; `page()`: the book's window, its pictures
/// drawn small for the other window; `close()`: the drawer shut.
export function floatingDrawer(host, { page, close, title }) {
    if (!desktop || !tauri?.webviewWindow?.WebviewWindow || !tauri.event?.emitTo) return null;
    const root = document.documentElement;
    root.classList.add('floating');
    let window_ = null;
    let ready = null;
    let readyNow = () => {};
    let shown = false;
    let focus = null;
    let timer = 0;
    let broken = false;
    const small = new Map();

    /// Where a node stands under the drawer: its index at each step down.
    const pathOf = (node) => {
        const steps = [];
        for (; node && node !== host; node = node.parentNode) steps.unshift([...node.parentNode.childNodes].indexOf(node));
        return node === host ? steps : null;
    };
    const nodeAt = (steps) => steps.reduce((node, index) => node?.childNodes[index], host);

    /// A picture of the book, small, as the other window can show it: a
    /// book's own address (a blob's) is this window's alone.
    function picture(src) {
        if (!src || /^https?:/.test(src)) return src;
        if (small.has(src)) return small.get(src);
        const image = [...(page()?.document.images || [])].find((one) => one.src === src && one.complete && one.naturalWidth);
        if (!image) return '';
        const scale = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const drawn = canvas.toDataURL('image/jpeg', 0.85);
        small.set(src, drawn);
        return drawn;
    }

    /// The drawer as it is now, with its fields' values and the page's
    /// colours, which the other window wears.
    function state() {
        const copy = host.cloneNode(true);
        for (const image of copy.querySelectorAll('img')) image.setAttribute('src', picture(image.getAttribute('src')));
        const vars = {};
        for (const name of root.style) if (name.startsWith('--')) vars[name] = root.style.getPropertyValue(name);
        const said = { html: copy.innerHTML, values: [...host.querySelectorAll('input, textarea')].map((field) => [pathOf(field), field.value]), focus, title: title(), dark: root.hasAttribute('data-dark'), dusk: root.hasAttribute('data-dusk'), lang: root.lang, vars };
        focus = null;
        return said;
    }

    async function make() {
        const place = JSON.parse(localStorage.getItem('nano.aside.place') || 'null');
        const own = tauri.window.getCurrentWindow();
        let x, y;
        if (place) ({ x, y } = place);
        else {
            const scale = await own.scaleFactor().catch(() => 1);
            const at = await own.outerPosition().catch(() => ({ x: 0, y: 0 }));
            x = Math.round(at.x / scale) + 16;
            y = Math.round(at.y / scale) + 64;
        }
        ready = new Promise((done, fail) => {
            readyNow = done;
            window_ = new tauri.webviewWindow.WebviewWindow(label, {
                url: 'aside.html', title: title(), parent: 'main',
                x, y, width: place?.width || 340, height: place?.height || 620, minWidth: 260, minHeight: 320,
                resizable: true, maximizable: false, minimizable: false, visible: false, focus: false, skipTaskbar: true,
                theme: root.hasAttribute('data-dark') ? 'dark' : 'light', titleBarStyle: 'transparent',
            });
            window_.once('tauri://error', (event) => fail(new Error(String(event.payload))));
        });
        return ready;
    }

    async function send() {
        if (broken) return;
        try {
            if (host.hidden) {
                // Gone, not hidden: the Mac lets a hidden child window go
                // from its parent, and shown again it fell behind the
                // reader's (user, 26.11.2026). Made anew, it is the
                // reader's child again.
                if (window_) {
                    const going = window_;
                    window_ = null;
                    ready = null;
                    shown = false;
                    await going.destroy?.().catch(() => going.close?.());
                }
                return;
            }
            if (!ready) await make();
            await ready;
            await tauri.event.emitTo(label, 'aside', state());
            if (!shown) {
                shown = true;
                await window_.show();
                await window_.setFocus();
            }
        } catch {
            // No window of its own: the drawer over the page, as in a browser.
            broken = true;
            root.classList.remove('floating');
        }
    }
    const soon = () => { clearTimeout(timer); timer = setTimeout(send, 16); };
    new MutationObserver(soon).observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    // A field the drawer focuses (the search's) is focused there; here the
    // page keeps the keys.
    host.addEventListener('focusin', (event) => {
        focus = pathOf(event.target);
        soon();
        setTimeout(() => page()?.focus(), 0);
    });

    // What the reader did there, done here.
    tauri.event.listen('aside-do', ({ payload: { kind, path, value, key, shift } }) => {
        if (kind === 'ready') return readyNow();
        if (kind === 'close') return close();
        if (kind === 'place') return localStorage.setItem('nano.aside.place', JSON.stringify(value));
        const node = path && nodeAt(path);
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (!element) return undefined;
        switch (kind) {
        case 'click': case 'dblclick':
            element.dispatchEvent(new MouseEvent(kind, { bubbles: true, cancelable: true }));
            break;
        case 'input': case 'change':
            element.value = value;
            element.dispatchEvent(new Event(kind, { bubbles: true }));
            break;
        case 'key':
            element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: !!shift, bubbles: true, cancelable: true }));
            break;
        case 'submit':
            element.requestSubmit();
            break;
        default:
        }
        return undefined;
    });

    return {
        get on() { return !broken; },
        /// The reader's window takes the keys again: a choice made there
        /// goes to reading. The drawer's window stays over it.
        reading() { if (shown) tauri.window.getCurrentWindow().setFocus().catch(() => {}); },
        /// The language or the light changed.
        refresh: soon,
    };
}
