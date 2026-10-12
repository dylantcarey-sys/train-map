# Builds the online map (index.html, served by GitHub Pages) from the map source in desk/map-template
# with a Timetable Desk export built in -- the same page the Desk's Map button downloads.
#   python3 scripts/build_map.py <desk-export.csv> <railroads.json> ["exported" label]
import json, os, sys, datetime
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(p, encoding="utf-8").read()
csv_path, rr_path = sys.argv[1], sys.argv[2]
label = sys.argv[3] if len(sys.argv) > 3 else datetime.datetime.now().strftime("%B %-d, %Y")
page = rd(os.path.join(root, "desk/map-template/page.html")).replace("/*CORE*/", rd(os.path.join(root, "desk/map-template/core.js")))
esc = lambda s: s.replace("</", "<\\/")
page = page.replace("/*CSV*/", esc(json.dumps(rd(csv_path)))).replace("/*EXPORTED*/", label).replace("/*RAILROADS*/", esc(json.dumps(json.loads(rd(rr_path)))))
open(os.path.join(root, "index.html"), "w", encoding="utf-8").write(page)
# the GTFS build script uses the same core
open(os.path.join(root, "scripts/map-core.js"), "w", encoding="utf-8").write(rd(os.path.join(root, "desk/map-template/core.js")))
print(len(page), "bytes -> index.html")
