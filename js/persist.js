// IndexedDB persistence for logo layers (images are too big for localStorage).

class LayerStore {
  constructor() {
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('shaderdeck', 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore('layers', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async _tx(mode, fn) {
    const db = await this.dbp;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('layers', mode);
      const out = fn(tx.objectStore('layers'));
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  put(record)  { return this._tx('readwrite', (s) => s.put(record)); }
  remove(id)   { return this._tx('readwrite', (s) => s.delete(id)); }
  clear()      { return this._tx('readwrite', (s) => s.clear()); }
  all()        { return this._tx('readonly',  (s) => s.getAll()); }
}
