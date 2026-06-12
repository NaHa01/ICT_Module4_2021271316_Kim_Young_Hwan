// 키움증권 REST API 클라이언트 (api.kiwoom.com / mockapi.kiwoom.com).
//
//   - OAuth 토큰: POST /oauth2/token  → token (만료 전까지 메모리 캐시)
//   - 업종(국내지수) 현재가: POST /api/dostk/sect  (api-id 헤더로 TR 지정)
//       · ka20001 업종현재가요청 (inds_cd 업종코드)
//
// 역할: 국내 주가지수(KOSPI/KOSDAQ/KOSPI200) 현재가의 백업(failover) — KIS 국내지수 장애 시에만 호출된다.
// 모든 함수는 실패 시 throw 한다. 상위(marketData)에서 다른 제공자 또는 mock 으로 폴백한다.
//
// kiwoomDef 형태:
//   { mrkt_tp: '0', inds_cd: '001' }   시장구분 + 업종코드
//     · KOSPI 종합   = mrkt_tp '0', inds_cd '001'
//     · KOSDAQ 종합  = mrkt_tp '1', inds_cd '101'
//     · KOSPI200     = mrkt_tp '0', inds_cd '201'
//   (2026-06-11 모의 도메인 라이브 검증. mrkt_tp 는 필수 파라미터지만 조회는 inds_cd 가 결정.)

import { config } from '../../config.js';

/** 키가 설정되어 있어 실데이터 조회가 가능한지. */
export function isAvailable() {
  return Boolean(config.kiwoomAppKey && config.kiwoomAppSecret);
}

// ---- 전역 호출 throttle (초당 거래제한 대응) ----
// 모든 키움 HTTP 요청(토큰/시세)을 하나의 큐로 직렬화하고 최소 간격(kiwoomMinGapMs)을 보장한다.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let queueTail = Promise.resolve();
let lastCallAt = 0;

// 호출 사이 최소 간격(ms)과 초당 호출 상한(슬라이딩 1초 윈도우). 둘 다 marketData.start() 가 설정한다.
// minGap 은 호출이 몰리지 않게 띄우는 하한, maxPerSec 는 1초 안의 호출 건수를 하드 캡한다.
let minGapMs = config.kiwoomMinGapMs;
let maxPerSec = config.kiwoomMaxPerSec; // 0 = 무제한
export function setMinGap(ms) {
  if (Number.isFinite(ms) && ms > 0) minGapMs = Math.floor(ms);
}
export function setMaxPerSec(n) {
  if (Number.isFinite(n) && n >= 0) maxPerSec = Math.floor(n);
}
// 최근 호출 시작 시각(ms). 슬라이딩 1초 윈도우로 maxPerSec 를 강제하는 데 쓴다.
const windowStarts = [];

const stats = {
  totalCalls: 0,
  rateLimitCount: 0, // 초당 거래제한 응답 누적
  lastRateLimitAt: null,
  lastGapMs: null,
  recent: [], // 최근 호출 시각(ms)
};

/** 최근 1초간 실제 호출 건수와 throttle 설정값(헬스/디버그용). */
export function getStats() {
  const now = Date.now();
  const callsLastSec = stats.recent.filter((t) => now - t < 1000).length;
  return {
    minGapMs, // 현재 적용 중인 호출 간 최소 간격
    maxPerSec, // 현재 적용 중인 초당 호출 상한(0=무제한)
    callsLastSec,
    lastGapMs: stats.lastGapMs,
    totalCalls: stats.totalCalls,
    rateLimitCount: stats.rateLimitCount,
    lastRateLimitAt: stats.lastRateLimitAt,
  };
}

function enqueue(task) {
  // 직렬 throttle: 직전 호출 완료 후 minGap 만큼 띄우고 다음을 처리(한 번에 1건 in-flight).
  // 키움 거래제한은 실측 ~1콜/초에서 걸린다(2026-06 실측) — 직렬 방식이 재시도 낭비 없이 상한에 맞춰진다.
  const run = queueTail.then(async () => {
    // 1) 최소 간격: 직전 호출에서 minGap 만큼 떨어지도록 대기.
    const wait = minGapMs - (Date.now() - lastCallAt);
    if (wait > 0) await delay(wait);
    // 2) 초당 호출 상한: 최근 1초 윈도우에 maxPerSec 건이 차 있으면 가장 오래된 호출이 빠질 때까지 대기.
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
// 발급 실패 시 쿨다운을 두어 매 틱마다 토큰 엔드포인트를 두드리지 않게 한다.
let token = { value: null, expiresAt: 0 };
let inflightToken = null;
let tokenCooldownUntil = 0;
const TOKEN_COOLDOWN_MS = 60_000;

// 키움 만료시각(expires_dt, 'YYYYMMDDHHmmss' KST 문자열)을 ms epoch 로.
function parseExpiresDt(s) {
  const str = String(s || '');
  if (!/^\d{14}$/.test(str)) return Date.now() + 12 * 3600_000; // 형식 불명 → 12h 가정
  const utcMs = Date.UTC(
    Number(str.slice(0, 4)), Number(str.slice(4, 6)) - 1, Number(str.slice(6, 8)),
    Number(str.slice(8, 10)), Number(str.slice(10, 12)), Number(str.slice(12, 14))
  );
  return utcMs - 9 * 3600_000; // KST 벽시계 → UTC epoch
}

async function fetchToken() {
  const res = await enqueue(() =>
    fetch(`${config.kiwoomBaseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: config.kiwoomAppKey,
        secretkey: config.kiwoomAppSecret,
      }),
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
  if (!res.ok) throw new Error(`키움 토큰 HTTP ${res.status} ${body.slice(0, 200)}`.trim());
  // 키움은 성공 시 token + expires_dt 를 준다. return_code 0 이 정상.
  const value = json?.token || json?.access_token;
  if (!value) {
    throw new Error(`키움 토큰 발급 실패: ${json?.return_msg || json?.msg1 || body.slice(0, 120)}`);
  }
  token = { value, expiresAt: parseExpiresDt(json.expires_dt) };
  return token.value;
}

async function getAccessToken() {
  if (token.value && Date.now() < token.expiresAt - 60_000) return token.value;
  if (Date.now() < tokenCooldownUntil) {
    throw new Error('키움 토큰 발급 쿨다운 중(과도한 발급 요청 방지)');
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

// ---- 공통 POST (api-id 로 TR 지정) ----
// 키움 국내 도메인 API 는 POST /api/dostk/{group} 에 헤더 api-id 로 TR 을 지정한다.
// 초당 거래제한(키움 코드 다양) 발생 시 backoff 재시도로 흡수한다.
const RATE_LIMIT_CODES = ['429', 'EGW00201']; // 키움/공통 초과 코드 후보
const MAX_RETRY = 5;
let lastRateLogAt = 0; // 거래제한 로그 도배 방지(5초 throttle)

function isRateLimited(status, json) {
  if (status === 429) return true;
  const code = String(json?.return_code ?? json?.rt_cd ?? '');
  const msg = String(json?.return_msg ?? json?.msg1 ?? '');
  return RATE_LIMIT_CODES.some((c) => code.includes(c) || msg.includes(c));
}

async function kiwoomPostOnce(group, apiId, payload) {
  const accessToken = await getAccessToken();
  const res = await enqueue(() =>
    fetch(`${config.kiwoomBaseUrl}/api/dostk/${group}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        authorization: `Bearer ${accessToken}`,
        'api-id': apiId,
        'cont-yn': 'N',
        'next-key': '',
      },
      body: JSON.stringify(payload),
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
  if (isRateLimited(res.status, json)) {
    stats.rateLimitCount += 1;
    stats.lastRateLimitAt = new Date().toISOString();
    const err = new Error(`키움 ${apiId} 초당 거래제한`);
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) throw new Error(`키움 HTTP ${res.status} (${apiId}) ${body.slice(0, 200)}`.trim());
  if (!json) throw new Error(`키움 ${apiId} 응답 파싱 실패`);
  // 키움은 정상 시 return_code 0. 0 이 아니면 에러.
  const rc = json.return_code;
  if (rc != null && Number(rc) !== 0) {
    throw new Error(`키움 ${apiId} return_code=${rc} ${json.return_msg || ''}`.trim());
  }
  return json;
}

async function kiwoomPost(group, apiId, payload) {
  let attempt = 0;
  for (;;) {
    try {
      return await kiwoomPostOnce(group, apiId, payload);
    } catch (err) {
      if (!err.rateLimited || attempt >= MAX_RETRY) throw err;
      attempt += 1;
      const backoff = minGapMs * (attempt + 1);
      // 거래제한 재시도는 backoff 가 흡수하는 정상 동작이라 로그를 5초에 한 번으로 제한(도배 방지).
      const now = Date.now();
      if (attempt === 1 && now - lastRateLogAt > 5000) {
        lastRateLogAt = now;
        console.warn(`[kiwoom] 초당 거래제한 → backoff 재시도(최근 5초 누적 ${stats.rateLimitCount}회)`);
      }
      await delay(backoff);
    }
  }
}

// 키움 숫자 문자열 파서: 콤마/부호/선행 0 을 제거하고 Number 로. (예: '+0002,650.12' → 2650.12)
function knum(v) {
  if (v == null) return NaN;
  const s = String(v).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n) : NaN; // 현재가는 부호 없음. 부호는 sign 필드로 별도 처리.
}

// 전일대비 부호: 키움 기호(1·2 상승, 3 보합, 4·5 하락) 또는 +/- 문자열.
function signedDiff(raw, sign) {
  const abs = Math.abs(Number(String(raw).replace(/,/g, '')));
  if (!Number.isFinite(abs)) return NaN;
  const sg = String(sign ?? raw);
  if (sg === '4' || sg === '5' || sg.includes('-')) return -abs;
  return abs;
}

// ---- 업종(국내지수) 현재가 ----
// ka20001 업종현재가요청. 응답 최상위에 cur_prc(현재가, 부호접두), pred_pre(전일대비),
// pred_pre_sig(부호 1·2 상승/3 보합/4·5 하락), flu_rt(등락률), inds_cur_prc_tm(분봉 배열).
async function getSectorQuote({ mrkt_tp = '0', inds_cd }) {
  const json = await kiwoomPost('sect', 'ka20001', { mrkt_tp: String(mrkt_tp), inds_cd: String(inds_cd) });
  const price = knum(json.cur_prc); // 부호 접두는 knum 이 절대값으로 흡수
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`키움 업종 ${inds_cd} 가격 없음: ${JSON.stringify(json).slice(0, 160)}`);
  }
  const diff = signedDiff(json.pred_pre, json.pred_pre_sig);
  const prevClose = Number.isFinite(diff) ? price - diff : price;
  return { price, prevClose };
}

// ---- 공개 API ----

/** 현재가 + 전일종가. kiwoomDef = { mrkt_tp, inds_cd }. */
export async function getQuote(kiwoomDef) {
  return getSectorQuote(kiwoomDef);
}

/** 라이브 검증용: 임의 TR 의 원본 응답을 반환한다(probe-kiwoom.js 전용). */
export async function probe(group, apiId, payload) {
  return kiwoomPost(group, apiId, payload);
}
