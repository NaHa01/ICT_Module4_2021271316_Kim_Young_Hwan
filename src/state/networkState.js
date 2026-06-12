// 네트워크 상태 머신 (서버 메모리 단일 인스턴스).
//
// 상태: Normal | Constrained | Recovered
// 전이는 백그라운드 실시간 루프(marketData)가 보고하는 "실제 외부 호출 결과"가 구동한다.
// 메인(primary 제공자, KIS 키) 호출에 1초 임계값(MAIN_TIMEOUT_MS)이 걸리고:
//   Normal     → Constrained : 메인 호출이 임계값을 초과(타임아웃)/에러한 순간
//                              (PRIMARY_FAIL_THRESHOLD 로 "연속 N회" 완충 가능 — 기본 1=즉시)
//   Constrained→ Recovered   : 보조 제공자(다른 KIS 키/키움/Yahoo/Frankfurter) 호출 성공 시
//   Recovered  → Normal      : 진입 +5초(AUTO_RECOVERY_MS) 후 메인 재확인(probe) 성공 시
//
// 장애는 "제공자(primary id) 단위"로 추적한다(failedProviders). 한쪽 KIS 키만 죽은 부분 장애에서
//   - 죽은 키 담당 지표만 동결/보조 체인을 타고, 멀쩡한 키 담당 지표는 계속 메인으로 서빙된다.
//   - 복구 probe 는 죽은 제공자를 담당하는 지표만 수행 — 멀쩡한 키의 성공이 Normal 복귀로
//     오판되어 상태가 Normal↔Constrained 로 플래핑하는 것을 막는다.
//   - 모든 죽은 제공자가 회복되어야 Normal 로 복귀한다.
//
// 모드 결정(resolveMode(primaryId))도 이 머신이 담당한다:
//   Normal                       → 'primary'  메인부터 시도
//   primary 가 failed 가 아니면   → 'primary'  (부분 장애: 멀쩡한 키는 어느 상태에서든 메인 유지)
//   Constrained + failed primary → 'freeze'   진입 직후 CONSTRAINED_HOLD_MS 동안 직전 값 동결
//                                → 'backup'   동결 시간이 지나면 메인을 건너뛰고 보조 체인으로
//                                → 'probe'    보조까지 전멸해 Constrained 에 머물면 +5초 후 재확인(mock 고착 방지)
//   Recovered  + failed primary  → 'backup'   메인을 건너뛰어 임계값 타임아웃 낭비를 막는다
//                                → 'probe'    +5초 경과·지연 해제 후 해당 제공자 재확인
//
// 타이밍 책임: "Recovered 진입 +5초 후 지연 자동 해제"는 백엔드가 책임진다.
// 최초 Recovered 진입 시 자동복구 타이머를 등록하고, 만료되면 simulationEnabled=false.

import { config } from '../config.js';

const STATES = Object.freeze({
  NORMAL: 'Normal',
  CONSTRAINED: 'Constrained',
  RECOVERED: 'Recovered',
});

// 연속 몇 회 메인 호출이 임계값을 초과해야 Constrained 로 전이하는지.
// 1 = "1초를 넘는 순간" 즉시 전이(발표 시나리오 기준). 실운영에서 일시적 지터로
// 인디케이터가 너무 자주 깜빡이면 2로 올려 오탐을 완충할 수 있다.
const PRIMARY_FAIL_THRESHOLD = 1;
// Constrained 진입 후 동결 유지 시간 = 프론트 폴링 1주기(1초).
// 주황(동결) 상태가 한 폴링에 관찰되고, "바로 다음 폴링"에는 보조 우회(Recovered)로 넘어간다.
const CONSTRAINED_HOLD_MS = 1000;

class NetworkState {
  constructor() {
    this.current = STATES.NORMAL;
    this.simulationEnabled = false;
    this.recoveredAt = null;
    this.constrainedAt = null;
    this.failedProviders = new Set(); // 장애로 판정된 메인 제공자 id ('kis' | 'kis2')
    this.lastPrimaryLatencyMs = null; // 최근 메인 호출 응답시간(타임아웃 시 ≈임계값)
    this._failStreak = new Map(); // 제공자별 연속 메인 호출 실패 횟수
    this._lastProbeAt = new Map(); // 제공자별 마지막 재확인(probe) 시각
    this._autoRecoveryTimer = null;
  }

  /** 시뮬레이션 토글. ON 시 메인(primary 제공자) 호출 경로에 지연이 주입된다. */
  setSimulation(enabled) {
    this.simulationEnabled = Boolean(enabled);
    if (!this.simulationEnabled) {
      this._clearAutoRecoveryTimer();
    }
    return this.simulationEnabled;
  }

  /**
   * 이번 지표 조회에서 취할 경로. marketData.resolveQuote 가 매 조회 직전에 묻는다.
   * @param {string} primaryId 이 지표의 메인 제공자 id ('kis' | 'kis2')
   * @returns {'primary'|'freeze'|'backup'|'probe'}
   */
  resolveMode(primaryId) {
    // 부분 장애: 이 지표의 메인 제공자가 멀쩡하면 상태와 무관하게 메인으로 서빙한다.
    if (!this.failedProviders.has(primaryId)) return 'primary';

    if (this.current === STATES.CONSTRAINED) {
      const held = this.constrainedAt && Date.now() - this.constrainedAt < CONSTRAINED_HOLD_MS;
      if (held) return 'freeze';
      // 보조까지 전멸해 Constrained 에 머무는 경우(mock 서빙)에도 메인 회복을 재확인할 수
      // 있어야 한다. Recovered 와 같은 5초 간격 probe 를 허용해 "mock 고착"을 막는다.
      // (시연의 Constrained 는 ~1초 만에 Recovered 로 넘어가므로 이 경로에 도달하지 않는다.)
      if (this._probeDue(primaryId, this.constrainedAt)) return 'probe';
      return 'backup';
    }
    if (this.current === STATES.RECOVERED) {
      if (this._probeDue(primaryId, this.recoveredAt)) return 'probe';
      return 'backup';
    }
    return 'primary';
  }

  // 해당 제공자의 메인 재확인(probe) 시점인지. 진입 시각(sinceAt) +5초 경과, 지연 미주입,
  // 제공자별 5초 간격을 모두 만족해야 한다. due 면 시작 시각을 먼저 기록해 중복 probe 를 막는다.
  _probeDue(primaryId, sinceAt) {
    const now = Date.now();
    const due =
      !this.simulationEnabled && // 지연이 아직 주입 중이면 재확인해도 실패가 확정 → 건너뜀
      sinceAt && now - sinceAt >= config.autoRecoveryMs &&
      now - (this._lastProbeAt.get(primaryId) || 0) >= config.autoRecoveryMs;
    if (due) this._lastProbeAt.set(primaryId, now);
    return due;
  }

  /** 해당 제공자가 장애 판정 상태인지(보조 체인에서 죽은 제공자를 건너뛰는 데 쓴다). */
  isProviderFailed(providerId) {
    return this.failedProviders.has(providerId);
  }

  /** 메인(primary 제공자) 호출이 임계값 내 성공. 죽었던 제공자가 모두 회복되면 Normal 복귀. */
  reportPrimarySuccess(primaryId, latencyMs) {
    this.lastPrimaryLatencyMs = latencyMs;
    this._failStreak.delete(primaryId);
    const recovered = this.failedProviders.delete(primaryId); // probe 성공 → 장애 해제
    if (recovered && this.failedProviders.size === 0 && this.current !== STATES.NORMAL) {
      this.toNormal();
    }
    return this.current;
  }

  /** 메인 호출이 임계값 초과(타임아웃)/에러. 연속 임계(기본 1회=즉시) 도달 시 제공자 장애 판정. */
  reportPrimaryFailure(primaryId, latencyMs) {
    this.lastPrimaryLatencyMs = latencyMs;
    const streak = (this._failStreak.get(primaryId) || 0) + 1;
    this._failStreak.set(primaryId, streak);
    if (streak >= PRIMARY_FAIL_THRESHOLD) {
      this.failedProviders.add(primaryId);
      // 최초 장애(Normal)만 Constrained 진입. 이미 우회 중(Recovered)에 다른 키가 추가로
      // 죽으면 그 키 지표도 보조 체인으로 합류할 뿐 상태는 유지한다.
      if (this.current === STATES.NORMAL) this.toConstrained();
    }
    // Recovered(probe 실패): resolveMode 가 probe 시작 시각을 이미 기록 → 다음 재확인은
    // autoRecoveryMs 뒤. 그때까지 보조 체인으로 계속 서빙한다.
    return this.current;
  }

  /** 보조 제공자 호출 성공. Constrained(우회 단계)에서만 Recovered 로 전이. */
  reportBackupSuccess() {
    if (this.current === STATES.CONSTRAINED) this.toRecovered();
    return this.current;
  }

  toNormal() {
    this.current = STATES.NORMAL;
    this.recoveredAt = null;
    this.constrainedAt = null;
    this.failedProviders.clear();
    this._failStreak.clear();
    this._lastProbeAt.clear();
    this._clearAutoRecoveryTimer();
    return this.current;
  }

  toConstrained() {
    this.current = STATES.CONSTRAINED;
    this.constrainedAt = Date.now();
    return this.current;
  }

  /**
   * Constrained → Recovered. 최초 진입 시에만 5초 자동복구 타이머를 시작한다(중복 등록 방지).
   */
  toRecovered() {
    const firstEntry = this.current !== STATES.RECOVERED;
    this.current = STATES.RECOVERED;
    if (firstEntry) {
      this.recoveredAt = Date.now();
      this._lastProbeAt.clear();
      this._scheduleAutoRecovery();
    }
    return this.current;
  }

  _scheduleAutoRecovery() {
    this._clearAutoRecoveryTimer();
    console.log('[state] auto-recovery 타이머 시작:', config.autoRecoveryMs + 'ms');
    this._autoRecoveryTimer = setTimeout(() => {
      // 5초 만료 → 주입 지연 자동 해제. 이후 루프의 probe 가 메인 정상 응답을 확인하면 Normal 로 전이.
      console.log('[state] auto-recovery 발화 → simulationEnabled=false');
      this.simulationEnabled = false;
      this._autoRecoveryTimer = null;
    }, config.autoRecoveryMs);
  }

  _clearAutoRecoveryTimer() {
    if (this._autoRecoveryTimer) {
      clearTimeout(this._autoRecoveryTimer);
      this._autoRecoveryTimer = null;
    }
  }

  snapshot() {
    return {
      current: this.current,
      simulationEnabled: this.simulationEnabled,
      recoveredAt: this.recoveredAt,
      failedProviders: [...this.failedProviders],
      lastPrimaryLatencyMs: this.lastPrimaryLatencyMs,
    };
  }
}

// 단일 공유 인스턴스.
export const networkState = new NetworkState();
export { STATES };
