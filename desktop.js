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

/// The files the system hands the program — opened with it, dropped on its
/// icon, a second launch: each goes to `open` as a File, those waiting now
/// and those that come later. One book is open at a time, so of several
/// the last wins. True when a book was waiting.
export async function booksFromSystem(open, fail) {
    if (!desktop) return false;
    const take = async () => {
        try {
            const path = (await tauri.core.invoke('take_books')).at(-1);
            if (!path) return false;
            const bytes = await tauri.core.invoke('read_book', { path });
            await open(new File([bytes], path.split(/[\\/]/).pop()));
            return true;
        } catch (error) {
            fail(error.message || String(error));
            return false;
        }
    };
    await tauri.event.listen('books', take);
    return take();
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
        tauri.core.invoke('plugin:opener|open_url', { url: link.href }).catch(() => {});
    });
}

/// The window is named as a tab would be: by the book.
if (desktop) {
    const name = () => tauri.window.getCurrentWindow().setTitle(document.title).catch(() => {});
    new MutationObserver(name).observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });
    linksGoOutside(document);
}
