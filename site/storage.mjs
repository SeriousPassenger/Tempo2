/** IndexedDB adapter. Read-modify-write occurs within one serialized transaction. */
import {newProfile, applyAction, snapshot, history, exportProfile, importProfile, csvExport, uid} from './engine.mjs';

export class TempoStorage {
  constructor(factory = globalThis.indexedDB, scope = new URL('.', import.meta.url).pathname) {
    this.factory = factory; this.name = `tempo-v2:${scope}`; this.db = null;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(this.name) : null;
    this.onchange = () => {};
    if (this.channel) this.channel.onmessage = () => this.onchange();
  }
  async open() {
    if (this.db) return;
    if (!this.factory) throw new Error('This browser does not provide IndexedDB. Open Tempo in a current browser with site storage enabled.');
    this.db = await new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('profiles', {keyPath: 'id'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Tempo tabs, then reload to finish updating storage.'));
    });
    this.db.onversionchange = () => { this.db.close(); this.db = null; this.onchange(); };
    // The empty-check and first profile insertion share one readwrite transaction.
    await this.transaction('readwrite', (store, done) => {
      const request = store.count();
      request.onsuccess = () => {
        if (!request.result) store.add(newProfile());
        done();
      };
    });
  }
  transaction(mode, work) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Local storage is not ready. Reload and try again.'));
      const tx = this.db.transaction('profiles', mode);
      let result, failure;
      const abort = error => { failure = error; try { tx.abort(); } catch {} };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('The local save was cancelled.'));
      tx.onerror = () => { failure ||= tx.error; };
      try { work(tx.objectStore('profiles'), value => { result = value; }, abort); }
      catch (error) { abort(error); }
    });
  }
  changed() { this.channel?.postMessage('changed'); }
  async list() {
    return this.transaction('readonly', (store, done) => {
      const result = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return done(result.sort((a, b) => a.created_at - b.created_at));
        const p = cursor.value;
        result.push({id: p.id, name: p.name, created_at: p.created_at, revision: p.revision}); cursor.continue();
      };
    });
  }
  async read(id) {
    return this.transaction('readonly', (store, done, abort) => {
      const request = store.get(id);
      request.onsuccess = () => request.result ? done(request.result) : abort(new Error('This profile no longer exists. Choose another profile.'));
    });
  }
  async mutate(id, data, key = uid()) {
    const result = await this.transaction('readwrite', (store, done, abort) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const p = request.result;
          if (!p) throw new Error('This profile no longer exists.');
          const result = applyAction(p, data, key);
          store.put(p); done(result);
        } catch (error) { abort(error); }
      };
    });
    this.changed(); return result;
  }
  async create(name) {
    const p = newProfile(name);
    await this.insert(p); return p.id;
  }
  async insert(profile) {
    await this.transaction('readwrite', (store, done, abort) => {
      const request = store.count();
      request.onsuccess = () => {
        if (request.result >= 25) return abort(new Error('This browser can hold up to 25 local profiles.'));
        store.add(profile); done(profile.id);
      };
    });
    this.changed();
  }
  async import(backup, options = {}) {
    const p = importProfile(backup);
    if (!options.replaceId) { await this.insert(p); return p.id; }
    await this.transaction('readwrite', (store, done, abort) => {
      const request = store.get(options.replaceId);
      request.onsuccess = () => {
        const current = request.result;
        if (!current || current.name !== options.confirm) return abort(new Error('Type the current profile name exactly to replace it.'));
        if (current.revision !== options.expectedRevision) return abort(new Error('This profile changed in another tab. Export it again and review the import.'));
        p.id = current.id; p.created_at = current.created_at; p.revision = current.revision + 1;
        store.put(p); done();
      };
    });
    this.changed(); return p.id;
  }
  async state(id) { return snapshot(await this.read(id)); }
  async history(id, trackerId) { return history(await this.read(id), trackerId); }
  async export(id) { return exportProfile(await this.read(id)); }
  async csv(id) { return csvExport(await this.read(id)); }
}
