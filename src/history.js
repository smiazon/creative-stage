// Undo and redo for everything you build. After each thing you do (a click,
// a slider let go, a key) the show is snapshotted, once things settle; undo
// steps back through the snapshots and redo steps forward again.
//
// main.js names the parts a snapshot holds (the triggers, the timeline, the
// show, the look on now, the room) with a get and a set for each. A step
// remembers which parts it changed, and undo puts back only those, so undoing
// a fade edit never touches the look that is playing. Changes the show makes
// on its own (a trigger firing, a cue playing) are taken in with rebase(),
// never made into steps: nobody did them.
export function initHistory({ parts, limit = 60, hold = null, onChange = null }) {
  const keys = Object.keys(parts);
  const past = [], future = [];   // [{ s: snapshot, keys: [the parts that step changed] }]
  let now = null, timer = 0, busy = false;

  // a snapshot is one JSON string per part; a part that did not change keeps
  // the last snapshot's string, so sixty slider steps hold one copy of the rest
  const read = (k) => {
    try { return JSON.stringify(parts[k].get()) ?? 'null'; }
    catch (err) { console.warn('[history] could not read', k, err); return now?.[k] ?? 'null'; }
  };
  function take(only = keys) {
    const s = { ...now };
    for (const k of only) { const j = read(k); s[k] = now && now[k] === j ? now[k] : j; }
    return s;
  }

  // a step, if anything actually changed since the last one
  function commit(force = false) {
    timer = 0;
    if (busy || !now) return;
    if (!force && hold?.()) { soon(); return; }   // a slider still held: one drag, one step
    const n = take();
    const changed = keys.filter((k) => n[k] !== now[k]);
    if (!changed.length) return;
    past.push({ s: now, keys: changed });
    if (past.length > limit) past.shift();
    now = n;
    future.length = 0;   // a new step drops the redos
    onChange?.();
  }
  // after a user action: wait for the room to settle, then snapshot
  function soon(ms = 450) {
    if (busy || !now) return;
    clearTimeout(timer);
    timer = setTimeout(commit, ms);
  }
  // an action not yet snapshotted counts before an undo
  function flush() { if (timer) { clearTimeout(timer); commit(true); } }
  // the show changed these parts by itself: take them as they stand, no step
  function rebase(only = keys) {
    if (busy || !now) return;
    now = take(only);
  }

  function go(from, to) {
    flush();
    const e = from.pop();
    if (!e) return null;
    to.push({ s: now, keys: e.keys });
    busy = true;
    try {
      for (const k of keys) {
        if (!e.keys.includes(k)) continue;
        try { parts[k].set(JSON.parse(e.s[k])); }
        catch (err) { console.warn('[history] could not put back', k, err); }
      }
    } finally { busy = false; }
    // what the room reads back after the restore is the new baseline, so a
    // late event can't take it for a fresh change and wipe the redo stack
    clearTimeout(timer); timer = 0;
    now = take();
    onChange?.();
    return e.keys;
  }

  return {
    start() { now = take(); onChange?.(); },
    // a whole new show was opened: no steps back into the one before it
    reset() { clearTimeout(timer); timer = 0; past.length = 0; future.length = 0; now = take(); onChange?.(); },
    soon, flush, rebase,
    undo: () => go(past, future),
    redo: () => go(future, past),
    get canUndo() { return past.length > 0 || !!timer; },
    get canRedo() { return future.length > 0; },
    get busy() { return busy; },
  };
}
