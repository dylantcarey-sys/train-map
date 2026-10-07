// Combine every downloaded rail feed (gtfs/*.zip) into one "modern trains" timetable for this week: gtfs/today.json.gz
// Uses the map's own GTFS converter (map-core.js) so the trains look exactly as they would loaded one at a time.
// Run after fetch_gtfs.py:  node scripts/build_today.js
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const JSZip = require(process.env.JSZIP || "jszip");
const C = require("./map-core.js");
const DIR = path.join(__dirname, "..", "gtfs");

// short names shown on the map (by agency name); anything else gets its initials
const ABBR = [[/amtrak/i, "Amtrak"], [/metro-?north/i, "MNR"], [/long island/i, "LIRR"], [/nj transit|new jersey transit/i, "NJT"], [/septa|southeastern pennsylvania/i, "SEPTA"],
  [/mbta|massachusetts bay/i, "MBTA"], [/^metra$/i, "Metra"], [/maryland/i, "MARC"], [/virginia railway/i, "VRE"], [/via rail/i, "VIA"], [/go transit/i, "GO"], [/^exo/i, "exo"],
  [/caltrain|peninsula corridor/i, "Caltrain"], [/metrolink/i, "Metrolink"], [/altamont/i, "ACE"], [/sonoma/i, "SMART"], [/north county|coaster/i, "COASTER"], [/sound transit/i, "Sounder"],
  [/tri-rail|south florida/i, "Tri-Rail"], [/sunrail/i, "SunRail"], [/brightline/i, "Brightline"], [/utah transit/i, "FrontRunner"], [/dallas area|dart/i, "DART"], [/trinity metro|texrail/i, "TEXRail"],
  [/regional transportation district|^rtd/i, "RTD"], [/trimet/i, "WES"], [/path|port authority trans/i, "PATH"], [/south shore|northern indiana/i, "South Shore"], [/shore line east/i, "SLE"],
  [/connecticut|ctrail|hartford/i, "CTrail"], [/capitol corridor/i, "Capitol Corridor"], [/wego|nashville/i, "WeGo Star"], [/alaska railroad/i, "ARR"], [/rio metro|rail runner/i, "Rail Runner"]];
// Douglas-Peucker on [lon, lat] points (tolerance in degrees, about 20 m)
function simplify(pts, tol = 0.0002) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); const [ax, ay] = pts[i], [bx, by] = pts[j]; const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = -1, bd = 0;
    for (let k = i + 1; k < j; k++) { const [px, py] = pts[k]; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey; if (d > bd) { bd = d; best = k; } }
    if (best > 0 && bd > tol * tol) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const abbr = ag => (ABBR.find(([re]) => re.test(ag.agency_name || "")) || [])[1] || (ag.agency_name || "").split(/\s+/).map(w => w[0]).join("").toUpperCase();

// the Monday of this week in Eastern time
const etToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).split("-").map(Number);
const week = new Date(etToday[0], etToday[1] - 1, etToday[2]); week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
const weekText = week.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

(async () => {
  const man = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
  // Amtrak first so a train that also appears in a partner's feed (Capitol Corridor, Hartford Line, Cascades) is kept once, as Amtrak
  const feeds = [...man.feeds].sort((a, b) => (b.name === "Amtrak") - (a.name === "Amtrak"));
  const stops = {}, trains = [], seen = new Set(), report = [], legs = {};
  for (const fd of feeds) {
    const file = path.join(DIR, fd.file); if (!fs.existsSync(file)) { report.push(`${fd.name}: file missing`); continue; }
    try {
      const zip = await JSZip.loadAsync(fs.readFileSync(file)); const t = {};
      for (const n of ["agency", "routes", "trips", "stop_times", "stops", "calendar", "calendar_dates", "feed_info"]) { const f = zip.file(new RegExp(`(^|/)${n}\\.txt$`))[0]; t[n] = f ? C.parseCSV(await f.async("string")) : []; }
      const key = fd.file.replace(/\.zip$/, "");
      // the feed's track shapes, to draw each train along its real route
      const shapes = new Map(); const sf = zip.file(/(^|\/)shapes\.txt$/)[0];
      if (sf) { for (const r of C.parseCSV(await sf.async("string"))) { if (!shapes.has(r.shape_id)) shapes.set(r.shape_id, []); shapes.get(r.shape_id).push([+r.shape_pt_sequence, +r.shape_pt_lon, +r.shape_pt_lat]); }
        for (const [k, a] of shapes) shapes.set(k, a.sort((x, y) => x[0] - y[0]).map(x => [x[1], x[2]])); }
      const match = s => { const sid = `${key}:${s.stop_id}`; if (!stops[sid]) stops[sid] = [s.stop_name || s.stop_id, +(+s.stop_lon).toFixed(5), +(+s.stop_lat).toFixed(5)]; return { sid, name: s.stop_name || s.stop_id }; };
      const res = C.gtfsToRows(t, { week, match, abbr, source: "x", isRail: () => true });   // fetch_gtfs.py already kept only the rail routes
      const by = new Map(); for (const r of res.rows) { if (!by.has(r.train_id)) by.set(r.train_id, []); by.get(r.train_id).push(r); }
      let kept = 0, dup = 0;
      for (const [id, rs] of by) {
        const a = rs[0], z = rs[rs.length - 1], pt = sid => stops[sid].slice(1).map(v => v.toFixed(2)).join(",");
        const sig = `${pt(a.station_id)}@${a.departure}>${pt(z.station_id)}@${z.arrival}|${a.frequency}`;
        if (seen.has(sig)) { dup++; continue; } seen.add(sig); kept++;
        // cut the train's shape at each stop (searching forward along it) and keep one geometry per station pair
        const shp = shapes.get(a.shape_id);
        if (shp && shp.length > 1) {
          let from = 0; const idx = rs.map(r => { const [, lon, lat] = stops[r.station_id]; let bi = from, bd = Infinity; for (let k = from; k < shp.length; k++) { const d = (shp[k][0] - lon) ** 2 + (shp[k][1] - lat) ** 2; if (d < bd) { bd = d; bi = k; } } from = bi; return bd < 0.0004 ? bi : -1; });   // within ~2 km
          for (let k = 0; k < rs.length - 1; k++) { const lk = rs[k].station_id + ">" + rs[k + 1].station_id; if (legs[lk] || idx[k] < 0 || idx[k + 1] < 0 || idx[k + 1] < idx[k]) continue;
            const seg = simplify(shp.slice(idx[k], idx[k + 1] + 1)); legs[lk] = seg.slice(1, -1).flatMap(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]); }
        }
        trains.push([a.rr, a.railroad, a.train_no, id, a.train_name, a.tables, a.frequency, a.rr_color, a.tz, rs.map(r => [r.station_id, r.arrival, r.departure, r.mark])]);
      }
      report.push(`${fd.name}: ${kept} trains${dup ? `, ${dup} already in another feed` : ""}`);
    } catch (e) { report.push(`${fd.name}: FAILED ${e.message}`); }
  }
  const used = new Set(trains.flatMap(t => t[9].map(s => s[0])));
  for (const k of Object.keys(stops)) if (!used.has(k)) delete stops[k];
  const out = { legs, week: `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`, weekText, built: new Date().toISOString(), stops, trains };
  const gz = zlib.gzipSync(JSON.stringify(out), { level: 9 });
  fs.writeFileSync(path.join(DIR, "today.json.gz"), gz);
  man.today = { file: "today.json.gz", week: out.week, weekText, trains: trains.length, railroads: new Set(trains.map(t => t[0])).size, kb: Math.round(gz.length / 1024), report };
  fs.writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(man, null, 1));
  console.log(report.join("\n")); console.log(`${trains.length} trains, ${Object.keys(stops).length} stops, ${Object.keys(legs).length} track pieces, ${Math.round(gz.length / 1024)} KB`);
})();
