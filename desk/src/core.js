// ===== Timetable Desk: pure helpers (no DOM) =====
const Core = (() => {
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stationId = oid => "STN-" + pad(oid, 5);

  // "March 3, 1971" | "Sept. 24, 1944" | "April 1971" -> {iso, precision} or null
  function parseMonthDate(text) {
    const s = String(text || "").trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
    const m = s.match(/^([a-z]+) (?:(\d{1,2}) )?(\d{4})$/);
    if (!m) return null;
    const mi = MONTHS.indexOf(m[1].slice(0, 3));
    if (mi < 0 || m[1].length < 3) return null;
    const day = m[2] ? +m[2] : 1;
    const dim = new Date(Date.UTC(+m[3], mi + 1, 0)).getUTCDate();
    if (day < 1 || day > dim) return null;
    return { iso: `${m[3]}-${pad(mi + 1)}-${pad(day)}`, precision: m[2] ? "day" : "month" };
  }
  const guideName = (iso) => { const [y, mo] = iso.split("-"); return `Official Guide ${MON_SHORT[+mo - 1]} ${y}`; };

  // One time: "735" "0735" "7:35" "17:20" "735p" "1205a" "noon" "night" -> "HH:MM" or null
  function parseTime(t) {
    let s = String(t || "").trim().toLowerCase();
    if (!s) return null;
    if (/^(12\s*)?noon$/.test(s)) return "12:00";
    if (/^(12\s*)?(mid)?night$/.test(s)) return "00:00";
    let ap = null;
    const apm = s.match(/^(.*?)\s*([ap])\.?m?\.?$/);
    if (apm && /\d$/.test(apm[1])) { ap = apm[2]; s = apm[1].trim(); }
    let h, mi, m;
    if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) { h = +m[1]; mi = +m[2]; }
    else if ((m = s.match(/^(\d{1,2})(\d{2})$/))) { h = +m[1]; mi = +m[2]; }
    else if (ap && (m = s.match(/^(\d{1,2})$/))) { h = +m[1]; mi = 0; }   // "11 am", "7p"
    else return null;
    if (mi > 59) return null;
    if (ap) { if (h < 1 || h > 12) return null; if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0; }
    if (h > 23) return null;
    return `${pad(h)}:${pad(mi)}`;
  }

  // A grid cell as printed: "735", "1115/1135" (arr/dep), "735f" (reference mark), "—" (does not stop)
  // -> {empty} | {pass:true} | {arr, dep, single, mark} | {error}
  // a time typed with no am/pm that could be either (528, 5:28, 1215; not 0528 or 1935)
  function ambiguousTime(part) {
    const m = String(part || "").trim().match(/^([1-9]|1[0-2]):?(\d{2})$/);
    return m && +m[2] < 60 ? +m[1] : 0;
  }
  // am or pm, whichever comes next on the clock after `after` (HH:MM); with nothing to go by, am
  function resolveAmPm(h, mi, after) {
    const am = (h % 12) * 60 + mi, pm = am + 720;
    if (!after) return am;
    const a = +after.slice(0, 2) * 60 + +after.slice(3, 5), fwd = x => (x - a + 1440) % 1440;
    return fwd(pm) < fwd(am) ? pm : am;
  }
  const hhmm = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
  // `after`: the train's time at the stop before (24-hour), used to settle times typed without am/pm
  function parseCell(text, after) {
    let s = String(text || "").trim();
    if (!s) return { empty: true };
    if (/^[-–—]+$/.test(s)) return { pass: true };
    // "Arr. 930 p", "arr 930p", "ar 930p", "Lv. 645a", "lve 645 a f", or the word after the time ("930p arr") = arrives / leaves only
    const AR = "ar(?:r(?:ives?)?)?\\.?", LV = "(?:lv|lve|leaves?|dep(?:arts?)?)\\.?";
    const kw = s.match(new RegExp(`^(${AR}|${LV})\\s*(\\d.*)$`, "i")) || ((m => m && [m[0], m[2], m[1]])(s.match(new RegExp(`^(\\d.*?)\\s+(${AR}|${LV})$`, "i"))));
    if (kw) {
      const isArr = new RegExp(`^${AR}$`, "i").test(kw[1]), q = parseCell(kw[2], after);
      if (q.error || q.empty || q.pass) return q.error ? q : { error: "Type a time after Arr. or Lv." };
      if (!q.single) return { error: "Use one time with Arr. or Lv." };
      return isArr ? { arr: q.dep, dep: "", single: false, mark: q.mark } : { arr: "", dep: q.dep, single: false, mark: q.mark };
    }
    // "735/" = arrives only; "/735" = departs only (a mark may follow: "735/ f", "/735f")
    let only = "";
    const ao = s.match(/^([^/|]*\d[^/|]*?)\s*[\/|]\s*(\D\S*)?$/);
    if (ao && !/^\s*$/.test(ao[1])) { only = "arr"; s = (ao[1] + (ao[2] ? " " + ao[2] : "")).trim(); }
    else if (/^[\/|]\s*\d/.test(s)) { only = "dep"; s = s.replace(/^[\/|]\s*/, ""); }
    if (only) {
      const q = parseCell(s, after);
      if (q.error || q.empty || q.pass) return q.error ? q : { error: "Type a time before or after the slash" };
      if (!q.single) return { error: "Use one time with the slash: 735/ for arrives only" };
      return only === "arr" ? { arr: q.dep, dep: "", single: false, mark: q.mark } : { arr: "", dep: q.dep, single: false, mark: q.mark };
    }
    let mark = "";
    // several marks where one of them is a, m or p (e.g. Manassas "122 al" = marks a and l; "122p a l" = 1:22 pm, marks a and l).
    // After a space, a group of marks containing a/m/p is all marks, unless its first word is just am/pm ("122 a l" = 1:22 am, mark l).
    // A letter right against the digits stays am/pm ("122al" = 1:22 am, mark l).
    {
      const g = s.match(/^(.*\d(?:[ap]\.?(?:m\.?)?)?(?:\s+[ap]\.?m\.?(?=\s))?)\s+([^\d\/|:]+)$/i);
      if (g && /[apm]/i.test(g[2]) && !/^(noon|(mid)?night)\b/i.test(g[2].trim())) {
        const toks = g[2].split(/[\s,]+/).filter(Boolean);
        const isAmPm = w => /^[ap]\.?(m\.?)?$/i.test(w);
        const hasAmPm = /[ap]\.?(m\.?)?$/i.test(g[1].replace(/\d+$/, "x"));
        if (toks.length && !(toks.length === 1 && isAmPm(toks[0]) && !hasAmPm)) {
          const timePart = !hasAmPm && isAmPm(toks[0]) ? g[1] + " " + toks.shift() : g[1];
          if (toks.length && (toks.length > 1 || toks[0].length > 1 || hasAmPm)) { const q = parseCell(timePart, after); if (!q.error && !q.empty && !q.pass && q.single !== undefined) return { ...q, mark: [q.mark, ...toks].filter(Boolean).join(" ") }; }
        }
      }
    }
    // reference marks: trailing letters other than a/p (am/pm), or symbols like * † ‡ § ¶ ◆
    const mm = /^(12\s*)?(noon|(mid)?night)$/i.test(s) ? null : s.match(/^(.*?\d(?:\s*[ap]\.?m?\.?)?)\s*((?:(?![aAmMpP])[^\d\s\/|:.,\-–—])+(?:[\s,]+(?:(?![aAmMpP])[^\d\s\/|:.,\-–—])+)*)$/); // any letter or symbol except a, m, p (taken by am/pm)
    if (mm) { s = mm[1]; mark = mm[2].replace(/[\s,]+/g, " ").trim(); }   // several marks: "735 f†", "735 f u", "735 f, †"
    else {
      // a mark that is itself a, m or p: it must come after an am/pm letter, e.g. "453 p a", "453pa", "4:53 pm a", "1115/1135p a"
      const ma = s.match(/^(.*\d\s*(?:[ap]\.?m\.?|[ap]\.?))\s*([aAmMpP])$/) || s.match(/^(.*\d\s*(?:[ap]\.?m\.?|[ap]\.?))\s+(\S+)$/);
      if (ma && !/\d\s*[ap]\.?m\.?$/i.test(s) && !/^(12\s*)?(noon|(mid)?night)$/i.test(s)) { s = ma[1]; mark = ma[2]; }
    }
    const parts = s.split(/\s*[\/|]\s*/);
    if (parts.length > 2) return { error: "Use one time, or arrival/departure like 1115/1135" };
    let times = parts.map(parseTime);
    const amb = parts.map(ambiguousTime);
    // "1:15/1:35 pm": a suffix on one side applies to the other, if that keeps arrival before departure
    if (parts.length === 2) {
      const suf = parts.map(x => (x.match(/\d\s*([ap])\.?m?\.?$/i) || [])[1]);
      for (const [a, b] of [[0, 1], [1, 0]]) if (!suf[a] && suf[b] && times[a]) {
        const alt = parseTime(parts[a] + suf[b]);
        if (alt) { const tt = times.slice(); tt[a] = alt; if (tt[0] <= tt[1] || a === 1) { times = tt; amb[a] = 0; } }
      }
    }
    // no am/pm: take whichever comes next after the time before (the stop before, or this stop's arrival)
    for (let i = 0; i < times.length; i++) if (amb[i] && times[i]) {
      const mi = +times[i].slice(3, 5);
      times[i] = hhmm(resolveAmPm(amb[i], mi, i === 0 ? after : times[0]));
    }
    if (times.some(x => !x)) return { error: "Times look like 735, 0735, 7:35, 735p, noon or night" };
    if (times.length === 2) return { arr: times[0], dep: times[1], single: false, mark };
    return { arr: "", dep: times[0], single: true, mark };
  }
  function formatCell(st) {
    if (!st) return "";
    if (st.pass) return "—";
    let t = st.single ? (st.dep || st.arr) : (st.arr && st.dep ? `${st.arr}/${st.dep}` : (st.dep || st.arr));
    return (t || "") + (st.mark || "");
  }
  // 24-hour "19:35" -> "7:35 pm" for display (saved times stay 24-hour)
  function fmt12(hhmm) {
    if (!hhmm) return "";
    let h = +hhmm.slice(0, 2); const m = hhmm.slice(3, 5); const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12; return `${h}:${m} ${ap}`;
  }
  function formatCell12(st) {
    if (!st) return "";
    if (st.pass) return "—";
    let t;
    if (!st.single && st.arr && st.dep) {
      const a = fmt12(st.arr), d = fmt12(st.dep);
      t = a.slice(-2) === d.slice(-2) ? `${a.slice(0, -3)}/${d}` : `${a}/${d}`;
    } else if (!st.single && st.arr && !st.dep) t = fmt12(st.arr) + "/";     // arrives only
    else t = fmt12(st.single ? (st.dep || st.arr) : (st.dep || st.arr));
    return t + (st.mark ? " " + st.mark : "");
  }
  const isPM = hhmm => hhmm && +hhmm.slice(0, 2) >= 12;

  // Effective arrival/departure. A single printed time is the leaving time,
  // except at the train's final stop, where it is the arrival.
  function effectiveTimes(stops) {
    const live = stops.filter(s => !s.pass && (s.arr || s.dep));
    const first = live[0], last = live[live.length - 1];
    return stops.map(s => {
      if (s.pass) return { arr: "", dep: "" };
      // a train can't leave its last stop or arrive at its first: one time there is the arrival / the departure
      if (s === last && s !== first && (s.single || !s.arr)) return { arr: s.dep || s.arr, dep: "" };
      if (s === first && s !== last && !s.dep) return { arr: "", dep: s.arr };
      return { arr: s.arr || "", dep: s.dep || "" };
    });
  }

  // Station search: every query word must start a word of the station's name, town or state.
  function buildIndex(rows) {
    return rows.map(([oid, name, town, state, tz, served, lon, lat]) => {
      const id = typeof oid === "string" ? oid : stationId(oid);
      const label = `${name} (${town ? town + ", " : ""}${state})`.replace(" ()", "");
      const words = (name + " " + town + " " + state).toLowerCase().replace(/[()\-–,.\/&']/g, " ").split(/\s+/).filter(Boolean);
      return { id, oid, name, town, state, tz, served: served || {}, lon, lat, label, words, nameLc: name.toLowerCase() };
    });
  }
  // served-by value whose date is closest to the source date (only fields that have a value)
  function servedNear(st, isoDate) {
    const keys = Object.keys(st?.served || {}).filter(k => st.served[k]);
    if (!keys.length) return null;
    const d = Date.parse(isoDate || "1971-01-01");
    keys.sort((a, b) => Math.abs(Date.parse(a + "-01") - d) - Math.abs(Date.parse(b + "-01") - d));
    const [y, m] = keys[0].split("-");
    return { key: keys[0], label: `${MON_SHORT[+m - 1]} ${y}`, value: st.served[keys[0]] };
  }
  // header of a served-by column -> "YYYY-MM": "1970 - November - Served By", "S1966Mar", "Served_Nov70"
  function servedKey(h) {
    const FULL = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    let m = String(h).trim().match(/^(\d{4})\s*-\s*([A-Za-z]+)\s*-\s*served by$/i);
    if (m) { const i = FULL.indexOf(m[2].toLowerCase()); return i < 0 ? null : `${m[1]}-${pad(i + 1)}`; }
    m = String(h).trim().match(/^S(\d{4})([A-Za-z]{3})$/);
    if (m) { const i = MONTHS.indexOf(m[2].toLowerCase()); return i < 0 ? null : `${m[1]}-${pad(i + 1)}`; }
    m = String(h).trim().match(/^Served_([A-Za-z]{3})(\d{2})$/);
    if (m) { const i = MONTHS.indexOf(m[1].toLowerCase()); return i < 0 ? null : `19${m[2]}-${pad(i + 1)}`; }
    return null;
  }
  function search(index, q, limit = 12) {
    const qs = String(q || "").toLowerCase().replace(/[()\-–,.\/&']/g, " ").split(/\s+/).filter(Boolean);
    if (!qs.length) return [];
    const out = [];
    for (const st of index) {
      let ok = true, score = 0;
      for (const w of qs) {
        const i = st.words.findIndex(x => x.startsWith(w));
        if (i < 0) { ok = false; break; }
        score += i === 0 ? 3 : (x => x)(1);
        if (st.words[i] === w) score += 1;
      }
      if (!ok) continue;
      if (st.nameLc.startsWith(qs.join(" "))) score += 5;
      out.push([score, st]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || a[1].label.localeCompare(b[1].label));
    return out.slice(0, limit).map(x => x[1]);
  }

  const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const toCSV = (header, rows) => [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

  // Minimal CSV parser (for importing a station list exported from ArcGIS)
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = []; let f = ""; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(v => v !== "")) rows.push(row); row = []; }
      else f += c;
    }
    row.push(f); if (row.some(v => v !== "")) rows.push(row);
    return rows;
  }
  // -> station rows [oid, name, town, state, tz] from an ArcGIS CSV export
  function stationsFromCSV(text) {
    const rows = parseCSV(text); if (rows.length < 2) throw new Error("The file has no rows");
    const h = rows[0].map(x => x.trim().toLowerCase());
    const col = (...names) => { for (const n of names) { const i = h.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
    // ArcGIS exports use field aliases ("Station Name", "City/Town", "Time Zone") or field names ("Name", "Town", "TZ")
    const iId = col("StationID"), iOid = col("OBJECTID", "FID"), iName = col("Name", "Station Name", "Station", "StationName"), iTown = col("Town", "City/Town", "City"), iState = col("State"), iTz = col("TZ", "Time Zone"), iX = col("x", "Longitude"), iY = col("y", "Latitude");
    if (iName < 0 || (iId < 0 && iOid < 0)) throw new Error("The file needs a Name column and a StationID or OBJECTID column");
    const sCols = rows[0].map((hh, i) => [servedKey(hh), i]).filter(([k]) => k);
    return rows.slice(1).map(r => {
      let oid = iId >= 0 ? parseInt(String(r[iId]).replace(/\D/g, ""), 10) : parseInt(r[iOid], 10);
      const served = {}; for (const [k, i] of sCols) { const v = (r[i] || "").trim(); if (v) served[k] = v; }
      const lon = iX >= 0 ? parseFloat(r[iX]) : NaN, lat = iY >= 0 ? parseFloat(r[iY]) : NaN;
      return [oid, (r[iName] || "").trim(), iTown >= 0 ? (r[iTown] || "").trim() : "", iState >= 0 ? (r[iState] || "").trim() : "", iTz >= 0 ? (r[iTz] || "").trim() : "", served, Number.isFinite(lon) ? +lon.toFixed(5) : null, Number.isFinite(lat) ? +lat.toFixed(5) : null];
    }).filter(r => Number.isFinite(r[0]) && r[1]);
  }


  // ----- one train across several tables -----
  const toMin = hhmm => hhmm ? (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(3, 5)) : null;
  // raw sort time of a stop as entered (a single printed time is a leaving time)
  const rawTime = s => s.pass ? null : toMin(s.arr || s.dep);
  // groups: [{key, stops}] in table order. Returns {stops, conflicts}; each merged stop keeps
  // .from = [group keys]. Same station at the same time (±1 min) on two tables is one stop;
  // same station at different times is reported as a conflict (the first table's times are kept).
  // tzOff(stop) -> minutes to add to local time to get Eastern time (CT +60, MT +120, PT +180, AT -60)
  function mergeStops(groups, tzOff = () => 0) {
    let merged = []; const conflicts = [];
    for (const g of groups) {
      // unroll this table's times past midnight, comparing on one clock so a time-zone change isn't read as midnight
      let add = 0, prev = null;
      const seq = g.stops.filter(s => s.stationId).map((s, i) => {
        let t = rawTime(s);
        if (t != null) { t += tzOff(s); if (prev != null && t + add < prev - 5) add += 1440; t += add; prev = t; }
        return { s, t, i };
      });
      // align this table's day with what is already merged, using a shared station if there is one
      let off = 0;
      const shared = seq.find(x => x.t != null && merged.some(m => m.gi !== groups.indexOf(g) && m.s.stationId === x.s.stationId && m.t != null));
      if (shared) { const m = merged.find(m => m.s.stationId === shared.s.stationId && m.t != null); off = Math.round((m.t - shared.t) / 1440) * 1440; }
      else if (merged.length) {
        const mt = merged.filter(m => m.t != null).map(m => m.t), gt = seq.filter(x => x.t != null).map(x => x.t);
        if (mt.length && gt.length) {
          const mF = Math.min(...mt), mL = Math.max(...mt), gF = Math.min(...gt), gL = Math.max(...gt);
          let best = 0, bestGap = Infinity;
          for (const o of [-1440, 0, 1440]) { const gap = Math.min(Math.abs(gF + o - mL), Math.abs(mF - (gL + o))); if (gap < bestGap) { bestGap = gap; best = o; } }
          off = best;
        }
      }
      const gi = groups.indexOf(g);
      // an arrival-only time on one table and a departure-only time on another are the two halves of one stop
      // (arriving 1:50, leaving 2:10), not times that disagree; the arrival must come first
      const halves = (m, s, t) => {
        if (m.t == null || t == null) return false;
        const mA = m.s.arr && !m.s.dep, mD = m.s.dep && !m.s.arr, sA = s.arr && !s.dep, sD = s.dep && !s.arr;
        if (mA && sD) return t >= m.t && t - m.t < 360;
        if (mD && sA) return m.t >= t && m.t - t < 360;
        return false;
      };
      for (const x of seq) {
        const t = x.t == null ? null : x.t + off;
        // only stops from other tables are matched up: a station listed twice on one table (in and out of a junction, or arr. and lve. rows) is two stops
        const same = merged.find(m => m.gi !== gi && m.s.stationId === x.s.stationId && (m.t == null || t == null || Math.abs(m.t - t) <= 1 ||
          (x.s.arr && m.s.arr && Math.abs(toMin(x.s.arr) - toMin(m.s.arr)) <= 1) || (x.s.dep && m.s.dep && Math.abs(toMin(x.s.dep) - toMin(m.s.dep)) <= 1) || halves(m, x.s, t)));
        if (same) {
          const a = same.s, b = x.s;
          // one table printing a single time that matches the other's arrival or departure agrees with it
          // (e.g. 3:15 on one table, 3:15 arr / 3:30 dep on another): keep the fuller entry
          const one = s => !!s.single || !!(s.arr) !== !!(s.dep), times = s => [s.arr, s.dep].filter(Boolean);
          const near = (u, v) => Math.abs(toMin(u) - toMin(v)) <= 1;
          if (one(a) && !one(b) && times(a).length === 1 && times(b).some(v => near(v, times(a)[0]))) { a.arr = b.arr; a.dep = b.dep; a.single = false; }
          else if (one(b) && !one(a) && times(b).length === 1 && times(a).some(v => near(v, times(b)[0]))) { /* a already has both */ }
          const differs = (f) => a[f] && b[f] && a[f] !== b[f];
          if ((differs("arr") || differs("dep")) && !(one(b) && times(b).length === 1 && times(a).some(v => near(v, times(b)[0])))) conflicts.push({ stationId: b.stationId, keep: { arr: a.arr, dep: a.dep, from: same.from[0] }, other: { arr: b.arr, dep: b.dep, from: g.key } });
          for (const f of ["arr", "dep", "mark", "miles", "notes", "tz", "days"]) if (!a[f] && b[f]) a[f] = b[f];
          if (b._k != null) (a._ks ||= []).push(b._k);   // remember which entered stops were folded into this one
          if (a.single && (b.arr && b.dep || a.arr && a.dep && a.arr !== a.dep)) a.single = false;
          if (same.t != null && t != null && b.arr && !a.arr && t < same.t) same.t = t;
          if (!same.from.includes(g.key)) same.from.push(g.key);
          if (same.t == null) same.t = t;
          continue;
        }
        const near = merged.find(m => m.gi !== gi && m.s.stationId === x.s.stationId);
        if (near && t != null && near.t != null && Math.abs(near.t - t) < 360) { if (x.s._k != null) (near.s._ks ||= []).push(x.s._k); conflicts.push({ stationId: x.s.stationId, keep: { arr: near.s.arr, dep: near.s.dep, from: near.from[0] }, other: { arr: x.s.arr, dep: x.s.dep, from: g.key } }); continue; }
        merged.push({ s: { ...x.s }, t, from: [g.key], gi: groups.indexOf(g), i: x.i });
      }
    }
    // order: by time; stops without a time stay after the stop entered before them on the same table
    const timed = merged.filter(m => m.t != null).sort((a, b) => a.t - b.t || a.gi - b.gi || a.i - b.i);
    for (const m of merged.filter(m => m.t == null)) {
      // after the nearest earlier stop of the same table already placed (timed or not); else after the earlier tables
      let at = -1;
      timed.forEach((x, k) => { if (x.gi === m.gi && x.i < m.i) at = k; });
      if (at < 0) timed.forEach((x, k) => { if (x.gi < m.gi) at = k; });
      timed.splice(at + 1, 0, m);
    }
    return { stops: timed.map(m => ({ ...m.s, from: m.from })), conflicts };
  }

  // For each stop: which day of the run (1 = the day the train starts) its arrival and departure fall on,
  // and minutes since the train left its first stop. Uses Eastern time internally so zone changes don't
  // look like midnight; a time earlier than the one before it means the train ran past midnight.
  const TZ_OFF = { AT: -60, ET: 0, CT: 60, MT: 120, PT: 180 };
  function dayClock(times, tzOf) {
    let prev = null, add = 0, start = null; const out = [];
    const step = (hhmm, tz) => {
      if (!hhmm) return null;
      let et = toMin(hhmm) + (TZ_OFF[tz] ?? 0);
      if (prev != null && et + add < prev - 5) add += 1440;
      et += add; prev = et; if (start == null) start = et;
      const localAbs = et - (TZ_OFF[tz] ?? 0);
      return { day: Math.floor(localAbs / 1440) + 1, elapsed: et - start };
    };
    times.forEach((t, i) => { const tz = tzOf(i); const a = step(t.arr, tz), d = step(t.dep, tz); out.push({ arrDay: a?.day ?? "", depDay: d?.day ?? "", arrElapsed: a?.elapsed ?? "", depElapsed: d?.elapsed ?? "" }); });
    // days are counted from the first time's own day
    const first = out.find(x => x.depDay !== "" || x.arrDay !== ""); const base = first ? (first.depDay || first.arrDay) - 1 : 0;
    return out.map(x => ({ ...x, arrDay: x.arrDay === "" ? "" : x.arrDay - base, depDay: x.depDay === "" ? "" : x.depDay - base }));
  }
  const DEFAULT_MARKS = [
    { mark: "b", meaning: "Stops only on notice to conductor to discharge passengers" },
    { mark: "d", meaning: "Stops only to discharge passengers" },
    { mark: "f", meaning: "Stops only on signal to receive or discharge passengers" },
    { mark: "r", meaning: "Stops only to receive passengers" },
    { mark: "s", meaning: "Stops Sundays only" },
  ];
  function marksFromNotes(text) {
    const out = [];
    for (const line of String(text || "").split(/\n/)) {
      const m = line.match(/^\s*((?:[A-Za-z]|[^\w\s\-–—:.,])(?:[A-Za-z]|[^\w\s\-–—:.,])?)\s*[-–—:.]\s*(.+?)\s*$/);
      if (m && !out.some(x => x.mark === m[1])) out.push({ mark: m[1], meaning: m[2].replace(/\s+/g, " ") });
    }
    return out;
  }
  const trainNoSort = (a, b) => { const na = parseInt(a, 10), nb = parseInt(b, 10); return (isNaN(na) ? 1e9 : na) - (isNaN(nb) ? 1e9 : nb) || String(a).localeCompare(String(b)); };

  const tableNoSort = (a, b) => { const A = String(a ?? "").trim(), B = String(b ?? "").trim(); const k = s => !s ? 2 : /^\d/.test(s) ? 1 : 0; return k(A) - k(B) || A.localeCompare(B, undefined, { numeric: true, sensitivity: "base" }); };
  // one standard wording for days: "Mondays, Wednesdays, and Fridays" / "Mon. Wed. Fri." -> "Monday, Wednesday and Friday only";
  // all weekdays -> "Monday through Friday"; six days -> "Daily except Sunday". Anything else (dates, "Alternate days ...") is left as typed.
  const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const DAYRE = /^(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(day)?s?$|^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?$/;
  const dayIdx = w => { const m = w.match(DAYRE); if (!m) return -1; const k = (m[1] || m[3]).slice(0, 3); return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(k); };
  // same wording the Desk's day pickers use: up to three days listed ("... only"), otherwise "Daily except ...";
  // days read in week order, starting where a wrap-around run reads naturally (Saturday and Sunday, Friday through Sunday)
  const daysText = set => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    if (set.size === 7) return "Daily";
    if (set.size === 5 && [0, 1, 2, 3, 4].every(i => set.has(i))) return "Monday through Friday";
    const circ = arr => { if (arr.length < 2) return arr; const a = [...arr].sort((x, y) => x - y); let best = -1, at = 0; a.forEach((d, i) => { const g = ((a[(i + 1) % a.length] - d) + 7) % 7 || 7; if (g > best) { best = g; at = (i + 1) % a.length; } }); return [...a.slice(at), ...a.slice(0, at)]; };
    const join = a => a.length === 1 ? WEEK[a[0]] : a.slice(0, -1).map(i => WEEK[i]).join(", ") + " and " + WEEK[a[a.length - 1]];
    // a run of days in a row that wraps past Sunday reads from its start (Friday, Saturday and Sunday; Sunday and Monday); otherwise Monday first
    const run = arr => arr.length > 1 && arr.every((d, i) => i === 0 || d === (arr[i - 1] + 1) % 7);
    const order = arr => { const c = circ(arr); return run(c) ? c : [...arr].sort((x, y) => x - y); };
    const on = order(all.filter(i => set.has(i))), off = order(all.filter(i => !set.has(i)));
    return on.length <= 3 ? join(on) + " only" : "Daily except " + join(off);
  };
  function normDays(text) {
    const raw = String(text ?? ""); const s = raw.trim().toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ");
    if (!s) return raw;
    if (s === "daily") return "Daily";
    const words = str => str.split(/[\s,&;]+|\band\b/).map(w => w.trim()).filter(w => w && w !== "and" && w !== "only" && w !== "inclusive");
    let m;
    if ((m = s.match(/^daily,? except (.+)$/))) { const ws = words(m[1]), ix = ws.map(dayIdx); if (!ws.length || ix.includes(-1)) return raw; return daysText(new Set([0, 1, 2, 3, 4, 5, 6].filter(i => !ix.includes(i)))); }
    if ((m = s.match(/^(\w+) (?:through|thru|to|-|–) (\w+)(?: only| inclusive)?$/))) { const a = dayIdx(m[1]), b = dayIdx(m[2]); if (a < 0 || b < 0) return raw; const set = new Set(); for (let i = a; ; i = (i + 1) % 7) { set.add(i); if (i === b) break; } return daysText(set); }
    const ws = words(s), ix = ws.map(dayIdx);
    if (!ws.length || ix.includes(-1)) return raw;
    return daysText(new Set(ix));
  }
  return { normDays, tableNoSort, fmt12, formatCell12, servedNear, servedKey, DEFAULT_MARKS, marksFromNotes, dayClock, TZ_OFF, mergeStops, toMin, pad, stationId, parseMonthDate, guideName, parseTime, parseCell, formatCell, isPM, effectiveTimes, buildIndex, search, toCSV, parseCSV, stationsFromCSV, trainNoSort, MON_SHORT };
})();
if (typeof module !== "undefined") module.exports = Core;
