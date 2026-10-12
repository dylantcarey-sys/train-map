import json

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md("""
# Rail lines check

Checks the **Historic_Passenger_Lines** and **Historic_Passenger_Stations** layers, the same way the train map reads them, and suggests "Served by" values from your Timetable Desk export.

Run the cells in order with **Shift+Enter**. Nothing in your layers changes until Step 8, and only if you switch `DRY_RUN` off there.

| Step | What it does | Changes data? |
|---|---|---|
| 1 | Settings | no |
| 2 | Sign in and open the layers | no |
| 3 | Read every line and station | no |
| 4 | Pick the "Served by" field for your timetable's date | no |
| 5 | Find line ends that come close to another line but don't touch | no |
| 6 | Find stations too far from any line | no |
| 7 | Suggest "Served by" values from the Desk export | no |
| 8 | Write the suggestions to the lines layer (with a backup first) | **yes**, if `DRY_RUN = False` |
| 9 | Undo step 8 from the backup | **yes** |
""")

md("""
## Step 1 · Settings
Change these only if something below says so. `DESK_CSV` is the file you downloaded with **Export CSV** in the Timetable Desk and uploaded in the notebook's **Files** pane (into `/arcgis/home`).
""")
code('''
LINES_URL    = "https://services8.arcgis.com/rd2DawKbk2tfv3gN/arcgis/rest/services/Historic_Passenger_Lines/FeatureServer/0"
STATIONS_URL = "https://services8.arcgis.com/rd2DawKbk2tfv3gN/arcgis/rest/services/Historic_Passenger_Stations/FeatureServer/0"
DESK_CSV     = "/arcgis/home/timetable.csv"   # the Desk's Export CSV, uploaded in the Files pane
TIMETABLE_DATE = "1971-04"                    # picks the matching "Served by" field (Step 4)

LINE_NAME_FIELD = "Name"     # the lines layer's name field
GAP_REPORT_M   = 3000        # report line ends that stop within this distance of another line...
TOUCH_M        = 1           # ...but more than this (closer than this counts as touching)
MAP_JOINS_M    = 600         # the train map closes gaps smaller than this by itself
STATION_FAR_M  = 250         # report stations farther than this from every line
STATION_NEAR_M = 300         # Step 7: a line "serves" a stop pair if it passes this close to both stations
OUT_DIR        = "/arcgis/home"
''')

md("""
## Step 2 · Sign in and open the layers
In ArcGIS Online, `GIS("home")` signs in as you automatically. The output should list both layers with their record counts.
""")
code('''
import math, re, collections, datetime
import pandas as pd
from arcgis.gis import GIS
from arcgis.features import FeatureLayer

gis = GIS("home")
print("Signed in as", gis.users.me.username)
lines_fl = FeatureLayer(LINES_URL, gis)
stations_fl = FeatureLayer(STATIONS_URL, gis)
OID = lines_fl.properties.objectIdField
for name, fl in [("Lines", lines_fl), ("Stations", stations_fl)]:
    print(f"{name}: {fl.query(return_count_only=True)} features, object ID field {fl.properties.objectIdField}")
''')

md("""
## Step 3 · Read every line and station
Reads geometry in longitude/latitude, like the map does. A few thousand lines can take a minute.
""")
code('''
lines_fs = lines_fl.query(where="1=1", out_fields="*", out_sr=4326, return_geometry=True)
stations_fs = stations_fl.query(where="1=1", out_fields="*", out_sr=4326, return_geometry=True)

LINES = [{"oid": f.attributes[OID], "attrs": f.attributes, "paths": f.geometry.get("paths", [])}
         for f in lines_fs.features if f.geometry and f.geometry.get("paths")]
STATIONS = {f.attributes.get("StationID"): {"name": f.attributes.get("Name") or f.attributes.get("StationID"),
                                            "lon": f.geometry["x"], "lat": f.geometry["y"]}
            for f in stations_fs.features if f.geometry and f.attributes.get("StationID")}
print(len(LINES), "lines with geometry,", sum(len(l["paths"]) for l in LINES), "parts;", len(STATIONS), "stations")
''')

md("""
## Step 4 · Pick the "Served by" field
Lists the lines layer's fields that look like dated "Served by" fields and picks the one nearest `TIMETABLE_DATE`, the same way the map does. If it picks the wrong one, set `SERVED_FIELD` by hand at the end of the cell.
""")
code('''
MON = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
def field_date(name, alias):
    s = f"{name} {alias or ''}"
    m = re.search(r"S(\\d{4})([A-Za-z]{3})", s)
    if m and m.group(2).lower() in MON: return int(m.group(1)) * 12 + MON.index(m.group(2).lower())
    m = re.search(r"(\\d{4})\\s*-\\s*([A-Za-z]{3})", alias or "")
    if m and m.group(2).lower() in MON: return int(m.group(1)) * 12 + MON.index(m.group(2).lower())
    m = re.search(r"(?:^|[^A-Za-z])([A-Za-z]{3})[a-z]*[\\s_\\-]*(\\d{4})", s)   # "Served by - April 1971"
    if m and m.group(1).lower() in MON: return int(m.group(2)) * 12 + MON.index(m.group(1).lower())
    return None

y, mo = map(int, TIMETABLE_DATE.split("-")[:2]); want = y * 12 + mo - 1
dated = [(f["name"], f.get("alias"), field_date(f["name"], f.get("alias"))) for f in lines_fl.properties.fields]
dated = [d for d in dated if d[2] is not None]
for n, a, d in sorted(dated, key=lambda d: d[2]): print(f"  {n:20} {a}")
SERVED_FIELD = min(dated, key=lambda d: abs(d[2] - want) + (0.5 if d[2] > want else 0))[0] if dated else None
# SERVED_FIELD = "S1971Apr"   # <- uncomment and edit to choose by hand
print("\\nUsing:", SERVED_FIELD)
if SERVED_FIELD:
    vals = collections.Counter(str(l["attrs"].get(SERVED_FIELD) or "").strip() for l in LINES)
    print(f"{vals.get('', 0)} of {len(LINES)} lines have it blank. Most common values:")
    for v, n in vals.most_common(12):
        if v: print(f"  {n:5}  {v}")
''')

md("""
## Step 5 · Line ends that don't meet another line
For every line end, finds the nearest point on any **other** line or line part. Ends between `TOUCH_M` and `GAP_REPORT_M` away are listed: those are places where two lines look connected on the map but aren't. **Auto-closed** shows whether the train map already bridges the gap (under 600 m). Real dead ends (a branch that just stops) aren't listed because nothing is close to them.

It also counts places where lines **cross without sharing a point**. The map now adds junctions there itself, so they're only for information.

The results are saved as a CSV with longitude/latitude, which you can add to Map Viewer to see each spot.
""")
code('''
R = 6378137.0
def merc(lon, lat):
    lat = max(min(lat, 85), -85)
    return (math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def unmerc(x, y): return (math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2))
def scale(y): return math.cos(2 * math.atan(math.exp(y / R)) - math.pi / 2)   # map metres -> ground metres here
def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    q = (a[0] + t * dx, a[1] + t * dy)
    return math.hypot(p[0] - q[0], p[1] - q[1]), q

CELL = 2000.0
SEGS, GRID = [], collections.defaultdict(list)          # segment: (line index, part index, a, b)
for li, ln in enumerate(LINES):
    for pi, path in enumerate(ln["paths"]):
        pts = [merc(*xy[:2]) for xy in path]
        for a, b in zip(pts, pts[1:]):
            k = len(SEGS); SEGS.append((li, pi, a, b))
            for gx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
                for gy in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
                    GRID[(gx, gy)].append(k)
print(len(SEGS), "segments indexed")

def nearest(p, max_m, skip=None):
    """nearest segment to p within max_m ground metres; skip(li, pi) -> True to ignore a segment"""
    r = int(max_m / scale(p[1]) // CELL) + 1; cx, cy = int(p[0] // CELL), int(p[1] // CELL)
    best = None; seen = set()
    for gx in range(cx - r, cx + r + 1):
        for gy in range(cy - r, cy + r + 1):
            for k in GRID.get((gx, gy), ()):
                if k in seen: continue
                seen.add(k); li, pi, a, b = SEGS[k]
                if skip and skip(li, pi): continue
                d, q = seg_dist(p, a, b)
                if best is None or d < best[0]: best = (d, q, li)
    if best is None: return None
    d = best[0] * scale(p[1])
    return (d, best[1], best[2]) if d <= max_m else None

def lname(li):
    a = LINES[li]["attrs"]; return str(a.get(LINE_NAME_FIELD) or f"{OID} {LINES[li]['oid']}")

gaps = []
for li, ln in enumerate(LINES):
    for pi, path in enumerate(ln["paths"]):
        if len(path) < 2: continue
        for end in (path[0], path[-1]):
            p = merc(*end[:2])
            hit = nearest(p, GAP_REPORT_M, skip=lambda l2, p2, li=li, pi=pi: (l2 == li and p2 == pi))
            if not hit or hit[0] <= TOUCH_M: continue
            d, q, l2 = hit
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2; lon, lat = unmerc(mx, my)
            gaps.append({"line": lname(li), "line_oid": ln["oid"], "nearest_line": lname(l2), "nearest_oid": LINES[l2]["oid"],
                         "gap_m": round(d), "auto_closed": d < MAP_JOINS_M, "lon": round(lon, 6), "lat": round(lat, 6),
                         "same_line": l2 == li})
gaps_df = pd.DataFrame(gaps).sort_values("gap_m") if gaps else pd.DataFrame(columns=["line","gap_m"])
print(f"{len(gaps_df)} line ends stop short of another line ({int((~gaps_df.get('auto_closed', pd.Series(dtype=bool))).sum()) if len(gaps_df) else 0} of them too far for the map to bridge)")

# crossings without a shared point (information only)
cross = 0
for cell_segs in GRID.values():
    for i in range(len(cell_segs)):
        for j in range(i + 1, len(cell_segs)):
            s1, s2 = SEGS[cell_segs[i]], SEGS[cell_segs[j]]
            if s1[0] == s2[0]: continue
            (p, p2), (q, q2) = (s1[2], s1[3]), (s2[2], s2[3])
            r_ = (p2[0] - p[0], p2[1] - p[1]); s_ = (q2[0] - q[0], q2[1] - q[1]); den = r_[0] * s_[1] - r_[1] * s_[0]
            if abs(den) < 1e-9: continue
            t = ((q[0] - p[0]) * s_[1] - (q[1] - p[1]) * s_[0]) / den; u = ((q[0] - p[0]) * r_[1] - (q[1] - p[1]) * r_[0]) / den
            if 0.001 < t < 0.999 and 0.001 < u < 0.999: cross += 1
print(f"{cross} places where two lines cross without sharing a point (may count a crossing twice if it sits on a grid edge)")

out = f"{OUT_DIR}/line_gaps.csv"; gaps_df.to_csv(out, index=False); print("Saved", out)
gaps_df.head(40)
''')

md("""
## Step 6 · Stations too far from any line
The map attaches each station to a line within about 2 km. Anything listed here is worth a look: the station point may be on the wrong side of a yard, or the line it sits on may be missing.
""")
code('''
far = []
for sid, st in STATIONS.items():
    p = merc(st["lon"], st["lat"]); hit = nearest(p, 5000)
    d = hit[0] if hit else None
    if d is None or d > STATION_FAR_M:
        far.append({"StationID": sid, "station": st["name"], "distance_m": round(d) if d is not None else ">5000",
                    "nearest_line": lname(hit[2]) if hit else "", "lon": st["lon"], "lat": st["lat"]})
far_df = pd.DataFrame(far)
if len(far_df): far_df = far_df.sort_values("distance_m", key=lambda s: pd.to_numeric(s, errors="coerce").fillna(1e9))
print(len(far_df), "stations are more than", STATION_FAR_M, "m from every line")
out = f"{OUT_DIR}/stations_far_from_lines.csv"; far_df.to_csv(out, index=False); print("Saved", out)
far_df.head(40)
''')

md("""
## Step 7 · Suggest "Served by" values from the Desk export
For each pair of consecutive stops on each train, finds lines that pass within `STATION_NEAR_M` of **both** stations. If exactly one line does, that line is very likely the one the train used, so its railroad goes on the suggestion list (where the field doesn't already name it). Lines you typed into a train's **Rail lines it runs on** box in the Desk always count.

Pairs where several lines qualify are listed separately as **ambiguous** for you to judge; they're never written automatically.

This step only builds tables. Read them before Step 8.
""")
code('''
desk = pd.read_csv(DESK_CSV, dtype=str).fillna("")
print(len(desk), "stop rows,", desk["train_id"].nunique(), "trains from", ", ".join(sorted(desk["source"].unique())))

# lines near each station (cached)
near_cache = {}
def lines_near(sid):
    if sid in near_cache: return near_cache[sid]
    st = STATIONS.get(sid); out = set()
    if st:
        p = merc(st["lon"], st["lat"]); r = int(STATION_NEAR_M / scale(p[1]) // CELL) + 1; cx, cy = int(p[0] // CELL), int(p[1] // CELL)
        for gx in range(cx - r, cx + r + 1):
            for gy in range(cy - r, cy + r + 1):
                for k in GRID.get((gx, gy), ()):
                    li, pi, a, b = SEGS[k]
                    if li not in out and seg_dist(p, a, b)[0] * scale(p[1]) <= STATION_NEAR_M: out.add(li)
    near_cache[sid] = out; return out

def norm(s):
    s = re.sub(r"&", " and ", str(s).lower()); s = re.sub(r"[^a-z ]", " ", s)
    s = re.sub(r"\\b(the|railroad|railway|railways|rail|road|company|corporation|corp|transportation|co|inc|lines?|system|and)\\b", " ", s)
    return re.sub(r"\\s+", " ", s).strip()
def names_rr(value, rr_name, rr_abbrev):
    want = norm(rr_name)
    for part in re.split(r"[;,/]", str(value or "")):
        p = norm(part)
        if not p: continue
        if re.sub(r"[^a-z0-9]", "", part.lower()) == re.sub(r"[^a-z0-9]", "", rr_abbrev.lower()): return True
        if p == want or (len(p.split()) > 1 and f" {p} " in f" {want} ") or (len(want.split()) > 1 and f" {want} " in f" {p} "): return True
    return False

by_name = collections.defaultdict(list)
for li, ln in enumerate(LINES): by_name[lname(li).lower()].append(li)

sure = collections.defaultdict(lambda: {"trains": set(), "pairs": set()})   # (line index, railroad) -> evidence
ambiguous = []
desk["seq"] = pd.to_numeric(desk["stop_sequence"], errors="coerce")
for tid, g in desk.sort_values(["train_id", "seq"]).groupby("train_id"):
    rr_name, rr = g["railroad"].iloc[0], g["rr"].iloc[0]
    picked = {li for n in str(g["lines"].iloc[0] if "lines" in g else "").split(";") if n.strip() for li in by_name.get(n.strip().lower(), [])}
    for li in picked: sure[(li, rr_name, rr)]["trains"].add(tid)
    sids = [s for s in g["station_id"] if s]
    for a, b in zip(sids, sids[1:]):
        if a == b: continue   # one station printed as separate arrive and leave rows
        both = lines_near(a) & lines_near(b)
        if picked: both = (both & picked) or both
        if len(both) == 1:
            li = next(iter(both)); e = sure[(li, rr_name, rr)]; e["trains"].add(tid); e["pairs"].add(f"{STATIONS.get(a, {}).get('name', a)} – {STATIONS.get(b, {}).get('name', b)}")
        elif len(both) > 1:
            ambiguous.append({"train": tid, "from": STATIONS.get(a, {}).get("name", a), "to": STATIONS.get(b, {}).get("name", b),
                              "candidate_lines": "; ".join(sorted(lname(li) for li in both))})

suggest = []
for (li, rr_name, rr), e in sure.items():
    cur = str(LINES[li]["attrs"].get(SERVED_FIELD) or "").strip()
    if names_rr(cur, rr_name, rr): continue
    suggest.append({"line_oid": LINES[li]["oid"], "line": lname(li), "current": cur, "add": rr_name,
                    "new_value": f"{cur}; {rr_name}" if cur else rr_name,
                    "trains": ", ".join(sorted(e["trains"])[:6]) + (" …" if len(e["trains"]) > 6 else ""),
                    "between": "; ".join(sorted(e["pairs"])[:3])})
# one row per line, combining several railroads if needed
sug_df = pd.DataFrame(suggest)
if len(sug_df):
    sug_df = (sug_df.groupby(["line_oid", "line", "current"], as_index=False)
              .agg({"add": lambda s: "; ".join(dict.fromkeys(s)), "trains": "; ".join,
                   "between": lambda s: "; ".join(dict.fromkeys(x for v in s for x in v.split("; ") if x))}))
    sug_df["new_value"] = sug_df.apply(lambda r: f"{r['current']}; {r['add']}" if r["current"] else r["add"], axis=1)
amb_df = pd.DataFrame(ambiguous).drop_duplicates(["from", "to", "candidate_lines"]) if ambiguous else pd.DataFrame()
print(f"{len(sug_df)} lines to update; {len(amb_df)} stop pairs are ambiguous (see ambiguous_pairs.csv)")
sug_df.to_csv(f"{OUT_DIR}/served_by_suggestions.csv", index=False); amb_df.to_csv(f"{OUT_DIR}/ambiguous_pairs.csv", index=False)
pd.set_option("display.max_colwidth", 80)
sug_df.head(60)
''')

md("""
## Step 8 · Write the suggestions to the lines layer
First it saves a **backup** of the current values (`served_by_backup_<time>.csv`), so Step 9 can undo this.

It runs as a dry run until you change `DRY_RUN` to `False`. You can also drop rows first, e.g. `sug_df = sug_df[sug_df.line != "Some line"]`.

You need edit rights on the layer, and editing must be turned on in the layer's settings.
""")
code('''
DRY_RUN = True

if not SERVED_FIELD: raise SystemExit("No Served-by field chosen in Step 4")
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
backup = f"{OUT_DIR}/served_by_backup_{stamp}.csv"
pd.DataFrame([{"oid": r.line_oid, "value": r.current} for r in sug_df.itertuples()]).to_csv(backup, index=False)
print("Backup saved:", backup)

updates = [{"attributes": {OID: int(r.line_oid), SERVED_FIELD: r.new_value}} for r in sug_df.itertuples()]
if DRY_RUN:
    print(f"Dry run: would update {len(updates)} lines. First few:", updates[:3])
else:
    ok = bad = 0
    for i in range(0, len(updates), 100):
        res = lines_fl.edit_features(updates=updates[i:i + 100])
        for r in res.get("updateResults", []):
            if r.get("success"): ok += 1
            else: bad += 1; print("Failed:", r)
    print(f"Updated {ok} lines; {bad} failed.")
''')

md("""
## Step 9 · Undo Step 8
Only if you need it. Puts back the values from a backup file: set `BACKUP` to the file name Step 8 printed and `UNDO = True`.
""")
code('''
UNDO = False      # change to True to restore
BACKUP = backup   # or e.g. "/arcgis/home/served_by_backup_20261005-1430.csv"
old = pd.read_csv(BACKUP, dtype={"value": str}).fillna("")
if not UNDO:
    print(f"Would restore {len(old)} lines from {BACKUP}. Set UNDO = True to do it.")
else:
    res = lines_fl.edit_features(updates=[{"attributes": {OID: int(r.oid), SERVED_FIELD: r.value or None}} for r in old.itertuples()])
    print(sum(1 for r in res.get("updateResults", []) if r.get("success")), "of", len(old), "lines restored")
''')

nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
      "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
for i, c in enumerate(nb["cells"]): c["id"] = f"c{i:02d}"
json.dump(nb, open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "Rail_lines_check.ipynb"), "w"), indent=1)
# also a plain script of the code cells for local testing
(lambda s: None)("\n\n".join(c["source"] for c in cells if c["cell_type"] == "code"))
print("written")
