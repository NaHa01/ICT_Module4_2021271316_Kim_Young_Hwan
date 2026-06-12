// /api/financial-data 응답 조립.
//
// 페일오버 자체는 여기서 일어나지 않는다 — 감지·우회·복구는 백그라운드 실시간 루프가
// 실제 외부 호출에 1초 임계값을 적용하며 수행하고(marketData.resolveQuote),
// 상태 전이는 networkState 상태머신이 전담한다. 이 모듈은 현재 상태와 공개 스냅샷을
// API 계약(networkStatus / source / responseTimeMs / indices)으로 변환만 한다.
//
//   networkStatus  Normal | Constrained | Recovered — 인디케이터의 단일 진실 공급원
//   source         상태에서 파생: Normal=main(메인 경로 서빙), Recovered=backup(보조 체인 서빙),
//                  Constrained=none(동결 중)
//   responseTimeMs 최근 메인(primary 제공자) 호출 응답시간. 타임아웃 시 ≈MAIN_TIMEOUT_MS
//   timestamp      공개 스냅샷 최종 교체 시각 — Constrained 동결 중에는 멈춰 있다

import { networkState } from '../state/networkState.js';
import { getSnapshot, getPublishedAt } from './marketData.js';

const TOP_SOURCE = { Normal: 'main', Constrained: 'none', Recovered: 'backup' };

export function getFinancialData() {
  return {
    networkStatus: networkState.current,
    source: TOP_SOURCE[networkState.current] || 'none',
    responseTimeMs: networkState.lastPrimaryLatencyMs,
    timestamp: getPublishedAt() || new Date().toISOString(),
    indices: getSnapshot(),
  };
}
