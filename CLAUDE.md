# train-map: notes for Claude

Dylan's personal project: historic passenger timetables (starting with the April 1971 *Official Guide of the Railways*) are entered in the **Timetable Desk** (a claude.ai artifact app), and an **ArcGIS map** animates the trains along historic rail lines. Personal project, not PTNY work.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The train map, hosted on GitHub Pages (built; don't edit by hand) |
| `scripts/` | Modern-timetable (GTFS) fetch and build scripts for the map |
| `desk/src/page.html`, `desk/src/core.js` | Timetable Desk source (core.js holds parsing: times, marks, stop merging) |
| `desk/map-template/` | Map source (`page.html` + `core.js`): used for `index.html` and embedded in the Desk for its **Map** download button |
| `scripts/build_map.py` | Builds `index.html` from the map source plus a Desk export (CSV + railroads JSON); also copies the core to `scripts/map-core.js` for the GTFS job |
| `desk/build.py` | Builds `desk/dist/timetable-desk.html` (the page that gets published) |
| `desk/stations.json` | Station list the Desk falls back to (an export of the ArcGIS stations layer) |
| `desk/test/` | `mock.js` (in-memory stand-in for the artifact database), `smoke.js`, `fake_geo.js` |
| `notebook/` | ArcGIS Online notebook that checks rail lines (read-only Steps 1–6; Step 8 writes) |
| `docs/HANDOFF.md` | Background and decisions so far |
| `TODO.md` | Flagged for the next map update |

## Changing the Desk

1. Edit `desk/src/page.html` or `desk/src/core.js`.
2. `python3 desk/build.py`
3. `node desk/test/smoke.js [seed.json]` and check it says "no page errors". The seed is a database download (`{"documents": {...}}`), kept out of git as `desk/test/seed.json`. Chromium is preinstalled; don't run `playwright install`.
4. Before publishing, read `presence/desk` with ArtifactData (get). If `dialogOpen` is true and `at` is within the last 2 hours, Dylan has a pop-up open: don't publish (or write data); tell him it's ready and wait until he says go or the flag clears. Building and testing locally is always fine.
5. Publish `desk/dist/timetable-desk.html` with the Artifact tool to the Desk's URL: https://claude.ai/artifact/5Q5YhkF8LaqtskkSX1gTBe (keep its capabilities: db, downloads, user).
6. Commit the source and the built file together.

## Changing the map

1. Edit `desk/map-template/page.html` or `core.js`.
2. Get a fresh Desk export: read `sources/og-1971-04/trains`, `.../tables` and `railroads` with ArtifactData (out_dir), make a seed, then run the built Desk with `desk/test/mock.js` in Playwright and call `__deskHook().buildCSV()` and `.rrList()`.
3. `python3 scripts/build_map.py export.csv railroads.json "Month D, YYYY"` writes `index.html`.
4. Test by loading `index.html` in Playwright with `js.arcgis.com` routed to `desk/test/fake_geo.js` + `desk/map-template/stub.js`.
5. Rebuild and republish the Desk too (it embeds the map template), then commit both.

Map behaviour to keep: the date (first of the guide's month by default) drives the weekday; alternate-day service, one-off dates and the PC Table 3 April 25 time change (`DATE_SHIFTS` in core.js) depend on it.

## The Desk's data

Stored in the artifact's database (edit with the ArtifactData tool, same URL). One source (guide) per Desk:
- `sources/og-1971-04/tables` and `sources/og-1971-04/trains`; `railroads` (global identity: `abbrev` the code on tables, short name `common` (what the railroad itself went by), `nickname` (nicknames and slogans, e.g. Skunk Train), business name `name`, other names, `chartered`, `from` (began operating) and `to` for the whole railroad, `periods` `[{name, chartered, from, to}]` for its formal names over time (the guide's date picks the name shown and exported), `rootFrom` for a separate predecessor company, `intercityEnd` and `passengerEnd` (all passenger service, incl. commuter and mixed; before the guide's date means freight only for that guide) (the Railroads page hides ones not running on the guide's date, and can hide mixed-only ones), map color and basis, predecessors/successors, parent, HQ, lines served); `sources/og-1971-04/rrpages/<railroad id>` (a railroad's section in that guide: offices, other offices, route miles, subsidiaries, page numbers, general equipment, common notes, and `lines`: `[{tableNo, miles, from, to, stations: [{miles, name, city, state, stationId?}]}]`); `newstations` (stations added in the Desk with temporary NEW-#### ids); `stationfixes/<StationID>` (corrections flagged for the ArcGIS layer: corrected `name`/`town`/`state`/`tz`, `was`, `note`; the Desk shows them already); `stationlists/current` (an imported station CSV).
- Train documents are stored compact: blank stop fields are left out, so scripts must tolerate missing fields.
- Batches: up to 50 writes, each pinned with `if_version`. Dylan wants few approval prompts: one batch per table where possible.

## Stations

- ArcGIS layer `Historic_Passenger_Stations` (key `StationID`). New stations: `StationID` = `"STN-" + Text($feature.OBJECTID, "00000")`, `StationLabel` = `Name (Town, State)`.
- After adding stations in ArcGIS: export the layer to CSV, load it in the Desk (Stations → Replace the station list), then swap each NEW-#### station for its real one in the same dialog.

## Entry conventions (agreed with Dylan)

- Weekday service is "Monday through Friday"; holidays are ignored. Alternate-day service: "Alternate days (from Apr 1, 1971)".
- When two tables disagree, use the more recently dated table and note it on the train; a disagreement that's in the Guide itself is marked as a known inconsistency.
- Through cars (cars run through) are kept separate from connections (passengers change). Links go on both trains.
- Trains with no equipment printed carry "Coaches" ("Coaches only"). Equipment endpoints go in From/To; a dash means both directions.
- Timing, schedule and transfer marks go in marks; baggage-only symbols go in notes.
- A mark that changes a time on certain days ("On Sundays operates 7 minutes earlier") means a separate run on those days, entered as its own train, not a change to this one.
- Trains of railroads with no tables yet are "Future railroad" placeholders and aren't flagged as problems.
- Mixed trains (passengers and freight) get the "Mixed service" tag. They carry no equipment unless the Guide prints some (no "Coaches" default).
- Condensed tables often print no date; a missing date on a condensed table isn't a problem.
- A stop printed with a mark but no time ("f –", a flag stop) is entered with the mark only (type "f" in the cell); it isn't flagged as missing a time.
- Equipment with a blank From/To runs the whole train: the Desk fills in the train's first and last stations when you move to another table.
- A railroad keeps one short name across renamings and reorganizations: each formal name is a period on the same record (D&H: Canal Company 1823–99, The D&H Company 1899–1930, Railroad Corporation 1930–68, Railway Company 1968–). Separate railroads that merged in go under Formed from / `rootFrom`. Chartered and began operating are kept apart. Mixed-only railroads get a neutral gray (#8C8F94) on the map.
- A railroad's page has a Railroad tab (identity, all guides) and one tab per guide (that guide's section, lines, consist); links from Home and tables open the guide tab.
- Next/Previous table follow the Guide's page order across railroads; tables are grouped under their railroad in the table picker, and each table links to its railroad's section for the guide.
- Tables can have no number and no name (common on small and freight lines); they show as "Name (no number)", or by their first and last stations ("Reader – Waterloo (no number)").
- Each railroad's pages in a guide go in its section's `pages` ("140–143"): they set its place in Guide order (Railroads page "Guide order", Home's next railroad, a new table's page). `noTimes` marks a railroad with passenger service that prints no timetables in that guide (its trains show "No timetable" instead of waiting to be entered).
- Two different trains can share a number on the same schedule (Santa Fe 17/18: El Capitan and The Super Chief, each with its own name, equipment and condensed table). They're separate train records marked `notSame`; add them by name ("17 - El Capitan, 17 - The Super Chief") so each table picks the right one. The map export gives each its name in the run id. A train printed twice with another name or days is different: that's a second appearance (`setupOf`).
- Bus legs aren't stops. A connection that changes stations by bus (SP 98 at San Francisco to SP 12 at Oakland) is a link with `otherStationId`.
