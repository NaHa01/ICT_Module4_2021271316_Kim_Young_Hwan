// Yahoo Finance chart API(무키) 클라이언트.
//
// 지수·환율의 분봉(인트라데이)과 일/주봉을 받는다. timestamp 는 epoch(초, UTC)
// → ISO 로 변환하면 프론트가 KST 로 정확히 렌더한다. UA 없으면 종종 차단됨.
//
// 용도:
//  - 지수 장기 차트(1주~3년): KIS 해외지수 일봉이 ~1.5년에서 막혀 Yahoo 로 다년치를 받는다.
//  - 지수/환율 1일 분봉: Yahoo 가 직전 세션 전체(1분봉)를 준다(장중엔 다소 지연).
//    지수 1일은 상위(marketData)에서 실시간 누적 꼬리(라이브 히스토리, 외부 호출 0)를 덧붙인다.
//  - 현재가 백업(getQuote): KIS 키 장애 시 지수·환율의 1순위 무키 백업.

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// 내부 통화쌍 id → Yahoo 심볼(환율).
const FX_SYMBOL = { usdkrw: 'KRW=X', eurkrw: 'EURKRW=X' };

export function isFxSupported(pair) {
  return Boolean(FX_SYMBOL[pair]);
}

/** 통화쌍 id → Yahoo 환율 심볼(없으면 null). */
export function fxSymbol(pair) {
  return FX_SYMBOL[pair] || null;
}

/**
 * 현재가 + 전일종가. chart meta(regularMarketPrice/chartPreviousClose)를 사용한다.
 * 해외지수(^GSPC 등)·환율(KRW=X 등) 공용. KIS 장애 시 현재가 백업으로 쓴다.
 */
export async function getQuote(symbol) {
  const url = `${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }, // UA 없으면 종종 차단됨
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);
  const json = await res.json();
  const meta = json.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`yahoo ${symbol} 현재가 없음`);
  let prevClose = Number(meta?.chartPreviousClose ?? meta?.previousClose);
  if (!Number.isFinite(prevClose) || prevClose <= 0) prevClose = price;
  return { price, prevClose };
}

// Yahoo chart API 호출 → [{ t: ISO, value }] (과거→현재).
async function fetchSeries(symbol, { interval = '1m', range = '1d' } = {}) {
  const url = `${BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }, // UA 없으면 종종 차단됨
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result || !Array.isArray(result.timestamp)) throw new Error('yahoo 응답 비정상');

  const close = result.indicators?.quote?.[0]?.close || [];
  const points = result.timestamp
    .map((t, i) => ({ t: new Date(t * 1000).toISOString(), value: close[i] }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0);

  if (points.length === 0) throw new Error('yahoo 데이터 없음');
  return points;
}

/** 임의 Yahoo 심볼 시계열 [{ t, value }]. 지수 분봉/일봉 공용. */
export async function getSeries(symbol, opts = {}) {
  return fetchSeries(symbol, opts);
}

/** 환율 인트라데이 [{ t: ISO, value }] (과거→현재). 기본 1분봉/1일. */
export async function getFxIntraday(pair, opts = {}) {
  const sym = FX_SYMBOL[pair];
  if (!sym) throw new Error(`yahoo: 미지원 통화쌍 ${pair}`);
  return fetchSeries(sym, { interval: '1m', range: '1d', ...opts });
}
