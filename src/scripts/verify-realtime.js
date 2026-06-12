// 검증: 제공자별 '평균' 초당 호출수(totalCalls 증분/시간)와 7/7 실데이터 1초 갱신.
//   src 에서:  node scripts/verify-realtime.js

import 'dotenv/config';
import * as marketData from '../services/marketData.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('[verify] KIS 토큰 한도 회복 대기 65초...');
  await sleep(65_000);
  await marketData.start();
  console.log('[verify] 기동. 워밍업 15초...');
  await sleep(15_000);

  const s0 = marketData.getSourceSummary();
  const t0 = Date.now();
  const WINDOW = 10_000;
  await sleep(WINDOW);
  const s1 = marketData.getSourceSummary();
  const secs = (Date.now() - t0) / 1000;

  const rate = (a, b) => ((b - a) / secs).toFixed(2);
  console.log(`\n=== ${secs}s 평균 호출률 ===`);
  console.log(`KIS A: ${rate(s0.kis.totalCalls, s1.kis.totalCalls)}회/초 (gap ${s1.kis.minGapMs}ms, max ${s1.kis.maxPerSec}, EGW +${s1.kis.egw00201Count - s0.kis.egw00201Count})`);
  if (s1.kis2 && s0.kis2) {
    console.log(`KIS B: ${rate(s0.kis2.totalCalls, s1.kis2.totalCalls)}회/초 (gap ${s1.kis2.minGapMs}ms, max ${s1.kis2.maxPerSec}, EGW +${s1.kis2.egw00201Count - s0.kis2.egw00201Count})`);
  } else {
    console.log('KIS B: (없음 = 1키 모드)');
  }
  console.log(`키움 : ${rate(s0.kiwoom.totalCalls, s1.kiwoom.totalCalls)}회/초 (gap ${s1.kiwoom.minGapMs}ms, RL +${s1.kiwoom.rateLimitCount - s0.kiwoom.rateLimitCount})`);

  const snap = marketData.getSnapshot();
  const real = snap.filter((c) => c.source !== 'mock').length;
  console.log(`\n실데이터 ${real}/7`);
  for (const c of snap) console.log(`  ${c.id.padEnd(9)} ${String(c.value).padStart(10)} src=${c.source}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
