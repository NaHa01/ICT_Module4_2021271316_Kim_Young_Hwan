# TROUBLESHOOTING

Major problems we ran into during development, and how we solved them.

---

## Backend

### 1. KIS rate limit (EGW00201) firing far below the published limit

**Problem**

The published limit for the Korea Investment & Securities (KIS) Open API is **18–20 calls/sec** on the production domain, yet `EGW00201` ("transactions per second exceeded") kept firing at call rates far below that. Our real-time design — refreshing 7 indicators about once per second — was well within the published limit but kept getting blocked.

**Root cause analysis ① — temporary limit for new subscribers**

Re-reading the KIS notices, we found that **new API subscribers are limited to 3 calls/sec for the first 3 days** after signing up. Part of the early errors were therefore not a code problem at all, but a temporary account restriction. We re-measured after the 3-day window had passed.

**Root cause analysis ② — errors persisted: forming the "~2 calls/sec per TR" hypothesis**

Even after the temporary limit expired, `EGW00201` still reproduced with total calls **hard-capped at 5/sec** in a single process (logs showed "5 calls in the last second" — a quarter of the published limit of 20). A per-appkey limit could not explain this.

We then looked at our call pattern: all 7 quote calls concentrate on **just two TRs (endpoints)** — overseas indices/FX on `FHKST03030100` (4 calls/sec) and domestic sectors on `FHPUP02100000` (3 calls/sec). This led to the hypothesis that **the limit is enforced per TR at roughly 2 calls/sec, not per appkey in total**. ⚠️ This per-TR limit is not documented anywhere official; it is purely an **estimate based on our measurements**.

**Solution — splitting indicators across two production APP_KEYs**

If the hypothesis is right, spreading same-TR calls across multiple keys should fix it. We prepared two production keys and split the indicators:

- **Key A**: USD/KRW · EUR/KRW · KOSPI (2 overseas-TR + 1 domestic-TR calls)
- **Key B**: KOSDAQ · KOSPI200 · S&P 500 · NASDAQ (2 overseas-TR + 2 domestic-TR calls)

Each key gets an independent client instance (separate token, throttle queue, statistics), and calls are spaced evenly with `minGap = 1000ms ÷ (number of assigned indicators)` so one round takes ≈1 second. As a result, **each key stays at ≤2 calls/sec per TR**.

**Verification**

After the split, every measurement showed **zero EGW00201 errors** (with key A at ≈2.9 calls/sec and key B at ≈3.9 calls/sec sustained). The result is consistent with the hypothesis, but since the gateway internals are a black box, the README also presents it as an "empirically based hypothesis" rather than a fact.

> Extra lesson: the KIS rate limit is **aggregated per key**. Running the backend and a verification script simultaneously with the same key sums their calls and brings EGW back. Measure and operate with one process at a time.

---

### 2. State flapping under partial failure (only one KIS key down)

**Problem**

After rebuilding the failover state machine (Normal → Constrained → Recovered → Normal) to be driven by real external call results, we tested a partial failure with "only key B dead" — and the state **oscillated endlessly between Normal ↔ Constrained ↔ Recovered on a ~6-second cycle** (flapping). The behavior was also non-deterministic, depending on which indicator happened to grab the recovery check.

**Root cause analysis**

The failure was tracked only as a **global flag**. When the recovery probe (5 seconds after entering Recovered) was picked up by an indicator **owned by the healthy key A**, its success was misread as "the main has recovered", returning the state to Normal — and the very next failure from a key-B indicator pushed it back to Constrained.

**Solution — per-provider failure tracking**

We redesigned the state machine to track **which provider is down** via a `failedProviders` set:

- Only indicators owned by a dead key freeze and reroute to the backup chain; indicators on healthy keys keep being served by the main path.
- Recovery probes target **only the dead provider** — a healthy key's success can no longer be mistaken for recovery.
- `Normal` returns only after **every** dead key has recovered, and a dead key is never used as a backup for other indicators (avoids wasted timeouts).

**Verification**

A dedicated script, `src/scripts/verify-partial-failure.js` (which forces key B to use invalid credentials), confirmed the fix: after `Normal → Constrained → Recovered`, the state **stays stable for 20+ seconds**, with dead-key indicators served by backups and healthy-key indicators served by the main path.

---

### 3. Kiwoom's real rate limit is 1 call per second

**Problem**

Calling the Kiwoom REST API (our domestic-index backup) paced at 2 calls/sec still produced repeated rate-limit responses and backoff retries whenever the backup path was active.

**Root cause / solution**

Measurements showed Kiwoom's effective limit is **~1 call/sec**, lower than the documented figure. We lowered the cap (`KIWOOM_MAX_PER_SEC`) to a default of 1 and set the serial queue's uniform spacing to 1000ms, so the app never exceeds one call per second under any circumstances. Since Kiwoom is a backup used only when KIS domestic indices fail, 1 call/sec is sufficient (during a full outage the 3 domestic indices each refresh about every 3 seconds).

---

### 4. Authentication failures right after restarts due to the KIS token issuance limit

**Problem**

Restarting the server or verification scripts in quick succession made KIS authentication fail, dropping every KIS indicator to its fallback.

**Root cause / solution**

KIS OAuth token issuance (`/oauth2/tokenP`) is limited to roughly **once per minute per key**. Tokens are cached only in process memory, so every restart needs a fresh token — and restarting within a minute results in HTTP 403. We added a **60-second cooldown after a failed issuance** in the client (so every call doesn't hammer the token endpoint) and put startup wait times into the verification scripts. As an operational rule, the README states: restart at most once per minute, and never run multiple processes with the same key.

---

## Frontend / UX

### 5. Dark theme didn't hold up → switched entirely to a light theme

**Problem**

The initial design used a dark color scheme, but the readability of financial figures/charts and the overall design quality fell short of expectations.

**Solution**

We switched to a clean, white-based light design across the board. Colors are managed via design tokens in `dashboard/src/styles/tokens.css` for consistency (including the Korean market convention: up = red, down = blue).

### 6. A current value alone doesn't convey the price trend → expandable card charts

**Problem**

Showing only the live value on a card makes it hard for users to grasp the recent price movement leading up to it.

**Solution**

Expanding a card now reveals the **intraday chart** right away (the ▼ icon opens a compact chart under the card; clicking the card opens a detail page with 1-day to 3-year period tabs). Users can see the live value and its trend in one view.

### 7. No context for *why* prices move → economic news sidebar

**Problem**

Showing live prices alone gives users no background on why an index is rising or falling.

**Solution**

We placed an **economic news sidebar** on the right (Naver Search API with the keywords "증시"/stock market and "환율"/exchange rate, refreshed every 60 seconds), so users can skim the likely reasons behind moves while watching the prices.
