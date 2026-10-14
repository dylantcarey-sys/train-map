# Map: flagged for the next update

## Done 2026-10-12
- The map has a date (default: the 1st of the guide's month). Weekday, alternate-day service ("Alternate days (from Apr 1, 1971)"), one-off dates ("Runs February 12 and 15 only") and the PC Table 3 April 25 time change all follow it.
- Selecting a train shows its through run (gold), connections (dashed), and links in its details; "Show only this train and the trains it connects with".

## Still to do
- Lines layer: add the Callahan Cut-off (the SCL bypass near Callahan, FL); SCL 1 / SCL 2 should be routed over it. It isn't in the ArcGIS lines layer yet. Once it's drawn, give it the SCL "Served by" value; if the map still prefers the old line, type it in those trains' "Rail lines it runs on" box in the Desk.
- Explore: when the map's date passes the end of one guide's month, switch automatically to the next published guide in the Desk, using each source's date. Fall back to the latest guide on or before the date.
- Daylight (advance) time generally: guide times are standard time; only the PC Table 3 note is applied so far.
- Lines layer: the only route gap for entered trains (notebook run 2026-10-12) is Henderson -> Evansville (L&N 4): the L&N Henderson Subdivision doesn't connect to the L&N St. Louis-Evansville Line across the Ohio River. Four stations are >250 m from a line (St. Joseph, Tulsa, Orillia, Havelock), none used yet. "Served by" needed no changes.
- LIRR connecting trains (Penn Station / Flatbush Avenue to and from Jamaica) have only one printed time, so the map leaves them off. Dylan may add their Jamaica times later from an LIRR timetable of the period.

## Map speed: revisit later (discussed 2026-10-12)
Repeat visits already reuse lines, stations and routes saved in the browser; the first visit on each device is still slow. Options, in the order recommended:
1. Work out routes ahead of time: a GitHub Actions job (button / after ArcGIS edits / weekly) downloads the layers, routes every train with the map's own core, and publishes a small routes file next to the map. The browser then skips the lines download and route-finding entirely. Re-run after editing lines or adding trains.
2. Let ArcGIS draw the background lines (FeatureLayer with a renderer by "Served by") instead of downloading every line's geometry to colour it in the browser.
3. Move the built-in timetable (~4 MB of CSV inside index.html) to a compressed file loaded alongside the page.

## Desk: changes to make later
- Tables the Guide prints without a number or letter (the Little Rock condensed table, both RF&P tables): Dylan gave them numbers so the Desk works. Let a table have no number (named by railroad and title instead) and keep Guide order by page.
(done 2026-10-12: marks box, table view width and two-direction layout, Add trains picker/ticks)
