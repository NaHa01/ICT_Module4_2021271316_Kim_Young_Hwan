// 실시간 갱신 루프 검증.  src 에서:  node scripts/test-loop.js
// KIS 키별(A=환율·KOSPI, B=KOSDAQ·KOSPI200·해외) 연속 루프가 ≈1초마다 전체 갱신하는지,
// source 가 키/제공자별로 맞는지 확인. (백엔드와 같은 키로 동시 실행 금지 — 거래제한 합산)

import 'dotenv/config';
import * as marketData from '../services/marketData.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await marketData.start();

  for (let i = 1; i <= 3; i += 1) {
    await sleep(1200);
    const snap = marketData.getSnapshot();
    console.log(`\n===== ${i}초차 스냅샷 (${snap.length}개) =====`);
    for (const c of snap) {
      console.log(
        `${c.id.padEnd(9)} ${String(c.value).padStart(10)}  ${c.direction.padEnd(4)} src=${c.source}`
      );
    }
  }

  const sum = marketData.getSourceSummary();
  console.log('\n===== source summary =====');
  console.log('kis   :', JSON.stringify(sum.kis));
  console.log('kiwoom:', JSON.stringify(sum.kiwoom));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
