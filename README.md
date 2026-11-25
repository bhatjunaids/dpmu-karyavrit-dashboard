# DPMU karyavrit quality register

A dashboard for the quality of district DPMU review meetings in UP. Each month, every district's karyavrit (minutes) is read by Claude, filled into the tracker fields, and scored on the 100-point rubric from `DPMU_Meeting_Quality_Tracker_v2.xlsx` (Process 20, Agenda 50, Follow-through 30).

```
 you paste Drive links ──► Google Sheet "DPMU Karyavrit Register" ◄── Apps Script imports + scores (hourly)
                                   │                                            ▲
                                   │ web app (JSON)                              │ JSON results in Drive/_inbox
                                   ▼                                            │
                  GitHub Pages dashboard (this repo)          Daily Claude scheduled task reads new links
```

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Google Sheet | Drive › DPMU Karyavrit Register | One row per district per month. All history lives here. |
| Apps Script | Bound to the Sheet (Extensions › Apps Script); code in `apps-script/Code.gs` | Every hour, imports results from `_inbox` into the Sheet and scores them. Serves the data to the dashboard. Adds the **Karyavrit** menu. |
| Daily Claude task | Claude › scheduled task "DPMU karyavrit daily read" (07:43 IST) | Finds rows with a new link, reads each karyavrit PDF, and writes one JSON result per karyavrit into `_inbox`. It follows `Claude reading instructions.md` in the Drive folder. |
| Dashboard | This repo on GitHub Pages | Has a **Monthly** tab (month and mandal filters) and a **Composite** tab (all months). It only reads data. |

No API key is needed. If you add an `ANTHROPIC_API_KEY` in the script's Script properties later, the script also reads new links itself within the hour.

## Every month

1. In the Sheet, run **Karyavrit → Add 75 district rows for a month…** and type the month, for example `Dec-2026`.
2. Put each district's karyavrit in Drive as a PDF (a scan is fine) and paste its link into **Karyavrit link** as a plain URL, not a "chip" or linked text.
3. Optional: list that month's priorities in the **Priorities** tab.
4. The next morning's Claude task reads the new links. The Sheet imports the results within the hour, and the dashboard shows them on its next load.

**Older months:** add rows for that month and paste the links in the same way.

## Fixing things

| Situation | What to do |
|---|---|
| Claude got a field wrong | Edit the cell in the Sheet, then run **Karyavrit → Recalculate scores**. The dashboard always recalculates from the fields. |
| The wrong file was linked | Paste the right link. The changed link is read again on the next daily run. |
| You want a fresh read of the same file | Type `Re-read` in the row's **Status** cell. |
| **Status** shows `Error: …` | Fix the cause, then clear the Status cell. |
| AI notes begin with `Check:` | The MoM looked like it came from a different district or month. Verify the link. |
| A file in `_processed` starts with `ERROR` | That result file couldn't be imported. Open it to see why, then fix the row and clear its Status. |

PM-filled columns (AU–BF: presence, pre-alignment, WhatsApp, portal, VSK call, rating) are never overwritten.

## Things to know

- **Visibility:** the dashboard and the web-app URL in `config.js` are public. Anyone who has them can see district names, scores and the extracted fields. The PDFs only open for people with Drive access.
- **Updating the script:** paste the new code in Apps Script, save, then go to **Deploy → Manage deployments → Edit → Version: New version**. The `/exec` URL stays the same.
- **Scoring:** uses the tracker's Scoring-sheet weights exactly, and gives the tracker's example row 19 + 43 + 25.5 = 87.5, Functional. The weights (`W` and `TH`) appear in both `apps-script/Code.gs` and `index.html`. Keep them the same.
