// 키움 ka20001 업종코드 스윕 - KOSPI200 코드 식별용.
//   src 에서:  KIWOOM_MIN_GAP_MS=700 node scripts/probe-kiwoom.js
// 모의 도메인은 값이 스크램블되므로 '유효 조합(return_code 0)' 여부로 코드를 좁힌다.

import 'dotenv/config';
import { config } from '../config.js';
import * as kiwoom from '../services/external/kiwoomClient.js';

async function main() {
  console.log('[sweep] base =', config.kiwoomBaseUrl, '| gap =', config.kiwoomMinGapMs);

  const combos = [
    { mrkt_tp: '0', inds_cd: '001' }, // KOSPI 종합(확인됨)
    { mrkt_tp: '1', inds_cd: '101' }, // KOSDAQ 종합(확인됨)
    { mrkt_tp: '0', inds_cd: '002' },
    { mrkt_tp: '0', inds_cd: '201' },
    { mrkt_tp: '0', inds_cd: '180' },
    { mrkt_tp: '0', inds_cd: '200' },
    { mrkt_tp: '2', inds_cd: '001' },
    { mrkt_tp: '2', inds_cd: '201' },
    { mrkt_tp: '2', inds_cd: '101' },
  ];

  for (const c of combos) {
    try {
      const json = await kiwoom.probe('sect', 'ka20001', c);
      console.log(`OK   ${JSON.stringify(c)}  cur_prc=${json.cur_prc}  flu_rt=${json.flu_rt}`);
    } catch (err) {
      console.log(`FAIL ${JSON.stringify(c)}  ${err.message.slice(0, 90)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
