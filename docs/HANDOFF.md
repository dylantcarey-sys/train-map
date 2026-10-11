# Historic train timetable project: handoff

Prepared 6 October 2026 so the project can be picked up in a different Claude account. Give this folder (or the zip) to Claude in the new account and say: **"Read HANDOFF.md and restore the Timetable Desk."**

## What the project is

Dylan's personal project: historic passenger timetables (starting with the *Official Guide of the Railways*, April 1971) are entered by hand into a web app called the **Timetable Desk**, and an **interactive ArcGIS map** animates the trains along historic rail lines.

- **ArcGIS Online (Dylan's personal account):** two hosted layers.
  - `Historic_Passenger_Stations`: https://services8.arcgis.com/rd2DawKbk2tfv3gN/arcgis/rest/services/Historic_Passenger_Stations/FeatureServer/0 (key field `StationID`, e.g. `STN-00073`)
  - `Historic_Passenger_Lines`: https://services8.arcgis.com/rd2DawKbk2tfv3gN/arcgis/rest/services/Historic_Passenger_Lines/FeatureServer/0 (name field `Name`)
  - Both have dated "Served by" fields named like `S1971Apr` (alias "1971 - April - Served By"). The map picks the one nearest the timetable's date.
- **Timetable Desk:** a single-page app published as a claude.ai artifact (old link, PTNY account: https://claude.ai/artifact/JuSiXC5XHFRzw4k8CpjCWR). It stores everything in the artifact's own database.
- **Train map:** a single HTML page that the Desk builds and downloads (the **Map** button), with the timetable data built in. It loads the ArcGIS Maps SDK 4.32 from js.arcgis.com and JSZip from cdnjs.

## What's in this folder

| Path | What it is |
|---|---|
| `data/desk-data.json` | Every document in the Desk's database as of 6 Oct 2026: 15 sources, 55 tables, 497 trains (all in the April 1971 Guide), 43 railroads. Format: `{"documents": {"<collection path>/<doc id>": {fields}}}` |
| `app/timetable-desk.html` | The built Desk page, ready to publish as an artifact |
| `app/stations.json` | Station list the Desk loads beside the page (publish it as a supporting file named `stations.json`) |
| `code/desk/` | Desk source: `page.html` + `core.js`; `build.py` puts them together and embeds the map template |
| `code/map/` | Map source: `page.html` + `core.js` + `build.py`; `fake_geo.js`/`stub.js` are test stand-ins for ArcGIS |
| `code/notebook/` | `Rail_lines_check.ipynb` for ArcGIS Online Notebooks (checks line gaps, stations far from lines, suggests "Served by" values) |
| `conversation.md` | Readable record of the 4–6 October conversation |

## Restoring in a new Claude account (instructions for Claude)

1. Publish `app/timetable-desk.html` as a new artifact with `stations.json` as a supporting file, declaring capabilities `{"db": {}, "downloads": true, "user": {}}`.
2. Load `data/desk-data.json` and write every document back with the ArtifactData tool (`batch`, 50 writes per call, `op: "set"`, `collection` = the path without the last segment, `doc_id` = the last segment). About 13 batches.
3. Open the Desk, check the Home counts (497 trains, 55 tables) and open a couple of trains.
4. To change the app later: edit `code/desk/page.html` / `code/map/page.html` (and their `core.js`), run each `build.py` (the Desk build reads the map files, so adjust the paths in it), and republish.

Note: the Desk database uses these collections: `sources`, `sources/<id>/tables`, `sources/<id>/trains`, `railroads`, `newstations` (empty), `stationlists/current` (unused; stations come from `stations.json`).

## How the data works (decisions made along the way)

- **Tables and trains:** each Guide table is a document; each train is one document that can appear on several tables. Its stops are stored per table (`stops[].tableId`), so where each time came from is kept. The **Trains** page combines a train's tables into one view on the fly; nothing is stored twice.
- **Times:** typed as `735`, `7:35 pm`, `1935`; stored 24-hour. A time without am/pm is settled from the stop before. `735/` = arrives only, `/735` = departs only, `1115/1135` = arrive/depart, `—` = doesn't stop.
- **Reference marks** follow the time: `735f`, `735 f†`, `735 f u`. When a, m or p is one of several marks, put them together after a space (`122 al`) or write the am/pm first (`122p a l`). Each table has its own mark list (editable, sortable).
- **Days:** train frequency plus optional per-stop days. A stop's days mean the day the train is *at that stop* (SOU 1 leaves Birmingham Tue/Thu/Sun, so it left Washington Mon/Wed/Sat). Weekday service is written "Monday through Friday". Marks that state days set a stop's days; several day marks give the days they share.
- **Splits and joins:** one train number with several destinations uses named **sections** (e.g. PRSL 363/350 at Tuckahoe). Separately numbered trains that split or join (PC 31/77, C&O 1 with 41/47/21) stay separate trains but share one column in the grid, as printed.
- **Hosted tables:** one railroad's table that carries other railroads' trains (e.g. NYLB) has a per-column railroad.
- **Links between trains:** "Through cars" (cars actually run through, e.g. D&H 34 → PC 72 at Albany) are kept separate from "Connections" (change trains). Both directions are expected to be entered on both trains.
- **Problems list:** Trains → "Show all problems" flags times that disagree between tables, order/start/end problems, and links that don't match. An item can be marked **"Known inconsistency in the source"** (with a note) when the Guide itself disagrees. PC 185 (Tables 12 vs 14, 10 minutes apart at New London, New Haven, New York) is one; Dylan planned to mark it.
- **Railroads:** short names (reporting marks) are fixed once used; each has a map colour based on historic paint schemes.

## The map

- Trains are routed along the lines layer, preferring lines whose "Served by" field names the train's railroad, or lines typed into the train's "Rail lines it runs on" box. Lines that cross get junctions; segments that can't be routed show as red dashed lines with a reason and, where possible, an orange ring at the break.
- Train symbol: a diesel seen from above, black with grey detail. Lines a railroad served are drawn in its colour even with no trains entered. Full-screen and hide-panel buttons. Stop rule: "on signal/notice" stops roll through; "only to receive/discharge" stops dwell at least one minute.
- Trains whose stops don't run every day start or end partway along on the days they don't (SOU 1, SOU 2).
- **Modern timetables:** the map's "Timetable data" panel can add a GTFS .zip (Amtrak, Metro-North, LIRR feeds; no sign-up). It converts one typical week of rail trains into a separate source, matching feed stations to historic ones within 400 m.

## Still to do

- **Next map update:** when only one train is shown, also show its connections; draw through-car routes as one run (D&H 34 shows its PC section).
- **Hosting:** move the map to GitHub Pages (public project, free). Then add a weekly GitHub Actions job that downloads the GTFS feeds and converts them, and draw modern trains along the feeds' own route shapes (shapes.txt) instead of the 1971 lines. The Desk stays on claude.ai unless it's rebuilt on another database.
- **ArcGIS notebook:** run Steps 1–6 (read-only checks) first; Dylan found it confusing, so go one cell at a time.
- **Later features:** station pages (trains on a given day, photo, blurb); click a station on the map to see them; side-by-side maps comparing two sources.
- **Data:** N&W 17/18 link to SOU 17/18, which weren't entered yet.

## Notes for Claude's memory in the new account

Dylan can paste this section into the new account (or use Claude's memory import) so preferences carry over:

- Personal ArcGIS project (not PTNY's): historic passenger trains on an animated map, data entered from Official Guides via the Timetable Desk.
- Wants weekday service labelled "Monday through Friday".
- Prefers to be walked through new tools one step at a time.
- Map train symbol: diesel from above, black/grey. Railroad colours follow historic paint schemes.
- Separates through cars from connections; known source inconsistencies are kept as printed and marked.
- Plans: GitHub Pages hosting, weekly modern timetable feeds, station pages, side-by-side comparison maps.
