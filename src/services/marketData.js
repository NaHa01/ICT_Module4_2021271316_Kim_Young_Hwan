// marketData - 실데이터 오케스트레이터.
//
// 책임:
//  1. 각 카드 지표를 제공자 체인(primary → 다른 KIS 키 → 키움(국내) → Yahoo → Frankfurter(환율) → mock)으로 해결한다.
//     primary 는 KIS 실전 2키 분산: 키 A=usdkrw·eurkrw·kospi(3개), 키 B=kosdaq·kospi200·sp500·nasdaq(4개).
//     키움·Yahoo·Frankfurter 는 백업으로 상호 보조한다(키 B 미설정 시 키 A 가 7개 전부 담당).
//     Frankfurter(ECB)는 일별 고정값이라 준실시간 Yahoo 보다 뒤, mock 직전에 둔다.
//  2. 실시간 갱신: KIS 키별 연속 루프가 담당 지표를 쉼 없이 재조회한다.
//     호출은 키별 throttle 큐가 minGap=1000ms÷담당지표수 + maxPerSec=담당지표수로 페이싱해
//     같은 TR(엔드포인트) 호출을 키당 ≤2콜/초로 유지한다(EGW00201 회피).
//     → 7개 지표가 각각 ≈1초마다 실시세로 갱신되고, 공개 스냅샷은 매 조회마다 교체된다.
//     → 프론트의 1초 폴링은 외부 API 를 때리지 않고, 항상 최신 공개 스냅샷을 받는다.
//  3. 기간별 차트 데이터를 제공한다(지수=Yahoo 우선+실시간 누적 꼬리, 환율=Yahoo 분봉/Frankfurter 일·주봉,
//     실패 시 KIS→mock).
//
// 외부 연동이 모두 실패해도 mock 폴백으로 끊김 없이 동작한다.

import { config } from '../config.js';
import { networkState } from '../state/networkState.js';
import { createKisClient } from './external/kisClient.js';
import * as kiwoom from './external/kiwoomClient.js';
import * as fx from './external/fxClient.js';
import * as yahoo from './external/yahooClient.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 지정 시간 초과 시 reject. 메인(primary) 호출의 1초 임계값(MAIN_TIMEOUT_MS)에 쓴다. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// KIS 키별 독립 인스턴스. EGW00201 은 실측상 TR별 ~2/초에서 막히는 것으로 추정되어(실측 기반 가설),
// 7개를 한 키로 받으면 같은 TR에 몰려 초과한다.
// 2번째 실전 키(config.kisAppKey2)가 있으면 지표를 키 A/B 로 나눠 각 키의 TR당 부하를 반으로 줄인다.
const kisA = createKisClient({
  appKey: config.kisAppKey, appSecret: config.kisAppSecret, baseUrl: config.kisBaseUrl, label: 'kisA',
});
const kisB = config.kisAppKey2 && config.kisAppSecret2
  ? createKisClient({ appKey: config.kisAppKey2, appSecret: config.kisAppSecret2, baseUrl: config.kisBaseUrl2, label: 'kisB' })
  : null;

// 카드로 노출되는 시장 지표 정의. category 는 프론트 섹션 그룹핑 키.
//
// 제공자 라우팅:
//   primary  = 평상시 현재가를 받는 제공자('kis' | 'kis2'). 키 A 3개·키 B 4개 분담.
//   kis      = KIS 조회 descriptor(domestic=업종코드/overseas=심볼/cross=교차환율). 두 키·차트 겸용.
//   kiwoom   = 키움 조회 descriptor({ mrkt_tp, inds_cd }). 국내 주가지수 백업에만 존재.
// 한쪽 제공자가 실패하면 resolveQuote 가 다른 제공자 → mock 순으로 폴백한다(상호 보조).
const INDEX_DEFS = [
  // 키 A/B 분배: EGW00201 이 실측상 TR(엔드포인트)별 ~2/초로 추정되어, 같은 TR(해외=FHKST03030100, 국내=FHPUP02100000)에
  // 몰리지 않게 두 키로 나눈다. 키 A=usdkrw·eurkrw·kospi(해외TR 2·국내TR 1), 키 B=kosdaq·kospi200·sp500·nasdaq
  // (해외TR 2·국내TR 2). usdkrw·eurkrw 는 같은 키(A)에 둬 FX@KRW 마이크로 캐시 중복제거가 유지된다.

  // 환율: 현재가 primary=KIS 키 A. 보조=Yahoo(준실시간)→Frankfurter(ECB 일별, 무키). 차트(과거)는 Frankfurter, 1일 분봉은 Yahoo FX.
  { id: 'usdkrw', name: 'USD/KRW', category: 'fx', decimals: 2, base: 1380.5, vol: 1.2, primary: 'kis', kis: { kind: 'overseas', symbol: 'FX@KRW' }, fx: 'usdkrw' },
  // EUR/KRW = EUR/USD(FX@EUR) × USD/KRW(FX@KRW) 교차. FX@KRW 는 usdkrw 가 같은 키(A)에서 방금 받아 캐시 히트 → 실호출 FX@EUR 1콜.
  { id: 'eurkrw', name: 'EUR/KRW', category: 'fx', decimals: 2, base: 1490.2, vol: 1.4, primary: 'kis', kis: { kind: 'cross', symbols: ['FX@EUR', 'FX@KRW'] }, fx: 'eurkrw' },
  // 국내 지수: 현재가 primary=KIS(국내업종), 보조=키움(ka20001). 차트는 Yahoo 우선. (키움 모의는 핫루프 제외, KIS 장애 시 백업)
  { id: 'kospi', name: 'KOSPI', category: 'kr_index', decimals: 2, base: 2650.12, vol: 6, primary: 'kis', kis: { kind: 'domestic', code: '0001' }, kiwoom: { mrkt_tp: '0', inds_cd: '001' }, yahoo: '^KS11' },
  { id: 'kosdaq', name: 'KOSDAQ', category: 'kr_index', decimals: 2, base: 870.45, vol: 3, primary: 'kis2', kis: { kind: 'domestic', code: '1001' }, kiwoom: { mrkt_tp: '1', inds_cd: '101' }, yahoo: '^KQ11' },
  { id: 'kospi200', name: 'KOSPI200', category: 'kr_index', decimals: 2, base: 355.2, vol: 1, primary: 'kis2', kis: { kind: 'domestic', code: '2001' }, kiwoom: { mrkt_tp: '0', inds_cd: '201' }, yahoo: '^KS200' },
  // 해외 지수: 현재가 primary=KIS 키 B(해외심볼). 차트는 Yahoo 우선.
  { id: 'sp500', name: 'S&P 500', category: 'us_index', decimals: 2, base: 5200.3, vol: 10, primary: 'kis2', kis: { kind: 'overseas', symbol: 'SPX' }, yahoo: '^GSPC' },
  { id: 'nasdaq', name: 'NASDAQ', category: 'us_index', decimals: 2, base: 16400, vol: 40, primary: 'kis2', kis: { kind: 'overseas', symbol: 'COMP' }, yahoo: '^IXIC' },
];

const round = (v, d) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const clampPositive = (v, floor) => Math.max(v, floor);

// ---- 상태(서버 메모리) ----
const mockValues = new Map(INDEX_DEFS.map((d) => [d.id, d.base]));
const quotes = new Map(); // id -> 완성된 카드 객체
const history = new Map(); // id -> [{ t, value }] (시간당 1점, 최근 24h)

let lastRefreshAt = null;
let started = false;

// 공개 스냅샷: 프론트가 보는 카드 배열. staging 누적(quotes)과 분리되어,
// 1초 타이머가 staging 을 한꺼번에 복사해 교체한다.
let publishedSnapshot = [];
let publishedAt = null;

// ---- mock 폴백 ----
function mockQuote(def) {
  const prev = mockValues.get(def.id);
  const drift = (Math.random() + Math.random() - 1) * def.vol;
  let next = prev + drift + (def.base - prev) * 0.02; // 평균 회귀
  next = clampPositive(round(next, def.decimals), def.base * 0.5);
  mockValues.set(def.id, next);
  return { value: next, prevClose: def.base, source: 'mock' };
}

// ---- 제공자 레지스트리 (KIS 2키 / 키움 상호 보조 + Yahoo·Frankfurter 백업) ----
// has(def): 해당 제공자용 descriptor 가 있는지. available(): 키 설정 여부. quote(def): 현재가 조회.
// 키움=국내 전용 백업, KIS=환율·국내·해외, Yahoo(무키)=준실시간 백업, Frankfurter(무키)=최후 백업.
// ⚠️ 선언 순서가 곧 폴백 시도 순서다(providerOrder 가 primary 뒤에 이 순서대로 이어 붙인다):
//    다른 KIS 키 → 키움(국내) → Yahoo → Frankfurter(환율). README §2.2·§3 의 폴백 체인과 일치해야 한다.
const PROVIDERS = {
  // KIS 키 A (기본). 모든 KIS 지표를 받을 수 있고, 키 B 장애 시 보조도 된다.
  kis: {
    has: (def) => Boolean(def.kis),
    available: () => kisA.isAvailable(),
    quote: (def) => kisA.getQuote(def.kis),
  },
  // KIS 키 B (2번째 실전 키, 있을 때만). 키 A 와 같은 descriptor(def.kis)를 쓰며 상호 보조한다.
  kis2: {
    has: (def) => Boolean(def.kis) && Boolean(kisB),
    available: () => Boolean(kisB) && kisB.isAvailable(),
    quote: (def) => kisB.getQuote(def.kis),
  },
  kiwoom: {
    has: (def) => Boolean(def.kiwoom),
    available: () => kiwoom.isAvailable(),
    quote: (def) => kiwoom.getQuote(def.kiwoom),
  },
  // Yahoo(키 불필요) - 지수·환율 준실시간 백업. def.yahoo(지수) 또는 def.fx(환율 심볼 변환)로 조회.
  yahoo: {
    has: (def) => Boolean(def.yahoo || (def.fx && yahoo.fxSymbol(def.fx))),
    available: () => true,
    quote: (def) => yahoo.getQuote(def.yahoo || yahoo.fxSymbol(def.fx)),
  },
  // Frankfurter(ECB, 키 불필요) - 환율 최후 백업(mock 직전). ECB 기준환율은 영업일 1회 갱신이라
  // 일중 고정값(실시간 틱 아님) → 준실시간인 Yahoo FX 보다 뒤에 둔다. 6시간 캐시라 레이트리밋 무관.
  fx: {
    has: (def) => Boolean(def.fx && fx.isFxPair(def.fx)),
    available: () => true,
    quote: (def) => fx.getQuote(def.fx),
  },
};

// def 의 실효 primary. 2번째 키가 없으면 'kis2' 지정 지표를 'kis'(키 A)로 강등한다.
function effectivePrimary(def) {
  let primary = def.primary && PROVIDERS[def.primary] ? def.primary : 'kis';
  if (primary === 'kis2' && !kisB) primary = 'kis'; // 2번째 키 미설정 → 키 A 가 전부 담당
  return primary;
}

// 시도 순서: primary 먼저, 그다음 나머지 제공자(상호 보조). 마지막은 mock.
function providerOrder(def) {
  const primary = effectivePrimary(def);
  return [primary, ...Object.keys(PROVIDERS).filter((p) => p !== primary)];
}

// ---- 메인(primary) 호출 + 1초 임계값 + 시뮬레이션 주입 ----
// "메인 API" = 지표의 primary 제공자(KIS 키) 실호출. 시뮬레이션 ON 이면 호출 직전에
// INJECTED_DELAY_MS 를 주입해 임계값 초과(타임아웃)를 유도한다 — 실제 지연 장애와 같은 경로로 감지된다.
// 지연 후 시뮬레이션이 여전히 ON 이면 실호출 없이 던져서 KIS 호출 예산을 낭비하지 않는다
// (호출부의 withTimeout 은 이미 1초에 reject 했으므로 결과는 동일).
// primary 가 미설정(키 없음)이면 null 을 반환해 "메인 경로 정상"으로 간주한다
// → 키 없이도 시뮬레이션 시연과 상태 전이가 그대로 동작한다(보조 체인이 Yahoo/fx/mock 으로 채움).
async function primaryAttempt(provider, def) {
  if (networkState.simulationEnabled) {
    await delay(config.injectedDelayMs);
    if (networkState.simulationEnabled) throw new Error('시뮬레이션 지연 주입(메인 응답 지연)');
  }
  if (!provider.has(def) || !provider.available()) return null;
  return provider.quote(def);
}

// ---- 제공자 체인 (메인 1초 임계값 → 보조 제공자 → mock) ----
// 상태머신(networkState)이 이 지표의 메인 제공자(primaryId) 기준으로 정한 모드에 따라 경로를 고른다:
//   'primary' 메인부터 시도(1초 임계값). 임계값을 넘는 순간 reportPrimaryFailure → 제공자 장애 판정
//             + Constrained 전이(PRIMARY_FAIL_THRESHOLD=1. 지터 완충이 필요하면 networkState 에서 올린다).
//             부분 장애 시 멀쩡한 키 담당 지표는 어느 상태에서든 이 모드로 메인 서빙을 유지한다.
//   'freeze'  Constrained 진입 직후 1초(폴링 1주기): null 반환 → 카드 미갱신(직전 값 동결, 깜빡임 방지).
//   'backup'  다음 폴링부터: 메인을 건너뛰고 보조 체인으로. 성공은 reportBackupSuccess → Recovered.
//   'probe'   Recovered +5초 후 "죽은 제공자만" 재확인. 모두 회복 시 Normal, 실패 시 보조 체인 유지.
// 보조 체인은 장애 판정된 제공자를 건너뛴다(죽은 키를 다른 지표의 보조로 쓰지 않음 — 타임아웃 낭비 방지).
// 끝내 모든 제공자가 실패하면 개별 mock 으로 폴백한다(상태 보고 없음 → Constrained 유지).
async function resolveQuote(def) {
  const order = providerOrder(def);
  const primaryId = order[0];
  const mode = networkState.resolveMode(primaryId);

  if (mode === 'freeze') return null;

  if (mode === 'primary' || mode === 'probe') {
    const t0 = Date.now();
    try {
      const q = await withTimeout(primaryAttempt(PROVIDERS[primaryId], def), config.mainTimeoutMs);
      networkState.reportPrimarySuccess(primaryId, Date.now() - t0);
      if (q) return { value: round(q.price, def.decimals), prevClose: q.prevClose, source: primaryId };
      // q === null: primary 미설정 → 메인 경로는 정상으로 치고 아래 보조 체인으로 채운다.
    } catch (err) {
      networkState.reportPrimaryFailure(primaryId, Date.now() - t0);
      console.warn(`[marketData] 메인(${primaryId}) 실패(${def.id}) → 보조 체인:`, err.message);
      // 방금 Constrained 동결 단계에 들어갔다면 이번 조회는 동결(보조 호출 없이 반환) — 주황 단계를 보장.
      if (networkState.resolveMode(primaryId) === 'freeze') return null;
    }
  }

  for (const pid of order.slice(1)) {
    const p = PROVIDERS[pid];
    if (networkState.isProviderFailed(pid)) continue; // 죽은 제공자는 보조로도 쓰지 않음
    if (!p.has(def) || !p.available()) continue;
    try {
      const q = await p.quote(def);
      // "우회 성공" 보고는 메인이 장애 판정된 지표만. 메인 미설정(키 없음) 지표의 보조 채움은
      // 정상 동작이므로 Recovered 전이를 일으키면 안 된다(Constrained 동결 단계 보존).
      if (networkState.isProviderFailed(primaryId)) networkState.reportBackupSuccess();
      return { value: round(q.price, def.decimals), prevClose: q.prevClose, source: pid };
    } catch (err) {
      console.warn(`[marketData] ${pid} 현재가 실패(${def.id}) → 다음 제공자/mock:`, err.message);
    }
  }
  return mockQuote(def);
}

function buildCard(def, { value, prevClose, source }) {
  const change = round(value - prevClose, def.decimals);
  const changePercent = prevClose ? round((change / prevClose) * 100, 2) : 0;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return {
    id: def.id,
    name: def.name,
    category: def.category,
    value,
    change,
    changePercent,
    direction,
    source,
  };
}

// ---- 실시간 누적 히스토리 (1분 간격, 최근 24h) ----
// 합성 시드를 쓰지 않고 실데이터(공개 스냅샷)만 1분 단위로 누적한다.
// 지수 1일 차트가 이 실시간 누적을 'Yahoo 분봉 뒤 실시간 꼬리'로 사용한다(KIS 분봉 호출 대체, 외부 호출 0).
const HISTORY_GAP_MS = 60_000; // 최소 1분 간격으로만 새 점 추가
const HISTORY_WINDOW_MS = 24 * 3600_000;

function pushHistory(id, value, decimals) {
  let arr = history.get(id);
  if (!arr) {
    arr = [];
    history.set(id, arr);
  }
  const now = Date.now();
  const last = arr[arr.length - 1];
  if (last && now - new Date(last.t).getTime() < HISTORY_GAP_MS) {
    last.value = round(value, decimals); // 같은 1분 구간이면 최신값으로 갱신
    return;
  }
  arr.push({ t: new Date(now).toISOString(), value: round(value, decimals) });
  const cutoff = now - HISTORY_WINDOW_MS;
  while (arr.length && new Date(arr[0].t).getTime() < cutoff) arr.shift();
}

/** 실시간 누적 히스토리(1분 간격, 최근 24h)의 사본. 지수 1일 차트의 실시간 꼬리로 쓴다. */
function getLiveHistory(id) {
  const arr = history.get(id);
  return arr ? arr.map((p) => ({ ...p })) : [];
}

// ---- 메인 갱신 루프 ----
// 한 지표 카드를 주어진 시세로 갱신.
function setQuoteCard(def, q) {
  const card = buildCard(def, q);
  quotes.set(def.id, card);
  pushHistory(def.id, card.value, def.decimals);
}

// 부팅 시 모든 카드를 mock 으로 즉시 시드(스냅샷이 비어있지 않게).
function seedAllMock() {
  for (const def of INDEX_DEFS) setQuoteCard(def, mockQuote(def));
  lastRefreshAt = new Date().toISOString();
  publishSnapshot(); // 부팅 직후 mock 스냅샷을 즉시 공개(화면이 비지 않게).
}

// staging(quotes) 의 현재 누적분을 공개 스냅샷으로 복사한다.
function publishSnapshot() {
  publishedSnapshot = INDEX_DEFS.map((d) => quotes.get(d.id))
    .filter(Boolean)
    .map((c) => ({ ...c }));
  publishedAt = new Date().toISOString();
}

// 지표 1개를 실시세로 갱신하고 공개 스냅샷을 교체한다.
// resolveQuote 가 제공자 실패를 보조 체인→mock 으로 흡수하므로 한 지표 실패가 루프를 멈추지 않는다.
// null(Constrained 동결)이면 카드를 갱신하지 않아 직전 값과 publishedAt 이 그대로 유지된다.
async function refreshOne(def) {
  const q = await resolveQuote(def);
  if (!q) return;
  setQuoteCard(def, q);
  lastRefreshAt = new Date().toISOString();
  publishSnapshot();
}

/** 공개 스냅샷: 카드 배열. 매 조회마다 교체된 스냅샷을 깊은 복사로 반환. */
export function getSnapshot() {
  return publishedSnapshot.map((c) => ({ ...c }));
}

/** 공개 스냅샷이 마지막으로 교체된 시각(ISO). 동결 중에는 멈춰 있어 화면에서 freeze 가 드러난다. */
export function getPublishedAt() {
  return publishedAt;
}

// ---- 기간별 차트 ----

// range → 분류 + 봉 주기/개수 매핑.
//   1d = 분봉(지수=Yahoo+실시간 누적 꼬리 머지, 환율=Yahoo), 1w~1y = 일봉, 3y = 주봉. 지수는 Yahoo 우선.
const RANGE = {
  '1d': { kind: 'intraday' },
  '1w': { kind: 'long', period: 'D', take: 7 },
  '1m': { kind: 'long', period: 'D', take: 22 },
  '1y': { kind: 'long', period: 'D', take: 252 },
  '3y': { kind: 'long', period: 'W', take: 156 },
};

// mock 차트 포인트(랜덤워크). count 개, stepMs 간격으로 현재까지.
function buildMockPoints(base, count, stepMs, decimals, volFrac = 0.012) {
  const points = [];
  const now = Date.now();
  let v = base * (0.96 + Math.random() * 0.02);
  for (let i = count - 1; i >= 0; i -= 1) {
    const shock = (Math.random() + Math.random() - 1) * (base * volFrac);
    v = v + shock + (base - v) * 0.02;
    points.push({ t: new Date(now - i * stepMs).toISOString(), value: round(v, decimals) });
  }
  points[points.length - 1].value = round(base, decimals);
  return points;
}

const DAY_MS = 24 * 3600e3;

// 장기(1주~3년) 지수 Yahoo range/interval 매핑. 넉넉히 받아 take 개로 잘라 쓴다.
const YAHOO_LONG = {
  '1w': { interval: '1d', range: '1mo' },
  '1m': { interval: '1d', range: '3mo' },
  '1y': { interval: '1d', range: '1y' },
  '3y': { interval: '1wk', range: '5y' },
};

const roundPts = (pts, def) =>
  pts.map((p) => ({ t: p.t, value: round(p.value, def ? def.decimals : 2) }));

function mockChart(id, range, def, count, step) {
  return {
    id,
    range,
    source: 'mock',
    points: buildMockPoints(def ? def.base : 100, count, step, def ? def.decimals : 2),
  };
}

// 1일 분봉 머지: Yahoo 직전 세션 전체 + 실시간 누적 꼬리(라이브 히스토리, 외부 호출 0).
// Yahoo 의 마지막 봉보다 더 최신인 라이브 점만 뒤에 덧붙인다.
//  - 장중: Yahoo 가 ~15분~1시간 지연 → 그 이후 구간을 실시간 루프가 모은 라이브 점이 채운다.
//  - 장 마감: 라이브 꼬리가 Yahoo 마지막보다 최신이 아니므로 자동 제외 → Yahoo 만 남는다.
function mergeIntraday(yahooPts, livePts) {
  if (!yahooPts || !yahooPts.length) return livePts || [];
  if (!livePts || !livePts.length) return yahooPts;
  const lastY = new Date(yahooPts[yahooPts.length - 1].t).getTime();
  const tail = livePts.filter((p) => new Date(p.t).getTime() > lastY);
  return tail.length ? [...yahooPts, ...tail] : yahooPts;
}

async function getMarketChart(id, range) {
  const def = INDEX_DEFS.find((d) => d.id === id);
  const cfg = RANGE[range] || RANGE['1d'];

  if (cfg.kind === 'intraday') {
    // 환율 1일: Yahoo FX 분봉(진짜 인트라데이, ~24h 연속) → 실패 시 ECB 일별 30.
    // (KIS 는 환율 분봉을 주지 않으므로 머지 대상 아님)
    if (def?.fx) {
      try {
        const pts = await yahoo.getFxIntraday(def.fx, { interval: '1m', range: '1d' });
        return { id, range, source: 'yahoo', points: roundPts(pts, def) };
      } catch (err) {
        console.warn(`[marketData] Yahoo FX 분봉 실패(${id}) → ECB 일별:`, err.message);
      }
      try {
        const pts = await fx.getFxHistory(def.fx, { count: 30 });
        if (pts.length) return { id, range, source: 'frankfurter', points: roundPts(pts, def) };
      } catch (err) {
        console.warn(`[marketData] FX 일별 실패(${id}):`, err.message);
      }
      return mockChart(id, range, def, 30, DAY_MS);
    }

    // 지수 1일: Yahoo 분봉(직전 세션 전체) + 실시간 누적 꼬리 머지.
    // 꼬리는 KIS 분봉을 따로 호출하지 않고, 실시간 루프가 이미 모아둔 라이브 히스토리(1분 간격)를 쓴다(외부 호출 0).
    // → Yahoo 가 지연된 최근 구간을 매초 폴링값이 채우고, 차트 마지막 점이 현재 카드 값과 일치한다.
    let yahooPts = null;
    if (def?.yahoo) {
      try {
        yahooPts = await yahoo.getSeries(def.yahoo, { interval: '1m', range: '1d' });
      } catch (err) {
        console.warn(`[marketData] Yahoo 분봉 실패(${id}):`, err.message);
      }
    }
    const livePts = getLiveHistory(id);
    const merged = mergeIntraday(yahooPts, livePts);
    if (merged.length) {
      const usedLiveTail =
        yahooPts && yahooPts.length && livePts.length && merged.length > yahooPts.length;
      const source = !yahooPts || !yahooPts.length ? 'live' : usedLiveTail ? 'yahoo+live' : 'yahoo';
      return { id, range, source, points: roundPts(merged, def) };
    }
    // Yahoo·라이브 모두 비면(부팅 직후 등 드문 경우) KIS 일봉 최근 30 → mock.
    if (def?.kis && kisA.isAvailable()) {
      try {
        const pts = await kisA.getHistory(def.kis, { period: 'D', count: 30 });
        if (pts.length) return { id, range, source: 'kis', points: roundPts(pts.slice(-30), def) };
      } catch {
        /* mock 폴백 */
      }
    }
    return mockChart(id, range, def, 30, DAY_MS);
  }

  // 장기(1주/1개월/1년/3년) 환율: KIS 가 시세 미제공 → ECB(Frankfurter) 일/주봉.
  if (def?.fx) {
    try {
      const pts = await fx.getFxHistory(def.fx, { period: cfg.period, count: cfg.take });
      if (pts.length) return { id, range, source: 'frankfurter', points: roundPts(pts, def) };
    } catch (err) {
      console.warn(`[marketData] FX 차트 실패(${id}):`, err.message);
    }
  } else if (def?.yahoo) {
    // 장기 지수: Yahoo 일/주봉(다년치) 우선. KIS 해외지수 일봉이 ~1.5년에서 막혀 Yahoo 로 받는다.
    const ycfg = YAHOO_LONG[range] || YAHOO_LONG['1y'];
    try {
      const pts = await yahoo.getSeries(def.yahoo, ycfg);
      if (pts.length) return { id, range, source: 'yahoo', points: roundPts(pts.slice(-cfg.take), def) };
    } catch (err) {
      console.warn(`[marketData] Yahoo 장기 실패(${id}) → KIS:`, err.message);
    }
  }

  // 장기 지수 폴백: KIS 일/주봉 → mock.
  if (def?.kis && kisA.isAvailable()) {
    try {
      const pts = await kisA.getHistory(def.kis, { period: cfg.period, count: cfg.take + 5 });
      return { id, range, source: 'kis', points: roundPts(pts.slice(-cfg.take), def) };
    } catch {
      /* mock 으로 폴백 */
    }
  }
  const step = cfg.period === 'W' ? 7 * DAY_MS : DAY_MS;
  return mockChart(id, range, def, cfg.take, step);
}

// 차트 결과 캐시: on-demand 차트 요청이 매번 KIS 를 때리지 않게 해 EGW00201(초당 거래 초과)을 줄인다.
// mock 결과는 캐시하지 않아 다음 호출에서 실데이터를 재시도한다.
const chartCache = new Map(); // `${id}:${range}` -> { at, data }
const CHART_TTL = { '1d': 30_000, '1w': 5 * 60_000, '1m': 10 * 60_000, '1y': 30 * 60_000, '3y': 30 * 60_000 };

/** 기간별 차트. range=1d|1w|1m|1y|3y. */
export async function getChart(id, range = '1d') {
  const r = RANGE[range] ? range : '1d';
  const key = `${id}:${r}`;
  const cached = chartCache.get(key);
  if (cached && Date.now() - cached.at < (CHART_TTL[r] || 60_000)) return cached.data;

  const data = await getMarketChart(id, r);
  if (data.source !== 'mock') chartCache.set(key, { at: Date.now(), data });
  return data;
}

/** 외부 연동 상태 요약(헬스/디버그용). */
export function getSourceSummary() {
  const summary = {};
  for (const c of quotes.values()) summary[c.id] = c.source;
  summary.lastRefreshAt = lastRefreshAt; // staging 최근 누적 시각
  summary.publishedAt = publishedAt; // 공개 스냅샷 최근 교체 시각
  summary.kis = kisA.getStats(); // KIS 키 A 호출 타이밍/초당 거래건수 통계
  if (kisB) summary.kis2 = kisB.getStats(); // KIS 키 B(있을 때)
  summary.kiwoom = kiwoom.getStats(); // 키움 호출 타이밍/초당 거래건수 통계
  return summary;
}

// 제공자별 연속 갱신 루프: 담당 지표를 라운드로빈으로 끊임없이 재조회한다.
// 실제 페이싱은 각 클라이언트의 throttle 큐(150ms 간격 + 초당 상한)가 담당하므로, 여기선 쉼 없이 돌린다.
// 단, 키가 없거나 mock 으로 즉시 떨어질 땐 resolveQuote 가 곧장 반환하므로(throttle 미경유),
// indicatorGapMs 를 하한으로 둬 busy-spin 을 막는다(실호출은 이미 그 이상 걸려 추가 대기 없음).
async function providerLoop(defs) {
  let i = 0;
  while (started) {
    const def = defs[i % defs.length];
    i += 1;
    const t0 = Date.now();
    try {
      await refreshOne(def);
    } catch (err) {
      console.warn(`[marketData] 갱신 실패(${def.id}):`, err.message);
    }
    const rest = config.indicatorGapMs - (Date.now() - t0);
    if (rest > 0) await new Promise((r) => setTimeout(r, rest));
  }
}

/**
 * 백그라운드 실시간 갱신 시작(KIS 키별 연속 루프).
 *  - 부팅 즉시 모든 카드를 mock 으로 시드해 공개 스냅샷을 확보한다(무 API).
 *  - 실효 primary(키 B 없으면 kis2→kis 강등)별로 담당 지표를 묶어 그룹마다 루프를 돌린다.
 *    KIS 키별 throttle 은 minGap=1000ms÷그룹크기, maxPerSec=그룹크기로 설정해 한 라운드 ≈1초
 *    → 같은 TR 호출이 키당 ≤2콜/초가 된다(EGW00201 회피). 각 지표는 ≈1초마다 실시세로 갱신된다.
 *  - 키움은 핫루프에서 빠진 백업 전용. 호출될 때를 대비해 균등 페이싱(실측 거래제한에 맞춰
 *    기본 ≤1콜/초, minGap=1000ms)만 설정한다.
 *  - 한 지표는 primary → 다른 KIS 키 → 키움(국내) → Yahoo → Frankfurter(환율) → mock 으로
 *    폴백(상호 보조)하므로 한쪽 장애에도 끊김 없이 동작한다.
 */
export async function start() {
  if (started) return;
  started = true;

  seedAllMock();

  const evenGap = (perSec) =>
    perSec > 0 ? Math.max(config.indicatorGapMs, Math.ceil(1000 / perSec)) : config.indicatorGapMs;

  // 키움은 핫루프에서 빠져 백업 전용. 호출 시 거래제한 대비 균등 페이싱만 설정.
  kiwoom.setMinGap(evenGap(config.kiwoomMaxPerSec));
  kiwoom.setMaxPerSec(config.kiwoomMaxPerSec);

  // 실효 primary(키 B 없으면 kis2→kis 강등)별로 담당 지표를 묶는다.
  const groups = new Map();
  for (const def of INDEX_DEFS) {
    const pid = effectivePrimary(def);
    if (!groups.has(pid)) groups.set(pid, []);
    groups.get(pid).push(def);
  }

  // KIS 키별 페이싱: 한 키의 같은 TR(해외/국내) 호출이 ~2/초를 넘지 않도록, 그룹 크기에 맞춰
  // "한 라운드 ≈ 1초"가 되게 minGap=1000/그룹크기로 띄운다(maxPerSec=그룹크기로 하드캡).
  // → 각 지표 ≈1초 갱신, 키별 TR당 부하 ≤2/초. 2번째 키가 있으면 7개가 두 키로 갈려 한 키당 부하가 반.
  const kisClients = { kis: kisA, kis2: kisB };
  for (const [pid, defs] of groups) {
    const client = kisClients[pid];
    if (client) {
      client.setMinGap(evenGap(defs.length));
      client.setMaxPerSec(defs.length);
    }
    providerLoop(defs); // 무한 루프이므로 await 하지 않는다.
  }
}

export { INDEX_DEFS };
