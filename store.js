// The last book, kept in the browser so a reload or the next visit goes on
// where the reader stopped: the file itself (IndexedDB holds a Blob), its
// name and title. One book — this reader keeps no shelf.

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

/// `{ key, name, title, bytes?: ArrayBuffer, sample?: slug }`.
export const keepLast = (record) => run('readwrite', (store) => store.put(record, 'last')).catch(() => {});
export const lastBook = () => run('readonly', (store) => store.get('last')).catch(() => null);
export const forgetLast = () => run('readwrite', (store) => store.delete('last')).catch(() => {});
