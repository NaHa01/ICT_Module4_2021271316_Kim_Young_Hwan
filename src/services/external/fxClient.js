// 환율 과거 시세 클라이언트 - Frankfurter(ECB 기준환율, 무키) 일별 시계열.
//
// KIS 는 환율(FX@KRW/FX@EUR)의 과거 시세를 제공하지 않고 현재가만 주므로,
// 환율 차트(1주~3년)는 이 소스에서 실데이터를 받는다. EUR 기준 응답에서
//   USD/KRW = KRW / USD,  EUR/KRW = KRW.
// 한 번의 호출로 장기 시계열을 받아 캐시하고, 구간별로 잘라서 제공한다.

const BASE = 'https://api.frankfurter.dev/v1';
const SERIES_DAYS = 366 * 3 + 40; // 약 3년 + 버퍼
const TTL_MS = 6 * 3600_000; // 일별 기준환율은 자주 바뀌지 않아 6시간 캐시

let cache = { at: 0, rates: null };

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loadRates() {
  if (cache.rates && Date.now() - cache.at < TTL_MS) return cache.rates;
  const end = new Date();
  const start = new Date(end.getTime() - SERIES_DAYS * 86400_000);
  const url = `${BASE}/${ymd(start)}..${ymd(end)}?base=EUR&symbols=USD,KRW`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
  const json = await res.json();
  if (!json.rates) throw new Error('frankfurter 응답에 rates 없음');
  cache = { at: Date.now(), rates: json.rates };
  return cache.rates;
}

// rates({ 'YYYY-MM-DD': { USD, KRW } }) → [{ t: ISO, value }] (과거→현재).
function toPoints(rates, pair) {
  return Object.keys(rates)
    .sort()
    .map((d) => {
      const r = rates[d];
      const value = pair === 'eurkrw' ? r.KRW : r.KRW / r.USD; // usdkrw = KRW/USD
      return { t: new Date(`${d}T00:00:00.000Z`).toISOString(), value };
    })
    .filter((p) => Number.isFinite(p.value));
}

/**
 * 현재가 + 전일종가(ECB 일별 기준환율의 최신/직전 영업일).
 * loadRates() 가 6시간 캐시하므로 매 호출이 외부 요청을 일으키지 않는다(레이트리밋 무관).
 * ECB 기준환율은 영업일 1회(~16:00 CET) 갱신이라 일중에는 값이 고정된다(실시간 틱 아님).
 */
export async function getQuote(pair) {
  const rates = await loadRates();
  const points = toPoints(rates, pair);
  if (!points.length) throw new Error(`frankfurter ${pair} 데이터 없음`);
  const price = points[points.length - 1].value;
  const prevClose = points.length > 1 ? points[points.length - 2].value : price;
  return { price, prevClose };
}

/** 환율 과거 시세 [{ t, value }] (과거→현재). period=D|W, count 개. */
export async function getFxHistory(pair, { period = 'D', count = 252 } = {}) {
  const rates = await loadRates();
  let points = toPoints(rates, pair);
  if (period === 'W') {
    // 주봉: 5영업일마다 1점(+마지막 점 보존)으로 다운샘플.
    points = points.filter((_, i, a) => i % 5 === 0 || i === a.length - 1);
  }
  return points.slice(-count);
}

export function isFxPair(pair) {
  return pair === 'usdkrw' || pair === 'eurkrw';
}
