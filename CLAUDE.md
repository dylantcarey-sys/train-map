# train-map: notes for Claude

Dylan's personal project: historic passenger timetables (starting with the April 1971 *Official Guide of the Railways*) are entered in the **Timetable Desk** (a claude.ai artifact app), and an **ArcGIS map** animates the trains along historic rail lines. Personal project, not PTNY work.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The train map, hosted on GitHub Pages |
| `scripts/` | Modern-timetable (GTFS) fetch and build scripts for the map |
| `desk/src/page.html`, `desk/src/core.js` | Timetable Desk source (core.js holds parsing: times, marks, stop merging) |
| `desk/map-template/` | The map page the Desk embeds for its **Map** download button |
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
4. Publish `desk/dist/timetable-desk.html` with the Artifact tool to the Desk's URL: https://claude.ai/artifact/5Q5YhkF8LaqtskkSX1gTBe (keep its capabilities: db, downloads, user).
5. Commit the source and the built file together.

## The Desk's data

Stored in the artifact's database (edit with the ArtifactData tool, same URL). One source (guide) per Desk:
- `sources/og-1971-04/tables` and `sources/og-1971-04/trains`; `railroads`; `newstations` (stations added in the Desk with temporary NEW-#### ids); `stationlists/current` (an imported station CSV).
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
- Mixed trains (passengers and freight) get the "Mixed service" tag.
