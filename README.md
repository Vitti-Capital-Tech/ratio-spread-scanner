# Ratio Spread Scanner

A real-time scanner for BTC and ETH option **ratio spreads** on Delta Exchange India. It pairs every listed option for an expiry into "buy 1 / sell N" spreads, filters them, sizes them delta-neutral, and projects each spread's P&L and ROI if spot moves to the long strike (the ATM edge).

This is the standalone version of the **Ratio Spread** tab from Option Scope. It runs entirely in the browser: there is no backend or database, and filter settings are stored in `localStorage`.

## Features

- **Live data**: a REST snapshot of `/v2/tickers` at start, then the Delta `v2/ticker` WebSocket stream. Ticks are buffered for 50 ms, and spreads are recomputed at most every 2 s (or immediately when a filter changes).
- **Entry filters**: min strike diff, min IV diff, max ratio deviation, min sell premium, max net debit, min long distance from spot, and max sell ratio. Both legs must have quotes no older than 120 s.
- **Delta-neutral sizing**: short qty = long delta notional ÷ short delta notional, rounded to 0.25.
- **ATM ratio scaling** (optional): when the ATM premium ratio is above the strike ratio, the short qty moves toward it by a call or put %. When the two are equal, the short qty is increased by that % (entries above 100 count as the value minus 100). Also turns on the **Min ATM P&L** and **Min ATM ROI** floors.
- **ATM edge**: P&L, required margin and ROI if spot reaches the long strike. Every row is sized to the same short notional: $195,000 at 200x leverage, $95,000 at 100x. Rows are scaled up or down to hit it. Leverage depends on the underlying and expiry: BTC 200x and ETH 100x at DTE 0–1, and at most 100x for later expiries.
- **Hedge leg** (optional): a 3rd long beyond the short, sized as scaled short qty × Hedge Lot %. Qualifying strikes are under Max Hedge Price and inside the Hedge IV Diff range, and must keep the net premium within Max Net Debit. The row uses the one nearest the short, the same choice paper trading makes. With the toggle on, only hedged spreads are shown.
- **Open interest limit** (optional): hides spreads with a leg on a strike that Delta has made reduce-only, or whose OI is at or over Max OI. The default cap is BTC $15M and ETH $10M. The table shows an **OI (L/S)** column, with 🔒 on locked strikes.
- **Saved filter settings**: save, apply, update, delete or reset full filter snapshots from the toolbar. Each setting also remembers the underlying and expiry it was saved on, and applying it opens that market (an expired date falls back to the nearest one). Confirmations use an in-app dialog.
- **Remembers the market**: the last underlying and expiry are reopened after a page refresh.
- Results are grouped by long strike, with alternate shorts sorted by ROI. Light and dark themes are supported, and the layout works on mobile.

## Tech stack

React 19, Vite 8, Tailwind CSS 4 (with a hand-written `src/index.css`), and lucide-react icons.

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve the build
```

The browser calls Delta's REST API through `/api`:

- **Dev**: the Vite proxy in [vite.config.js](vite.config.js) forwards `/api/*` to `https://api.india.delta.exchange/*`.
- **Production (Vercel)**: [vercel.json](vercel.json) rewrites `/api/*` the same way and sends every other path to `index.html`.

The WebSocket connects directly to `wss://socket.india.delta.exchange`.

## Usage

1. Pick the underlying (BTC or ETH) and an expiry.
2. Set the filters, or apply a saved setting.
3. Click **Start Scan**. The Call and Put tabs fill in and update live.
4. Expand a long strike to see the alternate short strikes. Hover cells for the ATM pricing details and OI breakdown.

## Browser storage

| Key | Contents |
| --- | --- |
| `vitti_algo_config` | Current filter config |
| `vitti_scanner_presets_v1` | Saved filter settings, each with its underlying and expiry |
| `vitti_scanner_market_v1` | Last underlying and expiry |
| `vitti_scanner_top_spreads_v1` | Top 3 call and put spreads from the last scan, also sent on the `option-scope-sync` BroadcastChannel |
| `theme` | `dark` or `light` |

## Project structure

```
src/
  main.jsx                     App root: theme state and dialog host
  RatioSpreadScanner.jsx       Page: data loading, WebSocket, scan loop, filter bar
  ResultTable.jsx              ATM pricing, hedge choice, margin and ROI, grouped table
  scannerUtils.js              Leverage, hedge strike selection, OI-limit helpers
  api.js                       Delta REST and WebSocket client
  index.css                    All styles
  components/
    scanner/ScannerFilters.jsx    Saved-settings toolbar
    scanner/scannerDefaults.js    Filter defaults and storage keys
    common/                       CustomInput, CustomSelect, AppDialog and dialogService
    RatioSpreadScanner/Navbar.jsx Top navigation bar
docs/
  HLD.md                       High-level design
  LLD.md                       Low-level design: algorithms, formulas, data shapes
```

## Keeping in sync with Option Scope

This repo mirrors the Ratio Spread tab in Option Scope and must behave the same way. The scanner files (`RatioSpreadScanner.jsx`, `ResultTable.jsx`, `scannerUtils.js`, `index.css`, `components/scanner/*`, `components/common/*`) are copied from Option Scope as they are, except for the filter defaults. `scannerUtils.js` (leverage, notional cap, ATM scaling, `listHedgeStrikes` and the OI helpers) must also match Option Scope's engine copies, so that the margin and ROI shown here are the same numbers its paper and live engines use.

When you port changes, keep only these differences:

- The filter defaults in `scannerDefaults.js` (strike diff, IV diff, ratio deviation, sell premium, net debit, long distance, max ratio, call and put scaling) are deliberately all `0`. Option Scope uses 800, 5, 0.25, 10, 20, 500, 10 and 50.
- `Navbar.jsx` lives in `components/RatioSpreadScanner/` (Option Scope uses `components/PaperTrading/`) and has only the Ratio Spread tab.
- There is no **Send to Window** button (`SendToWindow.jsx`, `onSendToWindow`, `loadScannerFilterSources`), because this repo has no Supabase or paper trading.
- Order-book helpers from Option Scope's Trade tab are not included in `api.js`.
- `main.jsx` renders only the scanner page.
