# Builds the Timetable Desk page: src/page.html + src/core.js, with the map (map-template/page.html + core.js) embedded as a template.
# Run from anywhere: python3 desk/build.py  ->  writes desk/dist/timetable-desk.html
import json, os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(here, p), encoding="utf-8").read()
m = rd("map-template/page.html").replace("/*CORE*/", rd("map-template/core.js"))
assert "/*CSV*/" in m and "/*EXPORTED*/" in m
tpl = json.dumps(m).replace("</", "<\\/")
out = rd("src/page.html").replace("/*CORE*/", rd("src/core.js")).replace("/*MAPTPL*/", tpl)
os.makedirs(os.path.join(here, "dist"), exist_ok=True)
dst = os.path.join(here, "dist", "timetable-desk.html")
open(dst, "w", encoding="utf-8").write(out)
print(len(out), "bytes ->", dst)
