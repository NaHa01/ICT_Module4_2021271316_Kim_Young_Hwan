// 한국투자증권(KIS) 오픈 API 클라이언트 (키별 독립 인스턴스 팩토리).
//
//   - OAuth 토큰: POST /oauth2/tokenP  → access_token (만료 전까지 메모리 캐시)
//   - 국내업종 현재지수:   GET /uapi/domestic-stock/v1/quotations/inquire-index-price        (tr_id FHPUP02100000)
//   - 국내업종 기간별 시세: GET /uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice (tr_id FHKUP03500100)
//   - 해외지수 기간별 시세: GET /uapi/overseas-price/v1/quotations/inquire-daily-chartprice      (tr_id FHKST03030100)
//       → output1(현재가 요약) + output2(일/주봉 배열). 현재가와 일봉을 한 번에 얻는다.
//
// EGW00201(초당 거래건수 초과)은 공식 한도(appkey당 ~20/초) 이하에서도 발생하며, 실측상
// "TR(엔드포인트)별 ~2/초"에서 막히는 것으로 추정된다(공식 문서에 없는 실측 기반 가설 — README §1 참고).
// 그래서 APP_KEY 를 여러 개 두고 지표를 나누면(키별로 같은 TR 호출이 분산) 각 키의 TR당 부하가 내려간다.
// 이를 위해 모든 상태(토큰·throttle 큐·통계·캐시)를 키별 인스턴스(클로저)로 분리한다.
//
// 모든 함수는 실패 시 throw 한다. 상위(marketData)에서 다른 키/제공자/mock 으로 폴백한다.
//
// kisDef 형태:
//   { kind: 'domestic', code: '0001' }      국내업종(업종코드)
//   { kind: 'overseas', symbol: 'SPX' }      해외지수/환율/원자재
//   { kind: 'cross', symbols: ['FX@EUR','FX@KRW'] }  교차환율

// ---- 모듈 공용(무상태) 헬퍼/상수 ----
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EGW_RATE_LIMIT = 'EGW00201';
const MAX_RETRY = 5;
// KIS 지수 일/주봉은 요청당 최대 ~50(국내)/100(해외) 개로 제한 → 과거 윈도우를 옮기며 페이지네이션.
const MAX_PAGES = 15;
// 해외 현재가 마이크로 캐시 TTL(ms). 한 라운드(~1s) 안의 중복(usdkrw + eurkrw 교차의 FX@KRW)만 잡고
// 다음 라운드엔 만료되어 실시간성 유지.
const QUOTE_TTL_MS = 500;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

function yyyymmdd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isoFromYmd(s) {
  const str = String(s);
  const y = Number(str.slice(0, 4));
  const m = Number(str.slice(4, 6)) - 1;
  const d = Number(str.slice(6, 8));
  return new Date(Date.UTC(y, m, d)).toISOString();
}

// count 개 봉을 받기에 충분한 시작일(휴장일 버퍼 포함)을 계산.
function startDateFor(count, period) {
  const perBarDays = period === 'W' ? 7 : period === 'M' ? 30 : 1;
  const calendarDays = Math.ceil(count * perBarDays * 1.6) + 10;
  return new Date(Date.now() - calendarDays * 24 * 3600 * 1000);
}

// count 개를 모으기 위해 과거로 윈도우를 옮겨가며 단일-윈도우 fetch 를 반복(페이지네이션).
// fetchWindow(start, end) 는 과거→현재 정렬된 [{t,value}] 를 반환해야 한다.
async function paginateDaily(fetchWindow, period, count) {
  const perBarDays = period === 'W' ? 7 : period === 'M' ? 30 : 1;
  const spanMs = (Math.ceil(100 * perBarDays * 1.6) + 10) * 24 * 3600 * 1000;
  let end = new Date();
  const seen = new Set();
  const all = [];
  for (let page = 0; page < MAX_PAGES && all.length < count; page += 1) {
    const start = new Date(end.getTime() - spanMs);
    let win;
    try {
      win = await fetchWindow(start, end);
    } catch (err) {
      if (all.length) break; // 일부라도 모았으면 그대로 사용
      throw err;
    }
    if (!win.length) break;
    let added = 0;
    for (const p of win) {
      if (!seen.has(p.t)) {
        seen.add(p.t);
        all.push(p);
        added += 1;
      }
    }
    if (added === 0) break; // 더 과거 데이터가 없음
    end = new Date(new Date(win[0].t).getTime() - 24 * 3600 * 1000); // 가장 오래된 봉 직전으로 이동
  }
  all.sort((a, b) => a.t.localeCompare(b.t));
  return all.slice(-count);
}

// 전일대비 부호(KIS prdy_vrss_sign: 1·2 상승, 3 보합, 4·5 하락)를 적용.
function signedChange(diff, sign) {
  const abs = Math.abs(num(diff));
  if (!Number.isFinite(abs)) return NaN;
  return sign === '4' || sign === '5' ? -abs : abs;
}

// 일봉 배열 파싱 → [{ t: ISO, value }] (과거→현재).
function parseDailyRows(rows, pick) {
  return rows
    .map((r) => ({ date: r.stck_bsop_date || r.xymd, value: num(pick(r)) }))
    .filter((r) => r.date && Number.isFinite(r.value))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((r) => ({ t: isoFromYmd(r.date), value: r.value }));
}

// (ymd, hhmmss) 를 KST(UTC+9) 벽시계 시각으로 해석해 ISO(UTC) 로 변환.
function isoKst(ymd, hms) {
  const ds = String(ymd);
  const ts = String(hms).padStart(6, '0');
  const utcMs = Date.UTC(
    Number(ds.slice(0, 4)), Number(ds.slice(4, 6)) - 1, Number(ds.slice(6, 8)),
    Number(ts.slice(0, 2)), Number(ts.slice(2, 4)), Number(ts.slice(4, 6))
  );
  return new Date(utcMs - 9 * 3600 * 1000).toISOString();
}

/**
 * KIS 클라이언트 인스턴스 생성. 키마다 독립된 토큰·throttle 큐·통계·캐시를 가진다.
 * @param {object} o
 * @param {string} o.appKey   APP_KEY
 * @param {string} o.appSecret APP_SECRET
 * @param {string} o.baseUrl  도메인(실전/모의)
 * @param {string} [o.label]  로그/통계 식별자(예: 'kisA')
 */
export function createKisClient({ appKey, appSecret, baseUrl, label = 'kis' } = {}) {
  // ---- 인스턴스 전역 throttle 상태 ----
  let queueTail = Promise.resolve();
  let lastCallAt = 0;
  let minGapMs = 150; // setMinGap 으로 marketData.start() 가 설정
  let maxPerSec = 0; // 0 = 무제한. setMaxPerSec 로 설정
  const windowStarts = []; // 최근 호출 시작 시각(슬라이딩 1초 윈도우)

  const stats = {
    totalCalls: 0,
    egw00201Count: 0,
    lastEgw00201At: null,
    lastGapMs: null,
    recent: [], // 최근 호출 시각(ms)
  };

  // ---- 토큰 상태 ----
  let token = { value: null, expiresAt: 0 };
  let inflightToken = null;
  let tokenCooldownUntil = 0;
  const TOKEN_COOLDOWN_MS = 60_000;

  let lastRateLogAt = 0; // 거래제한 로그 도배 방지(5초 throttle)

  // 해외 현재가 마이크로 캐시(심볼별) + in-flight 공유(차트+실시간 루프 겹침 방지).
  const overseasQuoteCache = new Map(); // symbol -> { at, value }
  const overseasQuoteInflight = new Map(); // symbol -> Promise

  function isAvailable() {
    return Boolean(appKey && appSecret);
  }
  function setMinGap(ms) {
    if (Number.isFinite(ms) && ms > 0) minGapMs = Math.floor(ms);
  }
  function setMaxPerSec(n) {
    if (Number.isFinite(n) && n >= 0) maxPerSec = Math.floor(n);
  }

  /** 최근 1초간 실제 호출 건수와 throttle 설정값을 반환(헬스/디버그용). */
  function getStats() {
    const now = Date.now();
    const callsLastSec = stats.recent.filter((t) => now - t < 1000).length;
    return {
      label,
      minGapMs,
      maxPerSec,
      callsLastSec,
      lastGapMs: stats.lastGapMs,
      totalCalls: stats.totalCalls,
      egw00201Count: stats.egw00201Count,
      lastEgw00201At: stats.lastEgw00201At,
    };
  }

  // 직렬 throttle: 한 번에 1건 in-flight, minGap 간격 + 슬라이딩 1초 윈도우로 maxPerSec 하드캡.
  function enqueue(task) {
    const run = queueTail.then(async () => {
      const wait = minGapMs - (Date.now() - lastCallAt);
      if (wait > 0) await delay(wait);
      if (maxPerSec > 0) {
        for (;;) {
          const t = Date.now();
          while (windowStarts.length && t - windowStarts[0] >= 1000) windowStarts.shift();
          if (windowStarts.length < maxPerSec) break;
          await delay(1000 - (t - windowStarts[0]) || 1);
        }
      }
      const now = Date.now();
      windowStarts.push(now);
      stats.lastGapMs = lastCallAt ? now - lastCallAt : null;
      lastCallAt = now;
      stats.totalCalls += 1;
      stats.recent.push(now);
      if (stats.recent.length > 50) stats.recent.shift();
      return task();
    });
    queueTail = run.then(() => {}, () => {});
    return run;
  }

  // ---- OAuth 토큰 (메모리 캐시, 만료 전 자동 갱신) ----
  async function fetchToken() {
    const res = await enqueue(() =>
      fetch(`${baseUrl}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
        signal: AbortSignal.timeout(7000),
      })
    );
    if (!res.ok) throw new Error(`KIS 토큰 HTTP ${res.status}`);
    const json = await res.json();
    if (!json.access_token) throw new Error(`KIS 토큰 발급 실패: ${json.error_description || json.msg1 || 'no token'}`);
    const ttlMs = (Number(json.expires_in) || 86400) * 1000;
    token = { value: json.access_token, expiresAt: Date.now() + ttlMs };
    return token.value;
  }

  async function getAccessToken() {
    if (token.value && Date.now() < token.expiresAt - 60_000) return token.value;
    if (Date.now() < tokenCooldownUntil) {
      throw new Error('KIS 토큰 발급 쿨다운 중(과도한 발급 요청 방지)');
    }
    if (!inflightToken) {
      inflightToken = fetchToken()
        .catch((err) => {
          tokenCooldownUntil = Date.now() + TOKEN_COOLDOWN_MS;
          throw err;
        })
        .finally(() => {
          inflightToken = null;
        });
    }
    return inflightToken;
  }

  function isRateLimited(status, body) {
    return status === 500 && String(body).includes(EGW_RATE_LIMIT);
  }

  async function kisGetOnce(path, trId, params) {
    const accessToken = await getAccessToken();
    const qs = new URLSearchParams(params).toString();
    const res = await enqueue(() =>
      fetch(`${baseUrl}${path}?${qs}`, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${accessToken}`,
          appkey: appKey,
          appsecret: appSecret,
          tr_id: trId,
          custtype: 'P',
        },
        signal: AbortSignal.timeout(7000),
      })
    );
    const body = await res.text().catch(() => '');
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    const rateLimited = isRateLimited(res.status, body) || json?.msg_cd === EGW_RATE_LIMIT;
    if (rateLimited) {
      stats.egw00201Count += 1;
      stats.lastEgw00201At = new Date().toISOString();
      const err = new Error(`KIS ${trId} ${EGW_RATE_LIMIT} 초당 거래건수 초과`);
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`KIS HTTP ${res.status} (${trId}) ${body.slice(0, 200)}`.trim());
    }
    if (!json) throw new Error(`KIS ${trId} 응답 파싱 실패`);
    if (json.rt_cd != null && json.rt_cd !== '0') {
      throw new Error(`KIS ${trId} rt_cd=${json.rt_cd} ${json.msg_cd || ''} ${json.msg1 || ''}`.trim());
    }
    return json;
  }

  async function kisGet(path, trId, params) {
    let attempt = 0;
    for (;;) {
      try {
        return await kisGetOnce(path, trId, params);
      } catch (err) {
        if (!err.rateLimited || attempt >= MAX_RETRY) throw err;
        attempt += 1;
        const backoff = minGapMs * (attempt + 1);
        const now = Date.now();
        if (attempt === 1 && now - lastRateLogAt > 5000) {
          lastRateLogAt = now;
          const callsLastSec = stats.recent.filter((t) => now - t < 1000).length;
          console.warn(`[${label}] ${EGW_RATE_LIMIT} 초당 거래 초과 → backoff(누적 ${stats.egw00201Count}회, 직전 1초 호출 ${callsLastSec})`);
        }
        await delay(backoff);
      }
    }
  }

  // ---- 국내업종 ----
  async function getDomesticQuote(code) {
    const json = await kisGet(
      '/uapi/domestic-stock/v1/quotations/inquire-index-price',
      'FHPUP02100000',
      { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code }
    );
    const o = json.output || {};
    const price = num(o.bstp_nmix_prpr);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`KIS 국내 ${code} 가격 없음`);
    const change = signedChange(o.bstp_nmix_prdy_vrss ?? o.prdy_vrss, o.prdy_vrss_sign);
    const prevClose = Number.isFinite(change) ? price - change : price;
    return { price, prevClose };
  }

  async function getDomesticHistory(code, { period = 'D', count = 150 } = {}) {
    const fetchWindow = async (start, end) => {
      const json = await kisGet(
        '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
        'FHKUP03500100',
        {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_INPUT_ISCD: code,
          FID_INPUT_DATE_1: yyyymmdd(start),
          FID_INPUT_DATE_2: yyyymmdd(end),
          FID_PERIOD_DIV_CODE: period,
        }
      );
      return parseDailyRows(json.output2 || [], (r) => r.bstp_nmix_prpr);
    };
    const points = await paginateDaily(fetchWindow, period, count);
    if (points.length === 0) throw new Error(`KIS 국내 ${code} 일봉 없음`);
    return points;
  }

  // ---- 해외지수/환율/원자재 ----
  async function getOverseasDailyResponse(symbol, { period = 'D', start, end } = {}) {
    const e = end || new Date();
    const s = start || startDateFor(2, period);
    return kisGet(
      '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
      'FHKST03030100',
      {
        FID_COND_MRKT_DIV_CODE: 'N',
        FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: yyyymmdd(s),
        FID_INPUT_DATE_2: yyyymmdd(e),
        FID_PERIOD_DIV_CODE: period,
      }
    );
  }

  async function getOverseasQuoteRaw(symbol) {
    const json = await getOverseasDailyResponse(symbol, { count: 2 });
    const o = json.output1 || {};
    const price = num(o.ovrs_nmix_prpr ?? o.ovrs_prpr);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`KIS 해외 ${symbol} 가격 없음`);
    let prevClose = num(o.ovrs_nmix_prdy_clpr ?? o.prdy_clpr);
    if (!Number.isFinite(prevClose)) {
      const change = signedChange(o.ovrs_nmix_prdy_vrss ?? o.prdy_vrss, o.prdy_vrss_sign);
      prevClose = Number.isFinite(change) ? price - change : price;
    }
    return { price, prevClose };
  }

  async function getOverseasQuote(symbol) {
    const cached = overseasQuoteCache.get(symbol);
    if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.value;
    const pending = overseasQuoteInflight.get(symbol);
    if (pending) return pending;
    const p = getOverseasQuoteRaw(symbol)
      .then((value) => {
        overseasQuoteCache.set(symbol, { at: Date.now(), value });
        return value;
      })
      .finally(() => overseasQuoteInflight.delete(symbol));
    overseasQuoteInflight.set(symbol, p);
    return p;
  }

  async function getOverseasHistory(symbol, { period = 'D', count = 150 } = {}) {
    const fetchWindow = async (start, end) => {
      const json = await getOverseasDailyResponse(symbol, { period, start, end });
      return parseDailyRows(json.output2 || [], (r) => r.ovrs_nmix_prpr ?? r.clos ?? r.ovrs_prpr);
    };
    const points = await paginateDaily(fetchWindow, period, count);
    if (points.length === 0) throw new Error(`KIS 해외 ${symbol} 일봉 없음`);
    return points;
  }

  // ---- 교차환율 (EUR/KRW = FX@EUR × FX@KRW) ----
  async function getCrossQuote(symbols) {
    const parts = await Promise.all(symbols.map((s) => getOverseasQuote(s)));
    return {
      price: parts.reduce((acc, p) => acc * p.price, 1),
      prevClose: parts.reduce((acc, p) => acc * p.prevClose, 1),
    };
  }

  async function getCrossHistory(symbols, opts) {
    const [a, b] = await Promise.all(symbols.map((s) => getOverseasHistory(s, opts)));
    const mapB = new Map(b.map((p) => [p.t, p.value]));
    const points = a
      .filter((p) => mapB.has(p.t))
      .map((p) => ({ t: p.t, value: p.value * mapB.get(p.t) }));
    if (points.length === 0) throw new Error(`KIS 교차환율(${symbols.join('×')}) 일봉 없음`);
    return points;
  }

  // ---- 분봉(intraday) ----
  async function getDomesticMinutes(code, sessionYmd) {
    const json = await kisGet(
      '/uapi/domestic-stock/v1/quotations/inquire-time-indexchartprice',
      'FHPUP02110200',
      { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code, FID_INPUT_HOUR_1: '', FID_PW_DATA_INCU_YN: 'Y', FID_ETC_CLS_CODE: '' }
    );
    const points = (json.output || [])
      .map((r) => ({ hour: String(r.bsop_hour), value: num(r.bstp_nmix_prpr) }))
      .filter((r) => /^\d{6}$/.test(r.hour) && Number(r.hour) <= 235959 && Number.isFinite(r.value) && r.value > 0)
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .map((r) => ({ t: isoKst(sessionYmd, r.hour), value: r.value }));
    if (points.length === 0) throw new Error(`KIS 국내 ${code} 분봉 없음`);
    return points;
  }

  async function getOverseasMinutes(symbol) {
    const json = await kisGet(
      '/uapi/overseas-price/v1/quotations/inquire-time-indexchartprice',
      'FHKST03030200',
      { FID_COND_MRKT_DIV_CODE: 'N', FID_INPUT_ISCD: symbol, FID_HOUR_CLS_CODE: '0', FID_PW_DATA_INCU_YN: 'Y' }
    );
    const points = (json.output2 || [])
      .map((r) => ({ date: String(r.stck_bsop_date || ''), hour: String(r.stck_cntg_hour || ''), value: num(r.optn_prpr) }))
      .filter((r) => /^\d{8}$/.test(r.date) && /^\d{6}$/.test(r.hour) && Number.isFinite(r.value) && r.value > 0)
      .sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour))
      .map((r) => ({ t: isoKst(r.date, r.hour), value: r.value }));
    if (points.length === 0) throw new Error(`KIS 해외 ${symbol} 분봉 없음`);
    return points;
  }

  // ---- 공개 API (kisDef 로 국내/해외/교차 분기) ----
  return {
    label,
    isAvailable,
    setMinGap,
    setMaxPerSec,
    getStats,

    /** 현재가 + 전일종가. */
    async getQuote(kisDef) {
      if (kisDef.kind === 'domestic') return getDomesticQuote(kisDef.code);
      if (kisDef.kind === 'cross') return getCrossQuote(kisDef.symbols);
      return getOverseasQuote(kisDef.symbol);
    },

    /** 기간별 시세 [{ t: ISO, value }] (과거→현재). period=D|W|M. */
    async getHistory(kisDef, opts = {}) {
      if (kisDef.kind === 'domestic') return getDomesticHistory(kisDef.code, opts);
      if (kisDef.kind === 'cross') return getCrossHistory(kisDef.symbols, opts);
      return getOverseasHistory(kisDef.symbol, opts);
    },

    /** 분봉(intraday) [{ t: ISO, value }]. cross/FX 미지원 시 throw. */
    async getIntraday(kisDef, sessionYmd) {
      if (kisDef.kind === 'domestic') return getDomesticMinutes(kisDef.code, sessionYmd);
      if (kisDef.kind === 'overseas') return getOverseasMinutes(kisDef.symbol);
      throw new Error('intraday 미지원(cross)');
    },
  };
}
