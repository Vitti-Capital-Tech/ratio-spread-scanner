# Ratio Spread Scanner: Low-Level Design

This document covers the algorithms, formulas, data shapes and storage behind the scanner. See [HLD.md](HLD.md) for the architecture.

## 1. Modules and key functions

| File | Function / export | Purpose |
| --- | --- | --- |
| `src/api.js` | `apiGet(path, params)` | GET `/api{path}` and return `result` |
| | `loadProducts(underlying)` | Call and put option products |
| | `getExpiries(products)` / `getStrikes(products, settlementTime)` | Expiry list and strikes for one expiry |
| | `getSpotPrice(underlying)` | Spot from the perpetual ticker |
| | `getTickers(underlying, symbols)` | REST snapshot: quotes, greeks, IV, OI |
| | `createTickerStream(symbols, onTicker, onStatus)` | `v2/ticker` WebSocket that reconnects on close |
| `src/RatioSpreadScanner.jsx` | `startScan` | Reset state, REST backfill, open the stream |
| | `flushTickerBuffer` | Merge buffered ticks into `latestTickerDataRef` and state |
| | `computeSpreads(force)` | ATM strike, OI gate, `scanTickers` for calls and puts |
| | `scanTickers(tickers, atmStrike, getTickerPrice)` | Pair generation and entry filters |
| | `getTickerPrice(strike, type, field)` | Exact strike price or bracket average |
| | `publishTopSpreads` | Top 3 unique long strikes per side, written to storage and broadcast |
| | `updateConfig(key, value)` | Update config and persist it to `vitti_algo_config` |
| `src/ResultTable.jsx` | `resolveTickerPrice` | Same lookup as `getTickerPrice`, plus detail for tooltips |
| | `filteredResults` (memo) | ATM P&L, cap, leverage, hedge choice, margin, ROI, floors |
| | `HedgeLine` | Shows the top 2 hedge options by ATM ROI |
| `src/scannerUtils.js` | `leverageFor(symbolOrUnderlying, expiry?, now?)` | Short-leg leverage |
| | `listHedgeStrikes(...)` | All qualifying hedge strikes, nearest first |
| | `defaultOiCapM`, `effectiveOiCapM`, `isOiBlocked` | OI-limit gate |
| | `normalizeIv`, `toFiniteNumber`, `matchesOptionType` | Parsing helpers |
| `src/components/scanner/scannerDefaults.js` | `SCANNER_DEFAULTS`, `SCANNER_CONFIG_KEY`, `SAVED_SETTINGS_KEY` | Config schema and storage keys |
| `src/components/scanner/ScannerFilters.jsx` | `ScannerFilterToolbar` | Changed-count badge, saved settings, Save, Update, Reset |
| `src/components/common/dialogService.js` | `showAlert`, `showConfirm` | Promise-based dialog queue |
| `src/components/common/AppDialog.jsx` | `AppDialogHost` | Renders the dialog at the head of the queue |

## 2. Data shapes

### 2.1 Ticker (`latestTickerDataRef.current[symbol]`)

```js
{
  symbol, strike, type: 'call' | 'put', expiry, lotSize,
  bid, ask, lastPrice, markPrice,
  bidIv, askIv, iv,                  // normalised to percent
  delta, gamma, theta,
  deltaNotional,                     // |delta| × lotSize
  oiUsd, oiContracts,                // from oi_value_usd / oi_contracts
  oiLocked,                          // oi_reduce_only_mode → true / false / null
  lastUpdate, bidUpdatedAt, askUpdatedAt
}
```

### 2.2 Candidate pair (output of `scanTickers`)

```js
{
  buyLeg, sellLeg, strikeDiff, ivDiff,
  premiumRatio, deltaNotionalRatio, ratioDeviation,
  sellQty,          // delta-neutral base qty
  scaledSellQty,    // after ATM ratio scaling
  atmRatio, buyIntrinsic, sellIntrinsic,
  buyPrice, sellPrice, buyIv, sellIv,
  netPremium,       // 2-leg, or 3-leg for the provisional hedge
  deltaDiff, netDelta3,
  hedge,            // provisional: nearest qualifying option, or null
  hedgeOptions: [{ strike, price, iv, deltaNotional, unitQty, netPremium, netDelta3 }]
}
```

### 2.3 Config (`SCANNER_DEFAULTS`)

| Key | Default here | Meaning |
| --- | --- | --- |
| `minStrikeDiff` | 0 | Min \|sell strike − buy strike\| |
| `minIvDiff` | 0 | Min \|buy ask IV − sell bid IV\| |
| `maxRatioDeviation` | 0 | Max \|premium ratio − delta ratio\| / delta ratio |
| `minSellPremium` | 0 | Min short bid |
| `maxNetPremium` | 0 | Max net debit (after scaling and hedge) |
| `minLongDist` | 0 | Min \|long strike − spot\| |
| `maxSellQty` | 0 | Max base sell ratio (`0` is treated as 10) |
| `minAtmPnl` / `minAtmRoi` | 0 | ATM floors, used only when `atmRatioScaling` is on |
| `atmRatioScaling` | false | Turns on ATM ratio scaling |
| `atmRatioPctCall` / `atmRatioPctPut` | 0 | Scaling % toward the ATM ratio |
| `hedgeEnabled` | false | Hedge leg toggle |
| `hedgeLotPct` | 50 | Hedge qty as % of the scaled short qty |
| `hedgeMaxPrice` | 10 | Hedge ask must be below this |
| `hedgeIvDiffMin` / `hedgeIvDiffMax` | 0 / 2 | \|hedge IV − short IV\| range |
| `oiFilterEnabled` | false | OI-limit toggle |
| `oiMaxCapM` | null | OI cap in $M. `null` means the underlying default (BTC 15, ETH 10) |

The saved config is merged over `SCANNER_DEFAULTS` on load, so keys added later get their default value.

## 3. Feed pipeline

1. **Products**: `loadProducts` runs on underlying change and every 5 minutes. The first expiry is selected automatically.
2. **Spot**: `getSpotPrice` runs every 10 s.
3. **Start Scan**: close any open WebSocket, clear the ticker cache, and build the symbols for the selected expiry.
4. **REST backfill**: `getTickers` fills the cache. If a quote has a bid or ask, `bidUpdatedAt` / `askUpdatedAt` are set to `Date.now()` so the quote counts as fresh right away.
5. **Stream**: `createTickerStream` subscribes to every symbol. Each message is normalised (IV to percent, OI fields, delta notional) into `tickerBufferRef`. A missing field keeps its previous buffered value.
6. **Flush**: a 50 ms timer merges the buffer into `latestTickerDataRef` and React state.
7. **Scan trigger**: the scan runs if it has never run, or if at least 2000 ms have passed since the last one. A config change sets `force` and skips the throttle.

## 4. `computeSpreads`

1. **ATM strike**: the listed strike closest to spot, across all tickers.
2. **OI gate** (if `oiFilterEnabled`): `cap = effectiveOiCapM(oiMaxCapM, underlying)`. A ticker is dropped when `isOiBlocked(t, cap)` is true, which means `oiLocked === true` or `oiUsd ≥ cap × 1e6`. Unknown OI is allowed. Dropped tickers are excluded from long, short and hedge selection, but `getTickerPrice` still sees the full chain.
3. **Side split**: calls with `strike ≥ ATM`, puts with `strike ≤ ATM`.
4. Run `scanTickers` for each side, then `setResultsCall/Put`, `setGlobalAtmStrike`, and `publishTopSpreads`.

## 5. `scanTickers`: pairing and entry filters

Strikes are sorted, and every pair (i < j) is checked. For calls, the long is the lower strike. For puts, the long is the higher strike. Checks run in this order, and a pair is skipped at the first failure:

| # | Check |
| --- | --- |
| 1 | `strikeDiff = |sell.strike − buy.strike| ≥ minStrikeDiff` |
| 2 | Same expiry |
| 3 | `buyPrice = buy.ask > 0`, `sellPrice = sell.bid > 0` |
| 4 | Freshness: `now − buy.askUpdatedAt < 120 000` and `now − sell.bidUpdatedAt < 120 000` |
| 5 | IVs present (`askIv ?? iv`, `bidIv ?? iv`) and `ivDiff ≥ minIvDiff` |
| 6 | `|buy.strike − spot| ≥ minLongDist` |
| 7 | `sellPrice ≥ minSellPremium` |
| 8 | Delta notionals non-zero, and `|premiumRatio − dnRatio| / dnRatio ≤ maxRatioDeviation` |
| 9 | `sellQty = max(1, round(dnRatio / 0.25) × 0.25) ≤ (maxSellQty || 10)` |
| 10 | ATM ratio scaling gives `scaledSellQty` (§6.1) |
| 11 | Hedge options (§7). If the hedge is on and there are none, the pair is skipped |
| 12 | Max debit: `netPremium ≥ −maxNetPremium` (3-leg if hedged) |

Where `premiumRatio = buyPrice / sellPrice` and `dnRatio = buyDN / sellDN`.

Output order: by `|buy.strike − spot|` ascending, then by `netPremium` descending.

## 6. Formulas

### 6.1 ATM ratio scaling

```
buyIntrinsic  = price(ATM, type, 'bid')
sellIntrinsic = price(ATM ± strikeDiff, type, 'ask')      // + for calls, − for puts
atmRatio      = buyIntrinsic / sellIntrinsic
if atmRatioScaling and atmRatio known:
  r    = round(atmRatio / 0.25) × 0.25
  diff = max(0, r − sellQty)
  scaledSellQty = max(sellQty, round((sellQty + pct/100 × diff) / 0.25) × 0.25)
```

`pct` is `atmRatioPctCall` or `atmRatioPctPut`.

### 6.2 Price lookup with bracket average (`getTickerPrice` / `resolveTickerPrice`)

1. If the exact strike is listed: `t[field] ?? lastPrice ?? markPrice`, or `null` if it is not positive.
2. Otherwise take the nearest listed strike below and above the target, each within a tolerance (ETH 50 points, BTC 1000 points):
   - If both have a price, use their average.
   - If only one does, use that one.
   - If neither does, return `null`. The table then shows `—` for ATM P&L, margin and ROI.

### 6.3 Size, cap and leverage (in `ResultTable`)

```
shortValue = spot × totalSellQty × lotSize
if shortValue ≥ 195 000:
  scale = 195 000 / shortValue
  adjustedLotSize = lotSize × scale
  adjustedSellQty = totalSellQty × scale
  shortValue = 195 000
leverage = leverageFor(buyLeg.symbol)
```

`leverageFor` works as follows:

- The full leverage is ETH 100x, otherwise 200x.
- The expiry is read from the symbol suffix `-DDMMYY`, settling at 12:00 UTC (17:30 IST).
- If settlement is less than 48 h away (DTE 0–1), the full leverage applies. Otherwise it is `min(full, 100)`.
- If no expiry can be read, the full leverage applies.

### 6.4 ATM P&L, margin and ROI

```
legsPnl    = (buyIntrinsic − buyPrice) + (sellPrice − sellIntrinsic) × totalSellQty
baseMargin = buyPrice × adjustedLotSize + shortValue / leverage
```

Without a hedge:

```
atAtmPnl = legsPnl × adjustedLotSize
margin   = baseMargin
roi      = atAtmPnl / margin × 100
```

With a hedge, see §7.2.

### 6.5 ATM floors

Floors apply only when `atmRatioScaling` is on. A row is kept if `!hasAtmData || (atAtmPnl ≥ minAtmPnl && roi ≥ minAtmRoi)`. Rows without ATM data stay visible so they don't flicker in and out.

## 7. Hedge leg

### 7.1 Candidate strikes (`listHedgeStrikes`, in the scanner)

The pool is same-side, same-expiry tickers with `ask > 0`, excluding the spread's own legs and any OI-blocked strikes.

- `step` is the smallest gap between listed strikes in the pool.
- A strike is a candidate if it is beyond the short (above for calls, below for puts) and `0 < |k − short| ≤ strikeDiff − step`.
- Its price (`ask ?? lastPrice ?? markPrice`) must be `> 0` and `< hedgeMaxPrice`.
- Its IV (`askIv ?? iv`) must satisfy `hedgeIvDiffMin ≤ |iv − shortIv| ≤ hedgeIvDiffMax`.
- Candidates are sorted nearest to the short first.

For example, BTC 80000/81000 with a 200 step gives candidates 81200, 81400, 81600 and 81800.

For each option:

```
unitQty    = scaledSellQty × hedgeLotPct / 100
netPremium = scaledSellQty × sellPrice − buyPrice − unitQty × hedgePrice
netDelta3  = buyDN − scaledSellQty × sellDN + unitQty × hedgeDN
```

Only options with `netPremium ≥ −maxNetPremium` are kept. The nearest one is the provisional `hedge`.

### 7.2 Choosing the hedge and pricing it (in `ResultTable`)

For each option `h`:

```
qty      = adjustedSellQty × hedgeLotPct / 100              // after the $195k cap
offset   = h.strike − buyLeg.strike
atAtm    = bid at (ATM + offset)                             // unquoted → 0 (premium lost)
pnl      = (legsPnl + (atAtm − h.price) × totalSellQty × hedgePct) × adjustedLotSize
margin   = baseMargin + h.price × adjustedSellQty × hedgePct
roi      = pnl / margin × 100
```

The row uses the option with the highest ROI, with ATM P&L as the tie-break. If no option can be priced, the first (nearest) option is used. That option's P&L, margin, ROI, net premium and `netDelta3` replace the 2-leg values. `HedgeLine` lists the top 2 by ROI, with ✓ marking the chosen one.

## 8. Table layout

- Rows are grouped by long strike. The group header shows the highest-ROI row, and expanding it shows the alternate shorts sorted by ROI.
- Groups are ordered by distance from ATM: calls ascending, puts descending.
- Columns: Strikes, Premium (L/S), Ratio (L/S), Net Premium & IV Edge, OI (L/S), ATM Pricing, ATM Edge (P&L), Req. Margin.
- **OI (L/S)** shows strike OI in $M, with 🔒 when `oiLocked`. Hover shows OI in USD and contracts, the leg deltas, the net delta, and the 3-leg delta.
- **Ratio** is shown in gold when the scaled qty differs from the base qty.
- ATM-pricing tooltips explain exact, bracket, single-neighbour or omitted lookups.

## 9. Saved settings and dialogs

- `vitti_scanner_presets_v1` holds `[{ name, values }]`, where `values` is a full snapshot of every `SCANNER_DEFAULTS` key.
- **Apply** writes each value through `updateConfig` and remembers the applied name. Once any filter changes, that chip is marked as modified and shows **⟳ Update**.
- **+ Save** with an existing name, and **Update**, both ask with `showConfirm(...)` first.
- **Reset** returns every key to `SCANNER_DEFAULTS`.
- `dialogService` keeps a module-level queue. `showConfirm` returns a `Promise<boolean>`. `AppDialogHost` uses `useSyncExternalStore` to render the head of the queue.

## 10. Cross-tab publish

After each scan, `publishTopSpreads` takes the top 3 unique long strikes per side and writes them to:

- `localStorage['vitti_scanner_top_spreads_v1']`
- `BroadcastChannel('option-scope-sync')`, as a `SCANNER_TOP_SPREADS_SYNC` message

The payload is:

```js
{ underlying, expiry, timestamp,
  callTop3: [{ id, buySymbol, sellSymbol, buyStrike, sellQty }],
  putTop3:  [...] }
```

Stopping the scan publishes an empty payload.

## 11. Sync rules with Option Scope

- `leverageFor`, `listHedgeStrikes`, `pickHedgeStrike` and the OI helpers are twins of Option Scope's `engine/lib/utils.js`. Change both together.
- The ATM bracket tolerance (BTC 1000, ETH 50) also matches the engine's `getTickerPrice`.
- When porting from Option Scope, keep these local differences:
  - The filter defaults are `0`.
  - There is no `SendToWindow`.
  - There are no order-book helpers in `api.js`.
