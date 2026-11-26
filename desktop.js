// NanoReader: this same reader in a window of its own (Tauri, `src-tauri`).
// What only a program can do goes through here, so the shell asks one
// place and the browser's reader stays as it was: `desktop` is false in a
// browser and nothing here runs.

const tauri = window.__TAURI__;

export const desktop = !!tauri;

/// The reader's name: WebReader in a browser, NanoReader on the desk.
export const appName = desktop ? 'NanoReader' : 'WebReader';

/// The shell's words name the reader; on the desk they name NanoReader.
export const named = (words) => (desktop ? words.replaceAll('WebReader', appName) : words);

const ask = (command, payload) => tauri.core.invoke(command, payload);

/// The file at a path the system handed over, with the path on it.
export async function fileAt(path) {
    const bytes = await ask('read_book', { path });
    return Object.assign(new File([bytes], path.split(/[\\/]/).pop()), { path });
}

/// The files the system hands the program — opened with it, dropped on its
/// icon, a second launch: each goes to `open` as a File, those waiting now
/// and those that come later. One book is open at a time, so of several
/// the last wins. True when a book was waiting.
export async function booksFromSystem(open, fail) {
    if (!desktop) return false;
    const take = async () => {
        try {
            const path = (await ask('take_books')).at(-1);
            if (!path) return false;
            await open(await fileAt(path));
            return true;
        } catch (error) {
            fail(error.message || String(error));
            return false;
        }
    };
    await tauri.event.listen('books', take);
    return take();
}

/// The system's Open dialog: the file chosen, or null.
export async function pickFile(title, kind) {
    const path = (await ask('pick_books', { title, kind })).at(-1);
    return path ? fileAt(path) : null;
}

/// Which of these paths still have their files.
export const standing = (paths) => ask('standing', { paths });

/// What the site said of a link's file, and its bytes: the program asks,
/// so no site's rules for pages stand in the way.
export async function fetched(url) {
    const bytes = new Uint8Array(await ask('fetch_book', { url }));
    const end = bytes.indexOf(10);
    return { about: JSON.parse(new TextDecoder().decode(bytes.subarray(0, end))), bytes: bytes.subarray(end + 1) };
}

/// What the program keeps, a name each (`KEPT` in lib.rs).
export async function kept(name, otherwise) {
    if (!desktop) return otherwise;
    try {
        return JSON.parse(await ask('data_read', { name })) ?? otherwise;
    } catch {
        return otherwise;
    }
}
export const keepHere = (name, value) => (desktop ? ask('data_write', { name, text: JSON.stringify(value) }) : Promise.resolve());

/// A text saved where the reader chooses: the file's name, or null when
/// they chose nothing.
export const savedFile = (name, text) => ask('save_text', { name, text });

/// The program's own version, as a beta says it; null in a browser.
export async function programVersion() {
    const own = await tauri?.app?.getVersion?.().catch(() => null);
    return own ? own.replace(/^(\d+\.\d+)\.0\b/, '$1') : null;
}

/// The window's own light — 'light', 'dark', or the system's (null) — and
/// its colour, which the Mac's see-through title shows (tauri.conf.json:
/// titleBarStyle Transparent); elsewhere the system's title takes the light.
let worn, wornColour;
export function dressWindow(light, colour) {
    if (own?.setTheme && worn !== light) {
        worn = light;
        own.setTheme(light).catch(() => {});
    }
    if (colour && own?.setBackgroundColor && wornColour !== colour) {
        wornColour = colour;
        own.setBackgroundColor(colour).catch(() => {});
    }
}

/// The program's menu in the reader's language; `chosen(id)` on a choice.
export const setMenu = (words) => (desktop ? ask('set_menu', { words }).catch(() => {}) : null);
export const onMenu = (chosen) => (desktop ? tauri.event.listen('menu', (event) => chosen(event.payload)) : null);

/// A file held over the window, and let go or taken away: the program
/// hears the drag, the page does not. The file itself comes by `books`.
export function watchDrag(over) {
    if (!desktop) return;
    tauri.event.listen('tauri://drag-enter', () => over(true));
    for (const end of ['tauri://drag-leave', 'tauri://drag-drop']) tauri.event.listen(end, () => over(false));
}

/// The window's own full screen; the page wears `full` while it lasts.
const own = desktop ? tauri.window.getCurrentWindow() : null;
export async function toggleWindowFull() {
    await ask('set_full', { on: !(await own.isFullscreen()) });
}
export function watchWindowFull(changed) {
    if (!desktop || !own.onResized) return;
    const look = async () => {
        const full = await own.isFullscreen().catch(() => false);
        if (document.documentElement.classList.toggle('full', full) !== was) { was = full; changed(full); }
    };
    let was = false;
    own.onResized(() => look());
    look();
}

/// The window's place, apart for its two lives — the program's home and a
/// book (user, 26.11.2026: on Windows and Linux windows float; one size for
/// both will not do). Each keeps its size, its place on the screen and
/// whether it was maximized, kept as it changes; a book opened or closed
/// takes the other's. The full screen is left as it is.
let windowMode = 'home';
let placing = false;
const placeKey = (mode) => `nano.window.${mode}`;
const placed = (mode) => JSON.parse(localStorage.getItem(placeKey(mode)) || 'null');

async function keepPlace() {
    if (!desktop || placing || !own?.innerSize || !isMain) return;
    try {
        if (await own.isFullscreen()) return;
        const before = placed(windowMode) || {};
        if (await own.isMaximized()) {
            localStorage.setItem(placeKey(windowMode), JSON.stringify({ ...before, maximized: true }));
            return;
        }
        const scale = await own.scaleFactor();
        const at = await own.outerPosition();
        const size = await own.innerSize();
        localStorage.setItem(placeKey(windowMode), JSON.stringify({
            x: Math.round(at.x / scale), y: Math.round(at.y / scale), width: Math.round(size.width / scale), height: Math.round(size.height / scale), maximized: false,
        }));
    } catch { /* the window is going */ }
}

/// Whether a place saved is on a screen that is still there.
async function onScreen({ x, y }) {
    try {
        const screens = await tauri.window.availableMonitors();
        return screens.some((screen) => {
            const left = screen.position.x / screen.scaleFactor, top = screen.position.y / screen.scaleFactor;
            return x >= left - 40 && y >= top - 10 && x < left + screen.size.width / screen.scaleFactor - 80 && y < top + screen.size.height / screen.scaleFactor - 60;
        });
    } catch {
        return false;
    }
}

/// The window for `mode` ('home', 'reader'), as it last was there.
export async function windowFor(mode) {
    if (!desktop || mode === windowMode || !own?.setSize || !isMain) return;
    await keepPlace();
    windowMode = mode;
    await takePlace(mode);
}

async function takePlace(mode) {
    const saved = placed(mode);
    if (!saved) return;
    try {
        if (await own.isFullscreen()) return;
        placing = true;
        const { LogicalSize, LogicalPosition } = tauri.dpi || tauri.window;
        const maximized = await own.isMaximized();
        if (maximized && !saved.maximized) await own.unmaximize();
        if (saved.width && (!maximized || !saved.maximized)) {
            await own.setSize(new LogicalSize(saved.width, saved.height));
            if (await onScreen(saved)) await own.setPosition(new LogicalPosition(saved.x, saved.y));
        }
        if (saved.maximized && !maximized) await own.maximize();
    } catch { /* left as it is */ } finally {
        setTimeout(() => { placing = false; }, 500);
    }
}

// The reader's window only: this module is loaded in the drawer's window
// too (by the words), and there it took the home's place at its start and
// wrote its own over it as it moved (user, 26.11.2026).
const isMain = !own?.label || own.label === 'main';
if (desktop && own?.onMoved && isMain) {
    let timer = 0;
    const soon = () => { clearTimeout(timer); timer = setTimeout(keepPlace, 400); };
    own.onMoved(soon);
    own.onResized(soon);
    // The home's place at the start, as it was left.
    if (own.setSize) takePlace('home');
}

/// A link out of the reader opens in the system's browser: the window has
/// one page and it is the reader's. Asked for the shell's document here and
/// for each book's by the shell (a book's links are in its frame).
export function linksGoOutside(document) {
    if (!desktop) return;
    document.addEventListener('click', (event) => {
        const link = event.target.closest?.('a[href]');
        if (!link || !/^(https?|mailto):/.test(link.getAttribute('href'))) return;
        event.preventDefault();
        ask('plugin:opener|open_url', { url: link.href }).catch(() => {});
    });
}

/// The window is named as a tab would be: by the book.
if (desktop) {
    const name = () => own.setTitle(document.title).catch(() => {});
    new MutationObserver(name).observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });
    linksGoOutside(document);
}
