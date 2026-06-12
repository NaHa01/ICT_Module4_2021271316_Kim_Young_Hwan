// 중앙 설정값 로딩 - 환경 변수에서 읽고 합리적인 기본값으로 폴백한다.
// server.js 에서 dotenv 가 먼저 로드된 뒤 이 모듈이 사용된다.

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const toBool = (value, fallback) => {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

// 제공자(KIS/키움) 호출 사이 최소 간격(ms). 실시간 설계에선 모든 외부 호출을 이 간격(기본 150ms)으로
// 띄워 한 번에 몰아치지 않게 하고, 제공자별 "초당 호출 상한"(maxPerSec)과 함께 적용한다.
// 차트 on-demand 버스트, 교차환율(eurkrw=FX@EUR×FX@KRW, 2콜)도 같은 큐를 거쳐 간격이 보장된다.
const INDICATOR_GAP_MS = (() => {
  const n = Number.parseInt(process.env.INDICATOR_GAP_MS, 10);
  return Number.isFinite(n) ? n : 150;
})();

// KIS 모의투자/실전투자 도메인.
const KIS_MOCK_URL = 'https://openapivts.koreainvestment.com:29443';
const KIS_REAL_URL = 'https://openapi.koreainvestment.com:9443';

// 키움증권 REST API 모의투자/실전투자 도메인.
const KIWOOM_MOCK_URL = 'https://mockapi.kiwoom.com';
const KIWOOM_REAL_URL = 'https://api.kiwoom.com';

export const config = {
  port: toInt(process.env.PORT, 4000),

  naverClientId: process.env.NAVER_CLIENT_ID || '',
  naverClientSecret: process.env.NAVER_CLIENT_SECRET || '',

  // 한국투자증권(KIS) 오픈 API - 현재가/일봉 실데이터 소스.
  kisAppKey: process.env.KIS_APP_KEY || '',
  kisAppSecret: process.env.KIS_APP_SECRET || '',
  // 모의투자 여부(true=모의투자 도메인, false=실전투자 도메인).
  kisMockTrade: toBool(process.env.KIS_MOCK_TRADE, true),
  get kisBaseUrl() {
    return this.kisMockTrade ? KIS_MOCK_URL : KIS_REAL_URL;
  },
  // KIS 키별 페이싱(minGap=1000÷담당지표수, maxPerSec=담당지표수)은 marketData.start() 가
  // 그룹 크기에 맞춰 동적으로 설정한다(indicatorGapMs 가 하한). 별도 고정 설정값은 두지 않는다.

  // ── 2번째 KIS 실전 키(선택) ──
  // EGW00201 은 실측상 TR(엔드포인트)별 ~2/초에서 막히는 것으로 추정된다(실측 기반 가설).
  // 한 키로 7개를 받으면 같은 TR 에 호출이 몰려 이 추정 한도를 초과한다.
  // 2번째 APP_KEY 를 두면 지표를 키 A/B 로 나눠 각 키의 TR당 부하를 반으로 줄일 수 있다(키별 한도 별개).
  // 비워두면 1키 모드로 동작(모든 KIS 지표를 키 A 가 담당).
  kisAppKey2: process.env.KIS_APP_KEY2 || '',
  kisAppSecret2: process.env.KIS_APP_SECRET2 || '',
  // 2번째 키 도메인(미설정 시 1번째 키와 동일하게 실전/모의 따라감).
  kisMockTrade2: toBool(process.env.KIS_MOCK_TRADE2, toBool(process.env.KIS_MOCK_TRADE, true)),
  get kisBaseUrl2() {
    return this.kisMockTrade2 ? KIS_MOCK_URL : KIS_REAL_URL;
  },

  // 키움증권 REST API - 국내 주가지수(KOSPI/KOSDAQ/KOSPI200) 현재가 백업(KIS 국내지수 장애 시에만 호출).
  kiwoomAppKey: process.env.KIWOOM_APP_KEY || '',
  kiwoomAppSecret: process.env.KIWOOM_APP_SECRET || '',
  // 모의투자 여부(true=mockapi.kiwoom.com, false=api.kiwoom.com).
  kiwoomMockTrade: toBool(process.env.KIWOOM_MOCK_TRADE, true),
  get kiwoomBaseUrl() {
    return this.kiwoomMockTrade ? KIWOOM_MOCK_URL : KIWOOM_REAL_URL;
  },
  // 키움 호출 사이 최소 간격(ms). KIS 와 동일하게 전역 직렬 throttle 로 초당 거래제한 대응.
  kiwoomMinGapMs: toInt(process.env.KIWOOM_MIN_GAP_MS, INDICATOR_GAP_MS),
  // 키움 초당 호출 상한(슬라이딩 1초 윈도우). 키움 거래제한은 실측 ~1콜/초에서 걸려 기본 1.
  // 키움은 백업 전용(KIS 국내지수 장애 시에만 호출)이라 1콜/초로도 충분하다. 0=무제한.
  // marketData.start() 가 이 값으로 균등 페이싱(minGap=1000÷상한)을 함께 설정한다.
  kiwoomMaxPerSec: toInt(process.env.KIWOOM_MAX_PER_SEC, 1),

  // 지표 호출 간 간격(ms). 위 const 참고. 제공자별 minGap 기본값으로도 쓰인다.
  indicatorGapMs: INDICATOR_GAP_MS,

  // 메인(primary 제공자, KIS 키) 실호출 응답 임계값. 백그라운드 루프가 초과하는 순간 타임아웃 처리
  // → Constrained 전이(연속 횟수 완충은 networkState.PRIMARY_FAIL_THRESHOLD, 기본 1=즉시).
  mainTimeoutMs: toInt(process.env.MAIN_TIMEOUT_MS, 1000),

  // 시뮬레이션 ON 시 메인(primary 제공자) 호출 직전에 주입되는 인위적 지연 — 실제 지연 장애와
  // 같은 경로(임계값 타임아웃)로 감지된다.
  injectedDelayMs: toInt(process.env.INJECTED_DELAY_MS, 3000),

  // Recovered 진입 후 지연 flag 자동 해제 + 메인 재확인(probe)까지의 시간.
  autoRecoveryMs: toInt(process.env.AUTO_RECOVERY_MS, 5000),
};

export const hasNaverCredentials = () =>
  Boolean(config.naverClientId && config.naverClientSecret);

export const hasKisCredentials = () =>
  Boolean(config.kisAppKey && config.kisAppSecret);

export const hasKisCredentials2 = () =>
  Boolean(config.kisAppKey2 && config.kisAppSecret2);

export const hasKiwoomCredentials = () =>
  Boolean(config.kiwoomAppKey && config.kiwoomAppSecret);
