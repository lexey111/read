// The books kept in the browser: three of them, in the order they came, so
// a reload or the next visit goes on where the reader stopped (WebReader
// #9). Each is kept on its own (`book:<key>`: the file's bytes, its name,
// title, author and a small cover) and `shelf` holds their order — a book
// opened again is written alone, not the three of them.

export const slots = 3;

const open = () => new Promise((done, fail) => {
    const request = indexedDB.open('nano-reader', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('books');
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
});

async function run(mode, work) {
    const db = await open();
    try {
        return await new Promise((done, fail) => {
            const transaction = db.transaction('books', mode);
            const request = work(transaction.objectStore('books'));
            transaction.oncomplete = () => done(request?.result);
            transaction.onerror = () => fail(transaction.error);
            transaction.onabort = () => fail(transaction.error);
        });
    } finally {
        db.close();
    }
}

/// The keys in their slots. Before the slots one book stood under `last`:
/// it takes the first.
async function order() {
    const keys = await run('readonly', (store) => store.get('shelf')).catch(() => null);
    if (Array.isArray(keys)) return keys;
    const last = await run('readonly', (store) => store.get('last')).catch(() => null);
    if (!last?.key) return [];
    await run('readwrite', (store) => {
        store.put(last, 'book:' + last.key);
        store.put([last.key], 'shelf');
        return store.delete('last');
    }).catch(() => {});
    return [last.key];
}

/// The books kept, in their slots' order: `{ key, name, title, author,
/// cover?: { bytes, type }, bytes?: ArrayBuffer, sample?: slug }`.
export async function shelf() {
    return (await places()).filter(Boolean);
}

/// The slots as they stand, a book or null each (NanoReader's places keep
/// their numbers: a book let go leaves its place empty).
export async function places() {
    const keys = await order();
    const all = Array.from({ length: slots }, (_, at) => keys[at] || null);
    if (!keys.some(Boolean)) return all.map(() => null);
    const db = await open();
    try {
        return await new Promise((done, fail) => {
            const transaction = db.transaction('books');
            const store = transaction.objectStore('books');
            const books = all.map(() => null);
            all.forEach((key, at) => { if (!key) return; const request = store.get('book:' + key); request.onsuccess = () => { books[at] = request.result || null; }; });
            transaction.oncomplete = () => done(books);
            transaction.onerror = () => fail(transaction.error);
        });
    } catch {
        return all.map(() => null);
    } finally {
        db.close();
    }
}

/// Whether a book with this key can be kept: it is already, or a slot is free.
export async function hasRoom(key) {
    const keys = await order();
    return keys.includes(key) || keys.filter(Boolean).length < slots;
}

/// A book kept in a free slot — `at`, when that one is free, else the
/// first — or its description brought up to date in its own (its bytes
/// stay unless new ones come). False when the slots are full and it is not
/// one of them.
export async function keep(record, { at } = {}) {
    const stored = await order();
    const keys = Array.from({ length: slots }, (_, index) => stored[index] || null);
    if (!keys.includes(record.key)) {
        const free = Number.isInteger(at) && at >= 0 && at < slots && !keys[at] ? at : keys.indexOf(null);
        if (free < 0) return false;
        keys[free] = record.key;
    }
    const kept = await run('readonly', (store) => store.get('book:' + record.key)).catch(() => null);
    // A write the browser refuses (no room left, a private window's cap)
    // is said, not swallowed: the book would be open now and gone after a
    // reload with nobody told (user, 27.11.2026).
    try {
        await run('readwrite', (store) => {
            store.put({ ...(kept || {}), ...record }, 'book:' + record.key);
            return store.put(keys, 'shelf');
        });
    } catch (error) {
        throw Object.assign(new Error(error?.message || 'unkept'), { unkept: true });
    }
    return true;
}

/// A kept book's description brought up to date when it is opened again;
/// nothing for a book that is not kept.
export async function refresh(key, fields) {
    if (!(await order()).includes(key)) return;
    // A description brought up to date; its bytes are kept already.
    await keep({ key, ...fields }).catch(() => {});
}

/// A book let go; the ones after it move up a slot — or, with `hole`, its
/// slot stays empty (NanoReader's numbered places).
export async function forget(key, { hole = false } = {}) {
    const keys = hole ? (await order()).map((kept) => (kept === key ? null : kept)) : (await order()).filter((kept) => kept && kept !== key);
    await run('readwrite', (store) => {
        store.delete('book:' + key);
        return store.put(keys, 'shelf');
    }).catch(() => {});
}
