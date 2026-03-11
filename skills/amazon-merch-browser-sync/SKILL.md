---
name: amazon-merch-browser-sync
description: Pull Amazon Merch on Demand product analytics (daily purchased + estimated royalties) from Daniel’s Mac mini browser session when API/DB royalties are missing, stale, or zero. Use when asked to "use the Mac browser", verify zero royalties, backfill specific dates, or reconcile ads vs merch profitability with fresh browser data.
---

# Amazon Merch Browser Sync

Use this skill to collect fresh merch royalties from `https://merch.amazon.com/analyze/products` on Daniel’s Mac mini and reconcile them into local reporting.

## Workflow

1. **Use node browser proxy (not system.run)**
   - Run node browser actions via:
     - `openclaw nodes invoke --command browser.proxy ...`
   - Use node: `Daniel’s Mac mini` (id prefix `5d2ce2c3b3bc...`).
   - `system.run` may require approval; browser proxy is the reliable path.

2. **Find/open the Merch tab in profile `openclaw`**
   - Query tabs with `/tabs?profile=openclaw`.
   - Reuse an existing `merch.amazon.com/analyze/products` tab when available.
   - If missing, navigate target tab to that URL.

3. **Set requested date range explicitly**
   - Merch date inputs are readonly `input[ngbdatepicker]`.
   - Remove `readonly`, set both inputs (`From` + `to`), dispatch `input` + `change`, then click **Go**.
   - Wait for refresh (e.g. 1.5–2s) before extraction.

4. **Extract and validate values**
   - Read `document.body.innerText` and parse:
     - `DATE RANGE:<from> - <to>`
     - `USD <purchased> Purchased`
     - `USD <royalties> Estimated Royalties`
   - Reject result if page range does not match requested day/range.

5. **Return daily + weekly totals**
   - For daily pulls, report each day: purchased + royalties.
   - For weekly, sum daily royalties across requested window.
   - Clearly mark values as `browser-fresh`.

6. **Optional DB reconciliation**
   - Update `ads_data.db` `daily_pnl` royalties/purchased/source for corrected dates.
   - Recommended source label: `browser-fresh`.
   - Re-export verification CSVs after updates.

## Guardrails

- Always verify displayed `DATE RANGE` before trusting extracted numbers.
- Never trust API-only zero royalties for recent dates without browser verification.
- Prefer DB (`daily_pnl`) over stale JSON snapshots for final reporting after reconciliation.

## Snippets

For ready-to-use JSON payload patterns and evaluate snippets, read:

- `references/browser-proxy-snippets.md`
