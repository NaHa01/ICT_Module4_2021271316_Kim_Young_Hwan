// 페일오버 상태머신 라이브 검증: 시뮬레이션 토글 후 Normal→Constrained→Recovered→Normal 전이 확인.
//   src 에서:  node scripts/verify-failover.js
// KIS 키가 없어도 동작한다(메인 경로는 정상 취급, 보조 체인이 Yahoo/fx/mock 으로 채움).
// ⚠️ 백엔드와 같은 KIS 키로 동시 실행 금지(거래제한 키 단위 합산).

import 'dotenv/config';
import { networkState } from '../state/networkState.js';
import * as marketData from '../services/marketData.js';
import { getFinancialData } from '../services/failover.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await marketData.start();
  console.log('[verify-failover] 기동. 안정화 3초...');
  await sleep(3000);

  const seen = [];
  let last = null;
  const sample = () => {
    const d = getFinancialData();
    if (d.networkStatus !== last) {
      last = d.networkStatus;
      seen.push(d.networkStatus);
      console.log(
        `${new Date().toISOString().slice(11, 23)}  → ${d.networkStatus} (source=${d.source}, rt=${d.responseTimeMs}ms)`
      );
    }
  };

  sample();
  console.log('[verify-failover] 시뮬레이션 ON (메인 호출에 3초 지연 주입)');
  networkState.setSimulation(true);

  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    sample();
    await sleep(200);
  }

  const expected = ['Normal', 'Constrained', 'Recovered', 'Normal'];
  const ok = JSON.stringify(seen) === JSON.stringify(expected);
  console.log(`\n관측 전이: ${seen.join(' → ')}`);
  console.log(ok ? 'PASS: 감지 → 우회 → 자동 복구 전이 정상' : `FAIL: 기대 ${expected.join(' → ')}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
