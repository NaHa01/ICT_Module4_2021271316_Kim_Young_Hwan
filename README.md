# Real-Time Financial Indicator Monitoring Dashboard

A demo application that monitors exchange rates and Korean/US stock indices in real time — and keeps the data flowing through failures: it **detects a main-API failure → reroutes to a backup → recovers automatically**, so the user never sees a frozen or empty screen.

> 🎬 **Demo video**: [▶Watch the video here](https://youtu.be/6b4sfYH8waE) or click the image

>[![Video](https://img.youtube.com/vi/6b4sfYH8waE/maxresdefault.jpg)](https://youtu.be/6b4sfYH8waE)
> 
>
> 🛠️ For the major bugs we hit and how we solved them, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## 1. Overview & Purpose

In a real-time financial monitoring system, failing to receive data because the main source is slow or down is critical.
This project **detects** network failures of the main API, automatically **fails over** to backup APIs for uninterrupted data, and **recovers** automatically once the main source is healthy again — reproducing and visualizing the entire flow safely.

| Item | Description |
|------|-------------|
| Domain | Finance (FX rates · Korean/US stock indices) |
| Core value | Detect → reroute → auto-recover API failures for uninterrupted real-time monitoring |
| Data | Real external data (Korea Investment & Securities (KIS) · Kiwoom · Frankfurter/ECB · Yahoo · Naver) + mock fallback when every stage fails |
| Refresh strategy | **7 indicators split across two production KIS keys, each refreshed every ≈1 second.** Each key continuously re-polls its assigned indicators in a loop, paced to stay within the per-TR (endpoint) rate limit |

> ℹ️ **KIS rate limit (EGW00201) and the two-key design**: The official documentation only specifies a per-appkey limit (**~20 calls/sec** on the production domain). In our measurements, however, `EGW00201` ("transactions per second exceeded") kept firing even with total calls hard-capped at 5/sec. Since our 7 indicator calls concentrate on just two TRs (overseas = `FHKST03030100`, domestic = `FHPUP02100000`), we hypothesized a **per-TR limit of ~2 calls/sec** — an **empirical hypothesis not found in any official document** — and split the indicators across **two production APP_KEYs** so that each key stays ≤2 calls/sec per TR. After the split, EGW errors dropped to zero, consistent with the hypothesis.
>
> 👉 Each key spaces its calls by `1000ms ÷ (number of assigned indicators)` so that one round takes ≈1 second. If the second key is not configured, the app automatically falls back to single-key mode (key A handles all 7 indicators).

---

## 2. Key Features

### 2.1 Failure Detection · Rerouting · Auto-Recovery (Failover & Auto-Recovery)
- **Real external calls are what gets monitored**: a **1-second response threshold** (`MAIN_TIMEOUT_MS`) is applied to the main (primary provider = KIS key) calls made by the background real-time loop. The simulate button merely injects a 3-second delay into this call path — detection, transition, and recovery all run through exactly the same code as a real failure.
- **The moment a call exceeds the threshold**, it is treated as a timeout and the state transitions to **`Constrained`**. For the next 1 second (one polling cycle) card updates are frozen so the last good values stay on screen (nothing goes blank, nothing flickers). If transient jitter makes the indicator too twitchy in production, raise `networkState.PRIMARY_FAIL_THRESHOLD` (default 1) to require N consecutive failures.
- **On the very next poll**, the main is skipped and the system reroutes to the **backup providers (the other KIS key / Kiwoom / Yahoo / Frankfurter)**; on success the state becomes **`Recovered`** and updates resume.
- **5 seconds after** entering `Recovered` (`AUTO_RECOVERY_MS`), the backend auto-releases the injected delay and **re-checks (probes) the main**; if it responds normally, the state smoothly returns to **`Normal`**. If the main is genuinely still down, it is re-probed every 5 seconds while the backup chain keeps serving data.
- **Partial failures (only one KIS key down) are handled precisely**: failures are tracked per provider (per key). Only the indicators owned by the dead key freeze and reroute; indicators on the healthy key keep being served by the main path. Recovery probes target only the dead provider, so a healthy key's success is never mistaken for full recovery (no state flapping), and `Normal` returns only after every dead key has recovered. A dead key is also never used as a backup for other indicators (avoids wasted timeouts). Verified by `src/scripts/verify-partial-failure.js`.
- The state (`networkStatus`) is decided by the **backend as the single source of truth**; the front end only renders it.

### 2.2 Real-Time Indicator Monitoring
- 7 indicator cards: **USD/KRW, EUR/KRW, KOSPI, KOSDAQ, KOSPI200, S&P 500, NASDAQ**.
- Quotes are split across **two production KIS keys**:
  - **Key A**: USD/KRW · EUR/KRW · KOSPI
  - **Key B**: KOSDAQ · KOSPI200 · S&P 500 · NASDAQ
- Each key continuously re-polls its assigned indicators in a loop, so **every indicator refreshes about once per second**, and the public snapshot is swapped on every fetch.
- If one key fails, the fallback order is **the other key → Kiwoom (domestic indices) → Yahoo → Frankfurter (FX, ECB daily) → mock**. Frankfurter is a daily fixing (not real-time), so it sits behind the near-real-time Yahoo, right before mock.
- ℹ️ **About the EUR/KRW value**: KIS does not provide EUR/KRW directly, so it is computed as a **cross rate: EUR/USD (`FX@EUR`) × USD/KRW (`FX@KRW`)**. KIS FX quotes are posted (reference-style) rates rather than live ticks, so the displayed value can differ from portal benchmark rates or live market rates by **roughly 0.5% (a few to ~15 KRW per euro)**, especially when `FX@EUR` lags. This is a characteristic of the source, not a calculation bug.
- The front end polls every second. Following Korean market convention, **up = red, down = blue**.
- Clicking a card opens a **detail page** (period tabs 1d · 1w · 1m · 1y · 3y + a large line chart); the ▼ icon expands a compact chart right under the card.

### 2.3 Economic News Sidebar
- Fetches news via the Naver Search (news) API for the keywords "증시" (stock market) and "환율" (exchange rate), strips/sanitizes HTML tags, and renders the list.
- Falls back to mock news automatically if API keys are missing or the call fails.

### 2.4 Failure Simulation
- The **"simulate failure"** button in the header injects/clears an artificial 3-second delay on the main (primary provider) call path — it goes through the same detection path (1-second timeout) as a real latency failure.
- When auto-recovery completes, the button automatically syncs back to OFF.

---

## 3. System Architecture

```
 [External data sources]                  [Backend :4000]                   [Frontend :5173]
 ┌──────────────────────┐                 ┌───────────────────────────┐
 │ KIS key A (3) main   │ per-key loops   │  marketData realtime loop │
 │ KIS key B (4) main   │ round ≈1s       │   1s threshold on main    │
 │ Kiwoom (KR backup)   │ ≤2 calls/s/TR   │   (simulation = delay)    │
 │ Frankfurter (FX)     │ ─live fetch───► │      │ report ok/fail     │  1s polling    ┌──────────────┐
 │ Yahoo (chart·backup) │                 │      ▼                    │ ◄─────────────│ React + Vite │
 │ Naver (news)         │                 │  networkState machine     │  /api proxy   │  Dashboard   │
 └──────────────────────┘                 │  Normal/Constrained/      │ ─────────────►│  DetailPage  │
                                          │  Recovered + 5s probe     │  JSON         └──────────────┘
                                          │      │ mode(main/freeze/  │
                                          │      ▼       backup)      │
                                          │  cached public snapshot   │
                                          └───────────────────────────┘
```

**Core design**
- **Two-key KIS split + per-key real-time loops**: the 7 indicators are divided into **key A (usdkrw · eurkrw · kospi)** and **key B (kosdaq · kospi200 · sp500 · nasdaq)**. Each key gets an independent client instance (separate token, throttle queue, stats) that re-polls its indicators continuously, refreshing **every indicator about once per second**. The public snapshot is swapped on every fetch, so the front end's 1-second polling always reads the latest snapshot (and never hits external APIs directly).
  - **Avoiding the rate limit (EGW00201) = ≤2 calls/sec per TR**: `EGW00201` reproduced even at 5 calls/sec total — far below the official per-appkey limit (20/sec) — so we estimated a **per-TR limit of ~2 calls/sec** (an empirical hypothesis, not in the official docs). The 7 calls concentrate on two TRs (overseas `FHKST03030100` · domestic `FHPUP02100000`), so splitting across keys A/B keeps each key at 2 overseas-TR calls and ≤2 domestic-TR calls. With `minGap = 1000ms ÷ (assigned indicators)`, one round is ≈1s → ≤2 calls/sec per TR; **after the split, EGW count stayed at zero, validating the hypothesis**. (`usdkrw` and `eurkrw` are kept on the same key A so the `FX@KRW` micro-cache deduplication keeps working.)
  - ⚠️ **Operational note**: the KIS rate limit is **aggregated per key** — running two processes with the same key (e.g., the backend plus a verification script) sums their calls and EGW comes back. Run one process at a time when measuring or operating.
- **Mutual failover**: quotes resolve in the order `primary key → the other KIS key → Kiwoom (domestic) → Yahoo → Frankfurter (FX) → mock`. Any single key or provider can die and all 7 indicators still serve real data (mock only when everything fails). Frankfurter (ECB) is a daily fixing, so it is placed behind the near-real-time Yahoo.
- **Charts barely touch KIS**: index charts are built from **Yahoo (historical daily/weekly/minute bars) + a live tail** (history accumulated from the real-time loop — zero extra external calls); FX charts use **Yahoo minute bars / Frankfurter (ECB) daily·weekly bars**. KIS is only used as a fallback when those fail, so chart traffic never eats into the real-time quote budget.
- **Detection is based on real calls; the server owns all state decisions**: the 1-second threshold applies to the actual main (primary provider) calls in the background loop, and all transitions (threshold breach → Constrained, backup success → Recovered, probe success after 5s → Normal) are owned by the backend state machine. The front end simply trusts `networkStatus` and renders. The simulate button only injects a delay into the main call path so it travels the same detection path.

### State machine

```
        [real failure or button: main call delayed/failing]
Normal ────────────────────────────► (the moment a main call exceeds 1s)
  ▲                                          │
  │                                          ▼
  │                                    Constrained  ── freeze 1s (one polling cycle; orange·blinking, last data kept)
  │                                          │
  │       [on the very next poll: backup provider (other KIS key/Kiwoom/Yahoo/fx) succeeds]
  │                                          ▼
  │                                     Recovered  ── 5s timer starts on entry (purple)
  │   [+5s: delay auto-released →                       │
  │    main re-check (probe) succeeds]                  │
  └──────────────────────────────────────────────────┘
```

---

## 4. Tech Stack

| Category | Technology |
|----------|------------|
| Language | JavaScript (ESM) |
| Backend | Node.js, Express 4 |
| Frontend | React 18, Vite 5, React Router 6, Recharts 2 |
| Transport | REST + polling |
| External APIs | Korea Investment & Securities (KIS, two production keys — FX & index quotes) · Kiwoom (REST, domestic-index backup) · Yahoo Finance (index/FX charts + quote backup, unofficial) · Frankfurter (ECB FX, last backup) · Naver Search (news) |
| Backend dependencies | `express`, `cors`, `dotenv` |

> Even with no external API keys at all, everything still runs on mock data — the full demo works without keys.

---

## 5. Folder Structure

```
realtime-financial-monitor/
├── README.md                             # System overview · logic · setup · demo video
├── TROUBLESHOOTING.md                    # Major bugs we hit and how we solved them
│
├── src/                                  # Backend source (Node.js + Express)
│   ├── package.json
│   ├── .env.example                      # Environment variable template
│   ├── server.js                         # Express entry point; routes/CORS; starts background refresh
│   ├── config.js                         # Env loading + sane defaults (incl. 1st/2nd KIS keys)
│   ├── scripts/                          # Live verification scripts (verify-failover etc.)
│   ├── routes/
│   │   ├── financial.js                  # GET  /api/financial-data
│   │   ├── simulate.js                   # POST /api/simulate/toggle
│   │   ├── news.js                       # GET  /api/news
│   │   └── chart.js                      # GET  /api/chart/:id
│   ├── services/
│   │   ├── marketData.js                 # Orchestrator (2-key split · 1s main threshold · failover · per-key loops · charts)
│   │   ├── failover.js                   # Assembles the /api/financial-data response (state + snapshot → API contract)
│   │   ├── newsService.js                # Naver news + sanitize + mock fallback
│   │   └── external/
│   │       ├── kisClient.js              # KIS client factory (createKisClient): per-key OAuth·throttle·stats·cache
│   │       ├── kiwoomClient.js           # Kiwoom REST OAuth + sector (domestic index) quote backup (throttle queue)
│   │       ├── fxClient.js               # Frankfurter (ECB) FX quote / daily·weekly history (no key needed)
│   │       └── yahooClient.js            # Yahoo Finance index/FX minute & daily bars (no key needed)
│   └── state/
│       └── networkState.js               # Network state machine (driven by real call results) + 5s auto-recovery·probe
│
├── data/                                 # Sample (synthetic) data — example JSON for the API contract
│   ├── sample-financial-data.json        # Shape of GET /api/financial-data
│   ├── sample-chart-kospi-1d.json        # Shape of GET /api/chart/:id
│   └── sample-news.json                  # Shape of GET /api/news
│
└── dashboard/                            # Web GUI (React + Vite)
    ├── package.json
    ├── vite.config.js                    # Proxies /api → backend (4000)
    ├── index.html
    └── src/
        ├── main.jsx                      # Entry (BrowserRouter)
        ├── App.jsx                       # Routing (/ , /detail/:id)
        ├── api/client.js                 # fetch wrapper
        ├── context/
        │   └── FinancialProvider.jsx     # Runs the 1s polling once app-wide → shared via context
        ├── hooks/
        │   ├── useFinancialData.js       # 1s polling (keeps last values while Constrained)
        │   └── useNews.js                # News refresh every 60s
        ├── pages/
        │   ├── Dashboard.jsx             # Dashboard (7:3 layout)
        │   └── DetailPage.jsx            # Indicator detail (period tabs + large chart)
        ├── components/
        │   ├── Header.jsx                # Title + indicator + simulate button
        │   ├── NetworkIndicator.jsx      # Status dot + label (Normal/Constrained/Recovered)
        │   ├── SimulationButton.jsx      # Failure-simulation toggle
        │   ├── IndexGrid.jsx             # Sectioned card grid (accordion)
        │   ├── IndexCard.jsx             # Indicator card (value/change/color/time)
        │   ├── ChartPanel.jsx            # Compact chart under a card
        │   ├── DetailChart.jsx           # Large line chart on the detail page
        │   ├── PeriodTabs.jsx            # Period tabs (1d/1w/1m/1y/3y)
        │   ├── NewsList.jsx / NewsItem.jsx # News sidebar
        │   └── ...
        ├── utils/time.js
        └── styles/
            ├── tokens.css                # Color design tokens
            └── app.css                   # Layout/component styles
```

---

## 6. Setup & Run

### Prerequisites
- Node.js 18+ (the backend uses the built-in `fetch` / `AbortSignal.timeout`)

### 1) Backend

```bash
cd src
npm install
copy .env.example .env     # Windows (PowerShell/CMD)
# cp .env.example .env      # macOS/Linux
npm start                   # http://localhost:4000
```

### 2) Dashboard (new terminal)

```bash
cd dashboard
npm install
npm run dev                 # http://localhost:5173
```

Open **http://localhost:5173** in a browser. The Vite dev server proxies `/api` requests to the backend (4000).

### `.env` settings (`src/.env`)

> Every key is **optional**. Anything missing automatically falls back (Yahoo/Frankfurter or mock), so the demo never blocks.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Backend port |
| `MAIN_TIMEOUT_MS` | `1000` | Response threshold (ms) for main API calls |
| `INJECTED_DELAY_MS` | `3000` | Artificial delay (ms) injected into the main path while simulating |
| `AUTO_RECOVERY_MS` | `5000` | Time from `Recovered` until the delay auto-releases (ms) |
| `INDICATOR_GAP_MS` | `150` | Lower bound (ms) on the gap between any external calls; acts as the floor for per-key pacing (`1000 ÷ assigned indicators`). `.env.example` uses `140` |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | (none) | **KIS key A** (production). Without it, quotes fall back to Kiwoom/Yahoo/Frankfurter → mock |
| `KIS_MOCK_TRADE` | `true` | `true` = paper-trading domain (:29443), `false` = production domain (:9443). Use `false` for production keys (the `.env.example` default) |
| `KIS_APP_KEY2` / `KIS_APP_SECRET2` | (none) | **KIS key B** (second production key). If present, indicators are split A/B to avoid the per-TR limit (EGW00201); otherwise single-key mode (key A handles all 7) |
| `KIS_MOCK_TRADE2` | (= `KIS_MOCK_TRADE`) | Key B domain; normally `false` for production |
| `KIWOOM_APP_KEY` / `KIWOOM_APP_SECRET` | (none) | Kiwoom REST keys (domestic-index **backup**). Without them, domestic indices fall back via the other KIS key → Yahoo → mock |
| `KIWOOM_MOCK_TRADE` | `true` | `true` = mock domain (mockapi.kiwoom.com), `false` = production (api.kiwoom.com) |
| `KIWOOM_MAX_PER_SEC` | `1` | Kiwoom calls-per-second cap. Measured limit is ~1 call/sec, hence default 1 (uniform 1000ms spacing) |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | (none) | Naver news API keys. Without them, mock news is shown |

> Frankfurter (FX) and Yahoo (index/FX charts · backup quotes) require **no keys**.
>
> ⚠️ **The KIS rate limit is aggregated per key.** Do not run the backend and a verification script (`scripts/verify-realtime.js`, etc.) at the same time with the same key — their calls sum up and EGW00201 fires.

---

## 7. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/financial-data` | Real-time indicators (FX · indices) + `networkStatus`. Polled every second by the front end |
| `POST` | `/api/simulate/toggle` | Toggle the failure simulation. Body: `{ "enabled": true }` |
| `GET` | `/api/chart/:id?range=1d\|1w\|1m\|1y\|3y` | Line chart per period. 1d = Yahoo minute bars + live tail (`yahoo+live`) for indices · Yahoo minute bars for FX; 1w–3y = Yahoo daily/weekly bars for indices · Frankfurter (ECB) for FX. Falls back to KIS · mock |
| `GET` | `/api/news` | Economic news (Naver or mock) |
| `GET` | `/api/health` | Health check + source/network summary (incl. `sources.kis` · `sources.kis2` · `sources.kiwoom` call stats) |

### `GET /api/financial-data` — example response

```json
{
  "networkStatus": "Normal",
  "source": "main",
  "responseTimeMs": 120,
  "timestamp": "2026-06-11T12:00:00.000Z",
  "indices": [
    { "id": "usdkrw", "name": "USD/KRW", "category": "fx",       "value": 1530.50, "change": 5.80,  "changePercent": 0.38,  "direction": "up",   "source": "kis"  },
    { "id": "sp500",  "name": "S&P 500", "category": "us_index", "value": 7266.99, "change": 28.90, "changePercent": 0.40,  "direction": "up",   "source": "kis2" }
  ]
}
```

- `networkStatus`: `"Normal" | "Constrained" | "Recovered"` — the single source of truth for the indicator light
- `source` (top level): `"main" | "backup" | "none"` — derived from the state (Normal = serving via main, Recovered = serving via backups, Constrained = frozen)
- `responseTimeMs`: latency of the most recent main (primary provider) call; ≈`MAIN_TIMEOUT_MS` (1000) when it timed out
- `timestamp`: when the public snapshot was last swapped — it stops moving while frozen in Constrained, making the freeze visible on screen
- Per-card `source`: `"kis"` (key A) · `"kis2"` (key B) · `"kiwoom"` (domestic backup) · `"fx"` (Frankfurter FX backup) · `"yahoo"` · `"mock"` — the actual origin of that card's value
- `direction`: `"up" | "down" | "flat"` — card color (up = red, down = blue)

---

## 8. Demo Scenario (5 steps of auto-recovery)

| Step | State | What happens | Indicator |
|------|-------|--------------|-----------|
| 1. Steady state | `Normal` | Main (KIS) calls respond within 1s; cards refresh ≈every second | 🟢 green "operating normally" |
| 2. Inject failure | (transition) | Click the **"simulate failure"** button → a 3-second delay is injected into the backend's main (primary provider) call path | — |
| 3. Detection | `Constrained` | A main call **exceeds 1 second** → timeout. Warning text blinks; card updates freeze for 1s (last values kept) | 🟠 orange "main API delay detected" |
| 4. Reroute | `Recovered` | **On the very next poll** the main is skipped and backup providers (other KIS key/Kiwoom/Yahoo/fx) serve the data; updates resume | 🟣 purple "recovered via backup API" |
| 5. Auto-recovery | `Normal` | **5 seconds after** entering Recovered, the backend auto-releases the delay and probes the main; on a healthy response the indicator smoothly returns to green (button auto-syncs to OFF) | 🟢 green |

> **Key point**: detection, rerouting, and recovery all happen on the real external call path. The simulate button merely injects a delay into the main calls — a genuine failure (KIS-wide latency/outage) is detected and rerouted by exactly the same code. Recovery timing is owned by the backend: from the moment Recovered begins, a 5-second timer runs, the delay flag is released, and a probe re-verifies the main; the front end simply trusts the `networkStatus` it receives.

---

## Notes

- For screen layout and color tokens see `dashboard/src/styles/` (`tokens.css`, `app.css`); for the API contract see section 7, the route files (`src/routes/`), and the sample JSON in `data/`.
- All external API keys are optional; if any are missing or failing, mock fallbacks keep the demo running.
- For the root cause of the KIS rate limit (EGW00201) and the two-key design, see "Core design" in section 3.

---
AI assistance: An AI assistant was used to help draft and proofread the project documentation (README, TROUBLESHOOTING) and provided coding assistance during development.
