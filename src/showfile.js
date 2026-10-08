// A saved show, as one .arenashow file: the whole room as JSON, then the files
// it needs carried along untouched (the song, the video on the screens), so a
// show opens anywhere exactly as it was saved.
//
//   8 bytes  magic: ARSHOW2\0 (ARSHOW1\0 is the first format: one song, no list)
//   4 bytes  the JSON's length, little-endian
//   JSON     { kind: 'creative-arena-show', version: 2, parts: [{ key, name, type, size }...], ...state }
//   bytes    each part's bytes, one after another, in the order the list gives
const MAGIC2 = 'ARSHOW2\0', MAGIC1 = 'ARSHOW1\0';
const KIND = 'creative-arena-show';

// state: anything JSON can hold. files: { key: File|Blob } (missing ones are skipped)
export async function writeShowFile(state, files = {}) {
  const parts = [], blobs = [];
  for (const [key, f] of Object.entries(files)) {
    if (!f) continue;
    parts.push({ key, name: f.name || key, type: f.type || 'application/octet-stream', size: f.size });
    blobs.push(f);
  }
  const json = new TextEncoder().encode(JSON.stringify({ kind: KIND, version: 2, ...state, parts }));
  const head = new Uint8Array(12);
  for (let i = 0; i < 8; i++) head[i] = MAGIC2.charCodeAt(i);
  new DataView(head.buffer).setUint32(8, json.length, true);
  return new Blob([head, json, ...blobs], { type: 'application/octet-stream' });
}

// -> { state, files: { key: File } }. Reads the first format too: its song
// comes back as files.audio and its fields (bank, markers...) as they were.
export async function readShowFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  const magic = String.fromCharCode(...bytes);
  if (magic !== MAGIC2 && magic !== MAGIC1) throw new Error('Not a saved show file');
  const jlen = new DataView(buf).getUint32(8, true);
  const state = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jlen)));
  if (state.kind !== KIND) throw new Error('Not a saved show file');
  const files = {};
  let at = 12 + jlen;
  if (magic === MAGIC1) {
    files.audio = new File([buf.slice(at)], state.audioName || 'song', { type: state.audioType || 'audio/mpeg' });
  } else {
    for (const p of state.parts || []) {
      files[p.key] = new File([buf.slice(at, at + p.size)], p.name, { type: p.type });
      at += p.size;
    }
  }
  return { state, files };
}

// a show waiting for the page to come back in another venue: kept in
// IndexedDB, which (unlike localStorage) holds a file of any size
const DB = 'arena-showfile', STORE = 'pending';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function keepPendingShow(file) {
  const d = await db();
  await new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(file, 'show');
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  d.close();
}
// the waiting show, taken out (so it opens once), or null
export async function takePendingShow() {
  try {
    const d = await db();
    const file = await new Promise((res) => {
      const tx = d.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const g = st.get('show');
      g.onsuccess = () => { st.delete('show'); res(g.result || null); };
      g.onerror = () => res(null);
    });
    d.close();
    return file;
  } catch (_) {
    return null;
  }
}
