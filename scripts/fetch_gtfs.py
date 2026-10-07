"""Download passenger-rail GTFS timetable feeds into gtfs/ (rail routes only) and write gtfs/manifest.json.
Run weekly by .github/workflows/gtfs.yml. The map page reads the manifest to offer the feeds.

Sources: a few direct railroad URLs below, plus every feed in the public Mobility Database catalog whose
provider matches a name in RAIL_NAMES. A feed with no rail routes in it is skipped; one that fails to
download keeps its previous copy."""
import csv, io, json, os, re, sys, urllib.request, zipfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "gtfs")
CATALOG = "https://files.mobilitydatabase.org/feeds_v2.csv"

ANY = {"0", "1", "2"}   # for feeds that code their commuter trains as tram/metro
DIRECT = [  # name, file, [urls tried in order], route types to keep (None = heavy/regional rail only)
    ("Amtrak", "amtrak.zip", ["https://content.amtrak.com/content/gtfs/GTFS.zip"], None),
    ("Metro-North Railroad", "metro-north.zip", ["https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip"], None),
    ("Long Island Rail Road", "lirr.zip", ["https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip"], None),
    ("Metra", "metra.zip", ["https://schedules.metrarail.com/gtfs/schedule.zip", "https://files.mobilitydatabase.org/mdb-2854/latest.zip"], ANY),
    ("PATH", "path.zip", ["http://data.trilliumtransit.com/gtfs/path-nj-us/path-nj-us.zip", "https://files.mobilitydatabase.org/mdb-517/latest.zip"], ANY),
    ("Alaska Railroad", "alaska-railroad.zip", ["https://www.alaskarailroad.com/sites/default/files/GTFS/GTFS-20240419.zip", "https://files.mobilitydatabase.org/ntd-41/latest.zip"], None),
    ("TEXRail (Trinity Metro)", "texrail.zip", ["https://gtfsdata.ridetm.org/gtfs/fwtatransitdata.zip", "https://files.mobilitydatabase.org/mdb-2890/latest.zip"], {"0", "2"}),
    ("Shore Line East", "shore-line-east.zip", ["http://www.shorelineeast.com/google_transit.zip", "https://files.mobilitydatabase.org/mdb-550/latest.zip"], None),
    ("Rail Runner Express", "rail-runner.zip", ["https://www.riometro.org/DocumentCenter/View/2195/nmrailrunner_google_transit", "https://files.mobilitydatabase.org/mdb-165/latest.zip"], None),
]
# provider-name fragments (lower case) that mean "a passenger railroad worth having"
RAIL_NAMES = [
    "via rail", "nj transit", "septa", "southeastern pennsylvania", "mbta", "massachusetts bay", "metra", "northeast illinois",
    "metrolink", "southern california regional rail", "caltrain", "peninsula corridor", "sounder", "sound transit", "tri-rail",
    "south florida regional", "sunrail", "frontrunner", "utah transit", "trinity railway", "trinity metro", "dallas area rapid",
    "music city star", "regional transportation district", "rail runner", "new mexico rail", "south shore", "northern indiana commuter",
    "mta maryland", "maryland transit", "marc", "virginia railway express", "vre", "northstar", "metro transit",
    "altamont", "san joaquin", "capitol corridor", "coaster", "north county transit", "sonoma-marin", "smart",
    "brightline", "go transit", "metrolinx", "exo", "agence m", "shore line east", "hartford line", "ctrail", "cttransit", "ctdot",
    "path", "port authority trans-hudson", "capital metro", "westside express", "trimet", "alaska railroad", "ontario northland",
    "downeaster", "northern new england passenger", "cape cod", "wmata", "amtrak", "maine", "lextran", "pace",
    "rtd", "metrorail", "wego", "nashville", "nmdot", "new mexico department", "northstar", "sun metro", "septa regional rail", "new jersey transit", "mass transit administration", "south coast", "ace ",
    "hudson", "oc transportation", "orange county transportation", "san diego metropolitan", "mts", "valley metro", "rail",
]
def is_rail(t, allow): return t == "2" or (t.isdigit() and 100 <= int(t) <= 117) or (allow is not None and t in allow)
FIXED = (2020, 1, 1, 0, 0, 0)   # fixed timestamps so an unchanged feed gives an identical zip

def get(url, timeout=180):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "train-map-weekly-gtfs"}), timeout=timeout).read()

def rows(z, name):
    m = [n for n in z.namelist() if re.search(r"(^|/)" + name + r"\.txt$", n)]
    if not m: return None, []
    txt = io.TextIOWrapper(z.open(m[0]), encoding="utf-8-sig", newline="")
    r = csv.DictReader(txt, skipinitialspace=True)
    if r.fieldnames: r.fieldnames = [f.strip().strip('"').lstrip("\ufeff") for f in r.fieldnames]   # some feeds (Metra) pad their headers
    return r.fieldnames, ({k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()} for row in r)

def rail_only(data, allow=None):
    """Keep only the rail routes of a feed; returns (zip bytes, trips, agency names) or None if it has no rail."""
    zin = zipfile.ZipFile(io.BytesIO(data))
    _, routes = rows(zin, "routes"); routes = list(routes)
    rail_only.seen = sorted({(r.get("route_type") or "").strip() for r in routes})[:8]; rail_only.n = len(routes)
    rail = {r["route_id"] for r in routes if is_rail((r.get("route_type") or "").strip(), allow)}
    if not rail: return None
    tf, trips = rows(zin, "trips")
    keep_trips, services, shapes, tr_rows = set(), set(), set(), []
    for t in trips:
        if t["route_id"] in rail:
            keep_trips.add(t["trip_id"]); services.add(t.get("service_id", "")); tr_rows.append(t)
            if t.get("shape_id"): shapes.add(t["shape_id"])
    if not keep_trips: return None
    out = io.BytesIO(); zo = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9)
    def put(name, fields, items):
        b = io.StringIO(); w = csv.DictWriter(b, fieldnames=fields, extrasaction="ignore", lineterminator="\n"); w.writeheader()
        for it in items: w.writerow(it)
        zo.writestr(zipfile.ZipInfo(name, FIXED), b.getvalue(), zipfile.ZIP_DEFLATED)
    f, rr = rows(zin, "routes"); put("routes.txt", f, [r for r in rr if r["route_id"] in rail])
    put("trips.txt", tf, tr_rows)
    sf, sts = rows(zin, "stop_times"); stops_used = set(); st_rows = []
    for s in sts:
        if s["trip_id"] in keep_trips: st_rows.append(s); stops_used.add(s["stop_id"])
    put("stop_times.txt", sf, st_rows)
    f, ss = rows(zin, "stops"); allstops = list(ss); by = {s["stop_id"]: s for s in allstops}
    for sid in list(stops_used):
        p = (by.get(sid) or {}).get("parent_station")
        if p: stops_used.add(p)
    put("stops.txt", f, [s for s in allstops if s["stop_id"] in stops_used])
    for nm in ("agency", "feed_info"):
        f, it = rows(zin, nm)
        if f: put(nm + ".txt", f, list(it))
    f, it = rows(zin, "calendar")
    if f: put("calendar.txt", f, [r for r in it if r["service_id"] in services])
    f, it = rows(zin, "calendar_dates")
    if f: put("calendar_dates.txt", f, [r for r in it if r["service_id"] in services])
    if shapes:
        f, it = rows(zin, "shapes")
        if f: put("shapes.txt", f, [r for r in it if r["shape_id"] in shapes])
    zo.close()
    _, ag = rows(zin, "agency")
    return out.getvalue(), len(keep_trips), sorted({a.get("agency_name", "") for a in ag if a.get("agency_name")})

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]

def catalog_feeds(skip_words):
    out = []
    try:
        text = get(CATALOG, 120).decode("utf-8-sig")
    except Exception as e:
        print("catalog: FAILED", e, file=sys.stderr); return out
    for r in csv.DictReader(io.StringIO(text)):
        if (r.get("data_type") or "").lower() != "gtfs": continue
        if (r.get("status") or "active").lower() in ("deprecated", "inactive"): continue
        if (r.get("location.country_code") or "").upper() not in ("US", "CA"): continue
        prov = (r.get("provider") or ""); hay = (prov + " " + (r.get("name") or "")).lower()
        if any(w in hay for w in skip_words): continue
        if not any(w in hay for w in RAIL_NAMES): continue
        url = r.get("urls.latest") or r.get("urls.direct_download")
        if not url: continue
        out.append((prov or r.get("name"), slug(prov + "-" + (r.get("id") or "")) + ".zip", url, r.get("location.country_code") or ""))
    return out

os.makedirs(OUT, exist_ok=True)
mpath = os.path.join(OUT, "manifest.json")
old = json.load(open(mpath)) if os.path.exists(mpath) else {}
oldf = {f["file"]: f for f in old.get("feeds", [])}
feeds, report = [], []
todo = [(n, f, us, a) for n, f, us, a in DIRECT] + [(n, f, [u], None) for n, f, u, _ in catalog_feeds(["amtrak", "metro-north", "long island", "metra", "port authority trans-hudson", "trinity metro", "shore line east", "rio metro", "alaska railroad"])]
for name, fname, urls, allow in todo:
    path = os.path.join(OUT, fname)
    try:
        res, err, why = None, None, ""
        for url in urls:
            try:
                res = rail_only(get(url), allow)
                if res is not None: break
                err = "no rail routes"; why = f"{len(urls)} url(s); last feed had {rail_only.n} routes, types {rail_only.seen}, via {url}"
            except Exception as e:
                err = f"{url}: {e}"
        if res is None and err != "no rail routes": raise Exception(err)
        if res is None: report.append(f"{name}: no rail routes, skipped ({why})"); continue
        data, ntrips, agencies = res
        was = open(path, "rb").read() if os.path.exists(path) else None
        if was != data: open(path, "wb").write(data)
        feeds.append({"name": name, "file": fname, "trips": ntrips, "agencies": agencies, "kb": len(data) // 1024})
        report.append(f"{name}: {ntrips} rail trips, {len(data)//1024} KB{' (unchanged)' if was == data else ''}")
    except Exception as e:
        report.append(f"{name}: FAILED ({e})")
        if fname in oldf: feeds.append(oldf[fname])
# the catalog can list one railroad twice; keep the copy with more trips
best = {}
for f in feeds:
    k = re.sub(r"\W+", " ", f["name"].lower()).strip()
    if k not in best or f.get("trips", 0) > best[k].get("trips", 0): best[k] = f
for f in feeds:
    if best[re.sub(r"\W+", " ", f["name"].lower()).strip()] is not f and os.path.exists(os.path.join(OUT, f["file"])):
        os.remove(os.path.join(OUT, f["file"]))
feeds = list(best.values())
for f in feeds:
    if len(f["name"]) > 60: f["name"] = f["name"][:57].rsplit(",", 1)[0].rstrip(" ,") + " …"
for line in report: print(line)
feeds.sort(key=lambda f: f["name"].lower())
man = {"updated": datetime.date.today().isoformat(), "feeds": feeds, "report": report}
if {k: v for k, v in old.items() if k != "updated"} != {k: v for k, v in man.items() if k != "updated"}:
    json.dump(man, open(mpath, "w"), indent=1)
sys.exit(0 if feeds else 1)
