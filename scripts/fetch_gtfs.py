"""Download the railroads' published GTFS timetable feeds into gtfs/ and write gtfs/manifest.json.
Run weekly by .github/workflows/gtfs.yml; the map page reads the manifest to offer the feeds."""
import json, os, sys, urllib.request, zipfile, io, datetime

FEEDS = [
    {"name": "Amtrak", "file": "amtrak.zip", "url": "https://content.amtrak.com/content/gtfs/GTFS.zip"},
    {"name": "Metro-North Railroad", "file": "metro-north.zip", "url": "https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip"},
    {"name": "Long Island Rail Road", "file": "lirr.zip", "url": "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip"},
]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gtfs")
os.makedirs(OUT, exist_ok=True)
ok = []
for f in FEEDS:
    path = os.path.join(OUT, f["file"])
    try:
        req = urllib.request.Request(f["url"], headers={"User-Agent": "train-map-weekly-gtfs"})
        data = urllib.request.urlopen(req, timeout=120).read()
        names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        if not any(n.endswith("stop_times.txt") for n in names) or not any(n.endswith("trips.txt") for n in names):
            raise ValueError("not a GTFS feed (no trips.txt / stop_times.txt)")
        old = open(path, "rb").read() if os.path.exists(path) else None
        if old != data:
            open(path, "wb").write(data)
        print(f"{f['name']}: {len(data):,} bytes{' (unchanged)' if old == data else ''}")
        ok.append({"name": f["name"], "file": f["file"]})
    except Exception as e:  # keep the previous copy if a download fails
        print(f"{f['name']}: FAILED ({e})", file=sys.stderr)
        if os.path.exists(path):
            ok.append({"name": f["name"], "file": f["file"]})
man = {"updated": datetime.date.today().isoformat(), "feeds": ok}
old_m = json.load(open(os.path.join(OUT, "manifest.json"))) if os.path.exists(os.path.join(OUT, "manifest.json")) else {}
if old_m.get("feeds") != ok or not old_m:
    json.dump(man, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
sys.exit(0 if ok else 1)
