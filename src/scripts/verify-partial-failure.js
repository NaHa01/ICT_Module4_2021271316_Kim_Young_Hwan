// 부분 장애 검증: KIS 키 B 만 죽은 상황(키 A 정상)에서 상태가 안정적으로 유지되는지 확인.
//   src 에서:  node scripts/verify-partial-failure.js
// 키 A 는 비워 "정상" 취급, 키 B 는 잘못된 키로 강제해 실패시킨다(실키 미사용 → 거래제한 무관).
// 기대: Normal → Constrained → Recovered 로 전이 후 안정 유지(플래핑 없음).
//   - 죽은 키(kis2) 담당 지표만 보조 체인(yahoo 등)으로 서빙
//   - 복구 probe 는 죽은 제공자(kis2)만 겨냥 — 멀쩡한 키의 성공이 Normal 오판을 만들면 안 된다

// config/dotenv 가 로드되기 전에 환경을 강제한다(dotenv 는 기존 값을 덮어쓰지 않음).
process.env.KIS_APP_KEY = '';
process.env.KIS_APP_SECRET = '';
process.env.KIS_APP_KEY2 = 'INVALID_KEY_FOR_PARTIAL_FAILURE_TEST';
process.env.KIS_APP_SECRET2 = 'INVALID_SECRET_FOR_PARTIAL_FAILURE_TEST';
process.env.KIWOOM_APP_KEY = '';
process.env.KIWOOM_APP_SECRET = '';
process.env.NAVER_CLIENT_ID = '';
process.env.NAVER_CLIENT_SECRET = '';

await import('dotenv/config');
const marketData = await import('../services/marketData.js');
const { getFinancialData } = await import('../services/failover.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = [];
let last = null;
let lastChangeAt = Date.now();
const sample = () => {
  const d = getFinancialData();
  if (d.networkStatus !== last) {
    last = d.networkStatus;
    seen.push(d.networkStatus);
    lastChangeAt = Date.now();
    console.log(`${new Date().toISOString().slice(11, 23)}  → ${d.networkStatus} (source=${d.source})`);
  }
};

sample(); // 초기 Normal
await marketData.start();
console.log('[verify-partial] 기동: 키 A=없음(정상 취급), 키 B=invalid(장애). 25초 관찰...');

const t0 = Date.now();
while (Date.now() - t0 < 25_000) {
  sample();
  await sleep(150);
}

const cards = getFinancialData().indices.map((c) => `${c.id}=${c.source}`).join(', ');
console.log(`\n카드 소스: ${cards}`);
console.log(`관측 전이: ${seen.join(' → ')}`);

const expected = ['Normal', 'Constrained', 'Recovered'];
const stableMs = Date.now() - lastChangeAt;
const ok = JSON.stringify(seen) === JSON.stringify(expected) && stableMs > 10_000;
console.log(
  ok
    ? `PASS: 부분 장애 시 Recovered 로 안정 유지(마지막 전이 후 ${(stableMs / 1000).toFixed(1)}초 무변동)`
    : `FAIL: 기대 ${expected.join(' → ')} 후 안정. (마지막 전이 후 ${(stableMs / 1000).toFixed(1)}초)`
);
process.exit(ok ? 0 : 1);
