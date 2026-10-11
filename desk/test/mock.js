// in-memory stand-in for the claude.ai db + downloads capabilities, seeded from desk-data.json
(() => {
  const docs = new Map(Object.entries(window.__SEED || {}));
  const subs = [];
  const snapOf = coll => { const pre = coll + "/"; const ds = [...docs].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, v]) => ({ id: k.slice(pre.length), data: () => structuredClone(v), exists: true })); return { docs: ds, docChanges: () => ds.map(d => ({ type: "added", doc: d })) }; };
  const notify = path => { const coll = path.split("/").slice(0, -1).join("/"); subs.filter(s => s.coll === coll).forEach(s => setTimeout(() => s.cb(snapOf(coll)), window.__DELAY || 0)); };
  const db = {
    collection: coll => ({ limit() { return this; }, onSnapshot(cb) { const s = { coll, cb }; subs.push(s); setTimeout(() => cb(snapOf(coll)), (window.__DELAY || 0) * (coll.endsWith("tables") ? 3 : 1)); return () => subs.splice(subs.indexOf(s), 1); }, get: async () => snapOf(coll) }),
    doc: path => ({ get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), set: async v => { docs.set(path, structuredClone(v)); notify(path); }, delete: async () => { docs.delete(path); notify(path); } }),
  };
  window.claude = { use: async n => n === "db" ? db : n === "downloads" ? { save: async () => {} } : null };
})();
