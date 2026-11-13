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

/// The books kept, in their slots: `{ key, name, title, author, cover?:
/// { bytes, type }, bytes?: ArrayBuffer, sample?: slug }`.
export async function shelf() {
    const keys = await order();
    if (!keys.length) return [];
    const db = await open();
    try {
        return await new Promise((done, fail) => {
            const transaction = db.transaction('books');
            const store = transaction.objectStore('books');
            const books = [];
            keys.forEach((key, at) => { const request = store.get('book:' + key); request.onsuccess = () => { books[at] = request.result; }; });
            transaction.oncomplete = () => done(books.filter(Boolean));
            transaction.onerror = () => fail(transaction.error);
        });
    } catch {
        return [];
    } finally {
        db.close();
    }
}

/// Whether a book with this key can be kept: it is already, or a slot is free.
export async function hasRoom(key) {
    const keys = await order();
    return keys.includes(key) || keys.length < slots;
}

/// A book kept in the first free slot, or its description brought up to
/// date in its own (its bytes stay unless new ones come). False when the
/// slots are full and it is not one of them.
export async function keep(record) {
    const keys = await order();
    if (!keys.includes(record.key)) {
        if (keys.length >= slots) return false;
        keys.push(record.key);
    }
    const kept = await run('readonly', (store) => store.get('book:' + record.key)).catch(() => null);
    await run('readwrite', (store) => {
        store.put({ ...(kept || {}), ...record }, 'book:' + record.key);
        return store.put(keys, 'shelf');
    }).catch(() => {});
    return true;
}

/// A kept book's description brought up to date when it is opened again;
/// nothing for a book that is not kept.
export async function refresh(key, fields) {
    if (!(await order()).includes(key)) return;
    await keep({ key, ...fields });
}

/// A book let go; the ones after it move up a slot.
export async function forget(key) {
    const keys = (await order()).filter((kept) => kept !== key);
    await run('readwrite', (store) => {
        store.delete('book:' + key);
        return store.put(keys, 'shelf');
    }).catch(() => {});
}
