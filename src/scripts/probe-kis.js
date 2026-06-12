// KIS 도메인(.env 의 KIS_MOCK_TRADE 에 따라 실전/모의)의 해외지수·환율 지원 여부 단독 확인. (토큰 1회만 발급)
//   src 에서:  node scripts/probe-kis.js
// 시작 시 70초 대기해 직전 토큰 발급 403/쿨다운이 풀리게 한 뒤, 각 descriptor 를 1회씩 조회.

import 'dotenv/config';
import { config } from '../config.js';
import { createKisClient } from '../services/external/kisClient.js';

// 키 A 로 단독 인스턴스 생성(백엔드와 동시에 돌리면 거래제한이 키 단위로 합산되니 주의).
const kis = createKisClient({
  appKey: config.kisAppKey,
  appSecret: config.kisAppSecret,
  baseUrl: config.kisBaseUrl,
  label: 'probe',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('[probe-kis] base =', config.kisBaseUrl, '| mock =', config.kisMockTrade);
  console.log('[probe-kis] 토큰 한도 회복 대기 70초...');
  await sleep(70_000);

  const targets = [
    ['usdkrw  FX@KRW', { kind: 'overseas', symbol: 'FX@KRW' }],
    ['eurkrw  cross ', { kind: 'cross', symbols: ['FX@EUR', 'FX@KRW'] }],
    ['sp500   SPX   ', { kind: 'overseas', symbol: 'SPX' }],
    ['nasdaq  COMP  ', { kind: 'overseas', symbol: 'COMP' }],
  ];

  for (const [label, def] of targets) {
    try {
      const q = await kis.getQuote(def);
      console.log(`OK   ${label}  price=${q.price}  prevClose=${q.prevClose}`);
    } catch (err) {
      console.log(`FAIL ${label}  ${err.message.slice(0, 120)}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
