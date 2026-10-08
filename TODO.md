# Map: flagged for the next update

## Date-based service (flagged 2026-10-07)
Some 1971 trains run on alternating days (e.g. City of Miami: "Leaves Chicago April 2, 4, 6, 8 ... and every other day thereafter"), not on fixed weekdays.
- Anchor the map to a calendar date: the first of the month of the guide (April 1, 1971 for the April 1971 Official Guide; the 1st of the month for any future guide), and base weekdays and rolling dates on that date.
- A train's pattern becomes data: either weekdays, or "every N days starting on date D" (with the period and anchor), instead of free text.
- Explore: when the map's date passes the end of one guide's month, switch automatically to the next published guide in the Desk (April 1971 -> May 1971 and so on), using each source's date. Fall back to the latest guide on or before the date.
