// ===== Train map: pure helpers (no DOM, no ArcGIS) =====
const MapCore = (() => {
  const R = 6378137;
  const toMerc = ([lon, lat]) => { const la = Math.max(Math.min(lat, 85.05112878), -85.05112878); return [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360))]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const TZ_OFF = { AT: -60, ET: 0, CT: 60, MT: 120, PT: 180 };   // minutes to add to local time to get Eastern
  const toMin = s => { const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(v => v !== "")) rows.push(row); row = []; }
      else f += c;
    }
    row.push(f); if (row.some(v => v !== "")) rows.push(row);
    const head = (rows.shift() || []).map(h => h.trim());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
  }

  // "Daily except Saturday and Sunday" -> Set of weekday numbers (0 = Sunday); null = every day / unknown
  function parseDays(text) {
    const s = String(text || "").toLowerCase();
    if (!s || /^daily$/.test(s.trim())) return null;
    const named = d => DAYS.map((n, i) => [n.toLowerCase(), i]).filter(([n]) => new RegExp("\\b" + n + "s?\\b").test(d)).map(([, i]) => i);
    // "Monday through Friday", "Mon. thru Sat.": every day in the range
    const rg = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*(?:through|thru|to|-|–)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/);
    if (rg && !/except/.test(s)) { const ab = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], a = ab.indexOf(rg[1]), b = ab.indexOf(rg[2]); const out = new Set(); for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; } named(s).forEach(i => out.add(i)); return out.size === 7 ? null : out; }
    if (/except/.test(s)) { const [, ex] = s.split(/except/); const out = new Set([0, 1, 2, 3, 4, 5, 6]); named(ex).forEach(i => out.delete(i)); return out; }
    if (/only/.test(s) || named(s).length) { const n = named(s); return n.length ? new Set(n) : null; }
    if (/weekdays?/.test(s)) return new Set([1, 2, 3, 4, 5]);
    return null;
  }

  // Timetable Desk export rows -> trains with absolute Eastern minutes
  function tripsFromExport(rows) {
    const by = new Map();
    for (const r of rows) {
      if (!r.train_id || !r.station_id) continue;
      const k = (r.source || "") + "|" + r.train_id;
      if (!by.has(k)) by.set(k, { key: k, id: r.train_id, section: r.section || "", base: r.section ? String(r.train_id).replace(/\s*\([^)]*\)\s*$/, "") : r.train_id, color: /^#[0-9a-f]{6}$/i.test(r.rr_color || "") ? r.rr_color : "", lineNames: String(r.lines || "").split(/[;\n]+/).map(x => x.trim()).filter(Boolean), source: r.source || "", sourceDate: r.source_date || "", rr: r.rr || "", rrName: r.railroad || "", no: r.train_no || "", name: r.train_name || "", alsoCalled: r.also_called || "", freq: r.frequency || "", consist: r.consist || "", notes: r.train_notes || "", tables: new Set(), status: r.status || "", from: r.continues_from || "", to: r.continues_as || "", stops: [] });
      const t = by.get(k); (r.tables || "").split(/;\s*/).filter(Boolean).forEach(x => t.tables.add(x));
      t.stops.push({ seq: +r.stop_sequence || t.stops.length + 1, sid: r.station_id, name: r.station || r.station_id, town: r.city || "", state: r.state || "", arr: r.arrival || "", dep: r.departure || "", tz: r.tz || "ET", mark: r.mark || "", markMeaning: r.mark_meaning || "", notes: r.stop_notes || "", shared: r.stop_section === "shared", sdays: r.stop_days || "" });
    }
    const out = [];
    for (const t of by.values()) {
      t.stops.sort((a, b) => a.seq - b.seq);
      t.stops = t.stops.filter(s => toMin(s.arr) != null || toMin(s.dep) != null);
      if (t.stops.length < 2) continue;
      // stations entered top-to-bottom for a train that reads upward: times run backwards, so flip
      const seq = t.stops.flatMap(s => [s.arr, s.dep].filter(x => toMin(x) != null).map(x => toMin(x) + (TZ_OFF[s.tz] ?? 0)));
      let up = 0, down = 0; for (let i = 1; i < seq.length; i++) { if (seq[i] > seq[i - 1]) up++; else if (seq[i] < seq[i - 1]) down++; }
      t.reversed = down > up;
      if (t.reversed) t.stops.reverse();
      unroll(t);
      t.days = parseDays(t.freq);
      for (const s of t.stops) s.daySet = s.sdays ? parseDays(s.sdays) : null;   // days this stop is made (its own calendar day)
      t.tables = [...t.tables];
      out.push(t);
    }
    return out;
  }
  // absolute Eastern minutes from midnight of the day the train leaves its first station
  function unroll(t) {
    let prev = null, add = 0;
    const step = (hhmm, tz) => { const m = toMin(hhmm); if (m == null) return null; let et = m + (TZ_OFF[tz] ?? 0) + add; if (prev != null && et < prev - 5) { add += 1440; et += 1440; } prev = et; return et; };
    for (const s of t.stops) { s.arrAbs = step(s.arr, s.tz); s.depAbs = step(s.dep, s.tz); if (s.arrAbs == null) s.arrAbs = s.depAbs; if (s.depAbs == null) s.depAbs = s.arrAbs; }
    // a minute's stop at every regular station given one time, so trains visibly pause (not at "on signal" / "on notice" stops)
    const flag = s => /on signal|on notice|notice to (the )?(agent|conductor)/i.test(s.markMeaning || "");
    for (let i = 1; i < t.stops.length - 1; i++) {
      const s = t.stops[i], p = t.stops[i - 1];
      if (s.arrAbs != null && s.depAbs != null && s.depAbs - s.arrAbs < 1 && !flag(s)) s.arrAbs = Math.max(s.depAbs - 1, p.depAbs + (s.depAbs - p.depAbs) / 2);
    }
    const base = Math.floor(t.stops[0].depAbs / 1440) * 1440;   // e.g. first time in Central time before midnight Eastern
    for (const s of t.stops) { s.arrAbs -= base; s.depAbs -= base; }
    t.start = t.stops[0].depAbs; t.end = t.stops[t.stops.length - 1].arrAbs;
  }

  // ---------- served-by matching ----------
  const STOP = /\b(the|railroad|railway|railways|rail|road|company|corporation|corp|transportation|co|inc|lines?|system)\b/g;
  const normRR = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z ]/g, " ").replace(STOP, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
  function servedBy(served, rrName, rrAbbrev) {
    if (!served) return false;
    const want = normRR(rrName); if (!want && !rrAbbrev) return false;
    const ab = String(rrAbbrev || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const inside = (short, long) => short.split(" ").length >= 2 && (" " + long + " ").includes(" " + short + " ");
    return String(served).split(/[;,/]/).some(part => {
      const p = normRR(part); if (!p) return false;
      if (ab && part.toLowerCase().replace(/[^a-z0-9]/g, "") === ab) return true;
      return want && (p === want || inside(p, want) || inside(want, p));
    });
  }
  // nearest "S1970Nov"-style field to a date; fields: [{name, alias}]
  const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function fieldDate(f) {
    const s = f.name + " " + (f.alias || "");
    let m = s.match(/S(\d{4})([A-Za-z]{3})/); if (m && MON.includes(m[2].toLowerCase())) return +m[1] * 12 + MON.indexOf(m[2].toLowerCase());
    m = (f.alias || "").match(/(\d{4})\s*-\s*([A-Za-z]{3})/); if (m && MON.includes(m[2].toLowerCase())) return +m[1] * 12 + MON.indexOf(m[2].toLowerCase());
    m = f.name.match(/Served_([A-Za-z]{3})(\d{2})/); if (m && MON.includes(m[1].toLowerCase())) return (1900 + +m[2]) * 12 + MON.indexOf(m[1].toLowerCase());
    // month name then year, e.g. "Served by - April 1971" or Served_by_April_1971
    m = s.match(/\b([A-Za-z]{3})[a-z]*[\s_\-]*(\d{4})\b/); if (m && MON.includes(m[1].toLowerCase())) return +m[2] * 12 + MON.indexOf(m[1].toLowerCase());
    m = s.match(/_([A-Za-z]{3})[a-z]*_*(\d{4})/); if (m && MON.includes(m[1].toLowerCase())) return +m[2] * 12 + MON.indexOf(m[1].toLowerCase());
    return null;
  }
  function servedField(fields, iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})/); if (!m) return null;
    const want = +m[1] * 12 + +m[2] - 1;
    let best = null; for (const f of fields) { const d = fieldDate(f); if (d == null) continue; const gap = Math.abs(d - want) + (d > want ? 0.5 : 0); if (!best || gap < best.gap) best = { name: f.name, alias: f.alias, gap }; }
    return best;
  }

  // ---------- rail network ----------
  // lines: [{paths: [[[lon,lat],...]], attrs}] ; each edge remembers its line
  function buildNetwork(lines, opts = {}) {
    const step = opts.densify ?? 400, join = opts.join ?? 600, cell = 2000;
    const nodes = [], adj = [], key = new Map();
    const nodeOf = p => { const k = Math.round(p[0]) + "," + Math.round(p[1]); if (key.has(k)) return key.get(k); const id = nodes.length; nodes.push(p); adj.push([]); key.set(k, id); return id; };
    const segs = [];
    const link = (a, b, li) => { if (a === b) return; const d = dist(nodes[a], nodes[b]); adj[a].push([b, d, li]); adj[b].push([a, d, li]); if (li >= 0) segs.push([a, b, li]); };
    const ends = [];
    lines.forEach((ln, li) => {
      for (const path of ln.paths) {
        const m = path.map(toMerc); if (m.length < 2) continue;
        let prev = nodeOf(m[0]); ends.push([prev, li]);
        for (let i = 1; i < m.length; i++) {
          const a = m[i - 1], b = m[i], n = Math.max(1, Math.ceil(dist(a, b) / step));
          for (let j = 1; j <= n; j++) { const cur = nodeOf([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); link(prev, cur, li); prev = cur; }
        }
        ends.push([prev, li]);
      }
    });
    // where two different lines cross (or one runs into the middle of another) without sharing a point, add a junction
    { const sg = new Map(), done = new Set(); let added = 0;
      segs.forEach((sgm, k) => { const a = nodes[sgm[0]], b = nodes[sgm[1]];
        for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
          for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) { const kk = x + ":" + y; if (!sg.has(kk)) sg.set(kk, []); sg.get(kk).push(k); } });
      for (const list of sg.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const s1 = segs[list[i]], s2 = segs[list[j]]; if (s1[2] === s2[2]) continue;
        if (s1[0] === s2[0] || s1[0] === s2[1] || s1[1] === s2[0] || s1[1] === s2[1]) continue;
        const pk = list[i] < list[j] ? list[i] + "," + list[j] : list[j] + "," + list[i]; if (done.has(pk)) continue; done.add(pk);
        const p = nodes[s1[0]], r = [nodes[s1[1]][0] - p[0], nodes[s1[1]][1] - p[1]], q = nodes[s2[0]], v = [nodes[s2[1]][0] - q[0], nodes[s2[1]][1] - q[1]];
        const den = r[0] * v[1] - r[1] * v[0]; if (Math.abs(den) < 1e-9) continue;
        const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den, u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const X = nodeOf([p[0] + t * r[0], p[1] + t * r[1]]);
        for (const e of [s1[0], s1[1]]) link(X, e, s1[2]); for (const e of [s2[0], s2[1]]) link(X, e, s2[2]); added++;
      }
      opts.stats && (opts.stats.crossings = added); }
    const net = { nodes, adj, cell, grid: new Map(), lines };
    nodes.forEach((p, i) => { const k = gk(net, p); if (!net.grid.has(k)) net.grid.set(k, []); net.grid.get(k).push(i); });
    // close small gaps where a line ends near another line
    for (const [e, li] of ends) {
      if (adj[e].length > 1) continue;
      const local = new Set([e]); let fr = [e];
      for (let h = 0; h < 4; h++) { const nf = []; for (const f of fr) for (const [x] of adj[f]) if (!local.has(x)) { local.add(x); nf.push(x); } fr = nf; }
      const cand = nearestNodes(net, nodes[e], join).find(n => !local.has(n));
      if (cand !== undefined) link(e, cand, -1);
    }
    net.comp = components(net);
    return net;
  }
  function components(net) {
    const comp = new Int32Array(net.nodes.length).fill(-1); let c = 0;
    for (let i = 0; i < net.nodes.length; i++) { if (comp[i] !== -1) continue; const st = [i]; comp[i] = c; while (st.length) { const u = st.pop(); for (const [v] of net.adj[u]) if (comp[v] === -1) { comp[v] = c; st.push(v); } } c++; }
    return comp;
  }
  const gk = (net, p) => Math.floor(p[0] / net.cell) + ":" + Math.floor(p[1] / net.cell);
  function nearestNodes(net, p, maxD) {
    const r = Math.ceil(maxD / net.cell), cx = Math.floor(p[0] / net.cell), cy = Math.floor(p[1] / net.cell), out = [];
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (const i of net.grid.get(x + ":" + y) || []) { const d = dist(p, net.nodes[i]); if (d <= maxD) out.push([i, d]); }
    return out.sort((a, b) => a[1] - b[1]).map(a => a[0]);
  }
  // nearest node on each separate piece of network within maxD
  function candidates(net, p, maxD) {
    const out = [], seen = new Set();
    for (const id of nearestNodes(net, p, maxD)) { const k = net.comp[id]; if (seen.has(k)) continue; seen.add(k); out.push({ id, d: dist(p, net.nodes[id]), comp: k }); }
    return out;
  }
  function closestBreak(net, ca, cb, a, b) {
    const comps = new Set(cb.map(c => c.comp));
    const pad = 20000, x0 = Math.min(a[0], b[0]) - pad, x1 = Math.max(a[0], b[0]) + pad, y0 = Math.min(a[1], b[1]) - pad, y1 = Math.max(a[1], b[1]) + pad;
    let best = null;
    for (const c of ca) for (let i = 0; i < net.nodes.length; i++) {
      if (net.comp[i] !== c.comp || net.adj[i].length > 1) continue;   // breaks are at line ends
      const p = net.nodes[i]; if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
      for (const j of nearestNodes(net, p, 15000)) { if (!comps.has(net.comp[j])) continue; const d = dist(p, net.nodes[j]); if (!best || d < best.d) best = { d, at: [(p[0] + net.nodes[j][0]) / 2, (p[1] + net.nodes[j][1]) / 2] }; break; }
    }
    if (best) best.d *= Math.cos(Math.atan(Math.sinh(best.at[1] / R)));   // map metres to ground metres
    return best;
  }
  // A* with per-line cost factor (>= 1), so straight-line distance stays a valid estimate
  // limit: only look at points whose distance to both ends adds up to no more than this (an ellipse around the two stations),
  // so a search can't wander over the whole continent when the lines nearby cost extra
  function route(net, s, t, factor, limit = Infinity) {
    if (s === t) return { ids: [s], lines: [], steps: [] };
    const start = net.nodes[s];
    const n = net.nodes.length, G = new Float64Array(n).fill(Infinity), P = new Int32Array(n).fill(-1), PL = new Int32Array(n).fill(-2);
    const goal = net.nodes[t], h = i => dist(net.nodes[i], goal);
    const heap = [[h(s), s]]; G[s] = 0; let pops = 0;
    const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const fcache = new Map(); const fac = li => { if (!fcache.has(li)) fcache.set(li, li < 0 ? 1.5 : factor(li)); return fcache.get(li); };
    while (heap.length) {
      const [f, u] = pop(); if (u === t) break; if (f - h(u) > G[u] + 1e-6) continue;
      if (++pops > 4e6) return { tooBig: true };
      for (const [v, w, li] of net.adj[u]) { const g = G[u] + w * fac(li); if (g < G[v]) { if (limit < Infinity && G[v] === Infinity && dist(start, net.nodes[v]) + h(v) > limit) continue; G[v] = g; P[v] = u; PL[v] = li; push([g + h(v), v]); } }
    }
    if (G[t] === Infinity) return null;
    const ids = [], used = new Set(), steps = []; for (let u = t; u !== -1; u = P[u]) { ids.push(u); if (PL[u] >= 0) used.add(PL[u]); if (P[u] !== -1) steps.push([P[u], u, PL[u]]); }
    return { ids: ids.reverse(), lines: [...used], steps };
  }

  // stations: Map StationID -> {lon, lat, name}; lineFactor(rrName, rr) -> (lineIndex) -> factor
  function prepareTrips(trips, stations, net, lineFactor, opts = {}) {
    const maxSnap = opts.maxSnap ?? 3000;
    const legCache = new Map(), missing = new Map(), warnings = [];
    const out = [];
    for (const t of trips) {
      const ok = t.stops.filter(s => { const st = stations.get(s.sid); if (!st) { missing.set(s.sid, s.name); return false; } s.st = st; s.p = toMerc([st.lon, st.lat]); return true; });
      if (ok.length < 2) continue;
      const trip = { ...t, stops: ok, legs: [] };
      const fac = net ? lineFactor(t.rrName, t.rr, t) : null;
      for (let i = 0; i < ok.length - 1; i++) {
        const a = ok[i], b = ok[i + 1];
        const ck = (t.rrName || t.rr) + "|" + (t.lineNames || []).join(";") + "|" + a.sid + "|" + b.sid;
        let geom = legCache.get(ck);
        if (!geom) {
          let pts = null, used = [], why = "", fix = "", at = null, long = false;
          // modern trains bring their own track geometry (the feed's shapes), so no routing is needed
          const own = opts.legs?.get(a.sid + ">" + b.sid);
          if (own) pts = [a.p, ...own, b.p];
          else if (net) {
            const ca = candidates(net, a.p, maxSnap), cb = candidates(net, b.p, maxSnap);
            let best = null;
            for (const x of ca) for (const y of cb) if (x.comp === y.comp && (!best || x.d + y.d < best[0].d + best[1].d)) best = [x, y];
            if (best) {
              const sd = dist(net.nodes[best[0].id], net.nodes[best[1].id]);
              const r = route(net, best[0].id, best[1].id, fac, sd * 5 + 25000);
              if (r && r.tooBig) { why = "the route search between them gave up (too large an area to search)"; fix = "Tell Claude: this is a map problem, not a data problem."; }
              else if (r) {
                const via = r.ids.map(k => net.nodes[k]); const len = via.reduce((s, p, k) => k ? s + dist(via[k - 1], p) : 0, 0);
                // length of the route on lines this train's railroad served (or the lines picked for it in the Desk)
                const own = r.steps.reduce((s, [u, v, li]) => s + (li >= 0 && fac && fac(li) <= 1 ? dist(net.nodes[u], net.nodes[v]) : 0), 0);
                if (len < dist(a.p, b.p) * 3 + 8000) { pts = [a.p, ...via, b.p]; used = r.lines; }
                else if (own >= len * 0.8) { pts = [a.p, ...via, b.p]; used = r.lines; long = true; }   // a roundabout route, but on the railroad's own lines: trust it
                else { why = "the only rail route found is a long detour over other railroads' lines"; fix = "Check for a missing or broken line between these stations, or fill in “Served by” on the lines this train used."; at = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2]; }
              } else { why = "no connected rail line between them"; fix = "Check the lines layer between these stations for a gap."; }
            } else if (!ca.length || !cb.length) {
              const far = !ca.length ? a : b; why = `${far.name} is more than ${maxSnap / 1000} km from any line`; fix = `Move the ${far.name} station point onto its line, or add the missing line.`; at = far.p;
            } else {
              const br = closestBreak(net, ca, cb, a.p, b.p);
              why = "the lines near these two stations don't join up" + (br ? ` (the nearest break is about ${br.d >= 1000 ? (br.d / 1000).toFixed(1) + " km" : Math.round(br.d) + " m"} wide, marked on the map with an orange ring)` : "");
              fix = "In the lines layer, extend or snap the line ends so they meet at the marked spot (gaps under 600 m are closed automatically)."; at = br ? br.at : null;
            }
          }
          const straight = !pts; if (!pts) pts = [a.p, b.p];
          let snap = "";
          if (straight && net) { const nm = p => { const c = candidates(net, p, maxSnap)[0]; if (!c) return "no line within reach"; const li = (net.adj[c.id].find(e => e[2] >= 0) || [])[2]; const ln = net.lines[li]; return `${(ln && (ln.attrs.Name || ln.attrs.NAME)) || "line " + li} (${Math.round(c.d * Math.cos(Math.atan(Math.sinh(p[1] / R))))} m away)`; };
            snap = `${a.name} attaches to ${nm(a.p)}; ${b.name} attaches to ${nm(b.p)}`; }
          const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
          geom = { pts, cum, len: cum[cum.length - 1], straight, used, long, why, fix, at, snap, fromName: a.name, toName: b.name, trains: new Set() };
          if (why) warnings.push(`${a.name} → ${b.name}: ${why}`);
          legCache.set(ck, geom);
        }
        geom.trains.add(t.id);
        trip.legs.push({ from: a, to: b, t0: a.depAbs, t1: b.arrAbs, ...geom });
      }
      trip.start = ok[0].depAbs; trip.end = ok[ok.length - 1].arrAbs;
      out.push(trip);
    }
    return { trips: out, legs: [...legCache.values()], missing: [...missing].map(([id, name]) => ({ id, name })), warnings: [...new Set(warnings)] };
  }

  // t: minutes into the selected day (Eastern). runsOn(trip, daysBack) says if the run that left `daysBack` days ago operates.
  // point `d` metres along a leg
  function pointAt(L, d) {
    d = Math.max(0, Math.min(L.len, d));
    let k = 1; while (k < L.cum.length - 1 && L.cum[k] < d) k++;
    const a = L.pts[k - 1], b = L.pts[k], seg = L.cum[k] - L.cum[k - 1], g = seg > 0 ? (d - L.cum[k - 1]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
  }
  // last stop a run actually makes: where a stop's own days leave out the day the train gets there, the run ends at the stop before
  // depDay: weekday (0 = Sunday) the run left its first station
  function lastStopFor(trip, depDay, from = 0) {
    if (depDay == null) return trip.stops.length - 1;
    for (let k = from + 1; k < trip.stops.length; k++) {
      const s = trip.stops[k]; if (!s.daySet) continue;
      const day = (((depDay + Math.floor(s.arrAbs / 1440)) % 7) + 7) % 7;
      if (!s.daySet.has(day)) return k - 1;
    }
    return trip.stops.length - 1;
  }
  // first stop a run actually makes: on days the opening stops aren't made (e.g. New Orleans–Birmingham only Mon/Wed/Fri),
  // the run starts at the first stop whose own days include the day the train is there
  function firstStopFor(trip, depDay) {
    if (depDay == null) return 0;
    for (let k = 0; k < trip.stops.length - 1; k++) {
      const s = trip.stops[k]; if (!s.daySet) return k;
      const day = (((depDay + Math.floor(s.depAbs / 1440)) % 7) + 7) % 7;
      if (s.daySet.has(day)) return k;
    }
    return trip.stops.length - 1;
  }
  // t: minutes into the selected day (Eastern). runsOn(trip, daysBack) says if the run that left `daysBack` days ago operates.
  // opts.depDay(back): weekday that run left (for stop days); opts.span: metres either side used to smooth the heading
  function positionAt(trip, t, runsOn = () => true, opts = {}) {
    for (const back of [0, 1, 2]) {
      const tt = t + back * 1440;
      if (tt < trip.start - 0.01 || tt > trip.end + 0.01) continue;
      if (!runsOn(trip, back)) continue;
      const dd = opts.depDay ? opts.depDay(back) : null;
      const startIdx = firstStopFor(trip, dd), endIdx = lastStopFor(trip, dd, startIdx);
      if (endIdx <= startIdx || tt > trip.stops[endIdx].arrAbs + 0.01) continue;
      if (startIdx > 0 && tt < trip.stops[startIdx].depAbs - 15) continue;   // shown at its first stop 15 minutes before it leaves
      const s0 = trip.stops[startIdx];
      if (tt <= s0.depAbs) return { ...atStation(trip, startIdx, back), startIdx, endIdx };
      for (let i = startIdx; i < endIdx; i++) {
        const L = trip.legs[i];
        if (tt < L.t1) {
          const f = L.t1 > L.t0 ? (tt - L.t0) / (L.t1 - L.t0) : 1, target = f * L.len;
          const [x, y] = pointAt(L, target);
          // heading from a little behind to a little ahead, so small kinks in the line don't make the symbol twitch when zoomed out
          const sp = Math.max(20, Math.min(opts.span || 0, L.len / 2));
          const a = pointAt(L, target - sp), b = pointAt(L, target + sp);
          return { x, y, angle: Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI, status: "moving", leg: i, back, endIdx };
        }
        if (tt <= L.to.depAbs || i + 1 === endIdx) return { ...atStation(trip, i + 1, back), endIdx };
      }
    }
    return null;
  }
  function atStation(trip, idx, back = 0) {
    const s = trip.stops[idx], L = trip.legs[Math.min(idx, trip.legs.length - 1)];
    let a, b;
    if (idx < trip.legs.length) { a = L.pts[0]; b = L.pts.find(q => dist(q, a) > 20) || L.pts[L.pts.length - 1]; }
    else { b = L.pts[L.pts.length - 1]; a = [...L.pts].reverse().find(q => dist(q, b) > 20) || L.pts[0]; }
    return { x: s.p[0], y: s.p[1], angle: Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI, status: "at", stop: idx, back };
  }

  const fmtClock = m => { m = ((Math.floor(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
  const fmt12 = s => { const m = toMin(s); return m == null ? "" : fmtClock(m); };


  // ---------- modern timetables: a GTFS feed -> rows shaped like a Timetable Desk export ----------
  // t: { agency, routes, trips, stop_times, stops, calendar, calendar_dates, feed_info } as arrays of row objects (parseCSV)
  // opts.week: Date (local midnight) of the Monday the week starts; opts.match(stop) -> {sid, name, town, state}
  const TZ_ABBR = { "America/New_York": "ET", "America/Toronto": "ET", "America/Montreal": "ET", "America/Detroit": "ET", "America/Indiana/Indianapolis": "ET",
    "America/Chicago": "CT", "America/Winnipeg": "CT", "America/Denver": "MT", "America/Phoenix": "MT", "America/Edmonton": "MT", "America/Los_Angeles": "PT", "America/Vancouver": "PT", "America/Halifax": "AT", "America/Moncton": "AT" };
  const p2 = n => String(n).padStart(2, "0");
  const WEEKNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function daysText(set) {
    const on = [0, 1, 2, 3, 4, 5, 6].filter(d => set.has(d)), order = [1, 2, 3, 4, 5, 6, 0];
    const join = a => a.length === 1 ? a[0] : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
    if (on.length === 7) return "Daily";
    if (on.length === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return "Monday through Friday";
    if (on.length >= 5) return "Daily except " + join(order.filter(d => !set.has(d)).map(d => WEEKNAMES[d]));
    return join(order.filter(d => set.has(d)).map(d => WEEKNAMES[d])) + " only";
  }
  const gDate = s => { const m = String(s || "").match(/^(\d{4})(\d{2})(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const ymd = d => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  // the span of dates a feed covers (feed_info, else its calendar)
  function gtfsRange(t) {
    const fi = (t.feed_info || [])[0];
    let a = gDate(fi?.feed_start_date), b = gDate(fi?.feed_end_date);
    if (!a || !b) for (const c of t.calendar || []) { const x = gDate(c.start_date), y = gDate(c.end_date); if (x && (!a || x < a)) a = x; if (y && (!b || y > b)) b = y; }
    if (!a || !b) for (const c of t.calendar_dates || []) { const x = gDate(c.date); if (x && (!a || x < a)) a = x; if (x && (!b || x > b)) b = x; }
    return { start: a, end: b };
  }
  function gtfsToRows(t, opts) {
    const week = [...Array(7)].map((_, i) => new Date(opts.week.getFullYear(), opts.week.getMonth(), opts.week.getDate() + i));
    const keys = week.map(ymd);
    // which weekdays of that week each service runs
    const svc = new Map();
    for (const c of t.calendar || []) { const set = new Set(); week.forEach((d, i) => { if (keys[i] >= c.start_date && keys[i] <= c.end_date && c[WEEKNAMES[d.getDay()].toLowerCase()] === "1") set.add(d.getDay()); }); svc.set(c.service_id, set); }
    for (const c of t.calendar_dates || []) { const i = keys.indexOf(c.date); if (i < 0) continue; if (!svc.has(c.service_id)) svc.set(c.service_id, new Set()); const set = svc.get(c.service_id); if (c.exception_type === "1") set.add(week[i].getDay()); else if (c.exception_type === "2") set.delete(week[i].getDay()); }
    const agencies = new Map((t.agency || []).map(a => [a.agency_id || "", a])); const firstAg = (t.agency || [])[0] || {};
    const isRail = opts.isRail || (rt => rt === "2" || (+rt >= 100 && +rt <= 117));
    const routes = new Map((t.routes || []).filter(r => isRail(r.route_type)).map(r => [r.route_id, r]));
    const trips = new Map((t.trips || []).filter(x => routes.has(x.route_id) && (svc.get(x.service_id)?.size)).map(x => [x.trip_id, x]));
    const stopsById = new Map((t.stops || []).map(x => [x.stop_id, x]));
    const parentOf = x => (x?.parent_station && stopsById.get(x.parent_station)) || x;
    const st = new Map(); for (const r of t.stop_times || []) { if (!trips.has(r.trip_id)) continue; if (!st.has(r.trip_id)) st.set(r.trip_id, []); st.get(r.trip_id).push(r); }
    const hm = v => { const m = String(v || "").match(/^(\d+):(\d{2})/); return m ? `${p2(+m[1] % 24)}:${m[2]}` : ""; };
    // the same train (number + stops + times) on several services is one train running on all their days
    const groups = new Map();
    for (const [id, tr] of trips) {
      const list = (st.get(id) || []).sort((a, b) => +a.stop_sequence - +b.stop_sequence); if (list.length < 2) continue;
      const route = routes.get(tr.route_id), ag = agencies.get(route.agency_id || "") || firstAg;
      const no = (tr.trip_short_name || "").trim() || id;
      const sig = [ag.agency_name, no, ...list.map(r => `${parentOf(stopsById.get(r.stop_id))?.stop_id}@${r.arrival_time}/${r.departure_time}`)].join("|");
      if (!groups.has(sig)) groups.set(sig, { tr, route, ag, no, list, days: new Set() });
      for (const d of svc.get(tr.service_id)) groups.get(sig).days.add(d);
    }
    // a number used for several different runs in the week gets its days added to tell them apart
    const byNo = new Map(); for (const g of groups.values()) { const k = g.ag.agency_name + "|" + g.no; byNo.set(k, (byNo.get(k) || 0) + 1); }
    const fi = (t.feed_info || [])[0];
    const source = opts.source || `${firstAg.agency_name || "Modern"} timetable (GTFS), week of ${opts.week.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    const rows = [];
    for (const g of groups.values()) {
      const abbr = opts.abbr?.(g.ag) || g.ag.agency_name; const freq = daysText(g.days);
      const id = `${abbr} ${g.no}` + (byNo.get(g.ag.agency_name + "|" + g.no) > 1 ? ` (${freq})` : "");
      const tz = TZ_ABBR[g.ag.agency_timezone] || "ET";
      const color = /^[0-9a-f]{6}$/i.test(g.route.route_color || "") ? "#" + g.route.route_color : "";
      g.list.forEach((r, i) => {
        const raw = stopsById.get(r.stop_id), stop = parentOf(raw), m = opts.match(stop);
        const last = i === g.list.length - 1, first = i === 0;
        const arr = hm(r.arrival_time), dep = hm(r.departure_time);
        // pickup / drop-off rules become the same kind of marks the Guide uses
        const pu = r.pickup_type || "0", dr = r.drop_off_type || "0";
        const mm = first || last ? ["", ""] : (pu === "1" && dr !== "1") ? ["d", "Stops only to discharge passengers"] : (dr === "1" && pu !== "1") ? ["r", "Stops only to receive passengers"] : (pu === "3" || dr === "3" || pu === "2" || dr === "2") ? ["f", "Stops only on signal or notice"] : ["", ""];
        rows.push({ source, source_date: `${opts.week.getFullYear()}-${p2(opts.week.getMonth() + 1)}-${p2(opts.week.getDate())}`, railroad: g.ag.agency_name, rr: abbr, tables: g.route.route_long_name || g.route.route_short_name || "",
          train_id: id, train_no: g.no, train_name: g.route.route_long_name || g.tr.trip_headsign || "", frequency: freq, stop_sequence: String(i + 1),
          station_id: m.sid, station: m.name, city: m.town || "", state: m.state || "",
          arrival: first ? "" : (last || arr !== dep ? arr : ""), departure: last ? "" : dep, tz, stop_frequency: freq, mark: mm[0], mark_meaning: mm[1], rr_color: color, status: "Complete", lines: "", shape_id: g.tr.shape_id || "" });
      });
    }
    return { rows, source, trains: groups.size, range: gtfsRange(t), feedVersion: fi?.feed_version || "" };
  }
  return { gtfsToRows, gtfsRange, daysText, firstStopFor, toMerc, TZ_OFF, toMin, DAYS, parseCSV, parseDays, tripsFromExport, normRR, servedBy, servedField, buildNetwork, route, prepareTrips, positionAt, lastStopFor, fmtClock, fmt12 };
})();
if (typeof module !== "undefined") module.exports = MapCore;
