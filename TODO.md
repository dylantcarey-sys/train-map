# Map: flagged for the next update

## Done 2026-10-12
- The map has a date (default: the 1st of the guide's month). Weekday, alternate-day service ("Alternate days (from Apr 1, 1971)"), one-off dates ("Runs February 12 and 15 only") and the PC Table 3 April 25 time change all follow it.
- Selecting a train shows its through run (gold), connections (dashed), and links in its details; "Show only this train and the trains it connects with".

## Still to do
- Explore: when the map's date passes the end of one guide's month, switch automatically to the next published guide in the Desk, using each source's date. Fall back to the latest guide on or before the date.
- Daylight (advance) time generally: guide times are standard time; only the PC Table 3 note is applied so far.
- ArcGIS notebook (`notebook/`): upload to ArcGIS Online and run Steps 1–6 (read-only) to find line gaps and stations far from any line, and get suggested "Served by" values. Check Step 5 results west of Akron and north of Marion. Step 8 is the only step that writes changes (after its dry run is switched off).
