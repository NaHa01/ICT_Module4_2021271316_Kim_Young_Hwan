// 헤더 - 타이틀 + 상태 인디케이터 + 시뮬레이션 버튼.

import NetworkIndicator from './NetworkIndicator.jsx';
import SimulationButton from './SimulationButton.jsx';

export default function Header({ networkStatus, source, simEnabled, onToggleSim, toggling }) {
  return (
    <header className="header">
      <div className="header__title">
        <h1>실시간 금융 지표 모니터링</h1>
        <p>환율 · 주가지수 — API 장애 감지 → 우회 → 자동 복구</p>
      </div>
      <div className="header__controls">
        <NetworkIndicator status={networkStatus} source={source} />
        <SimulationButton enabled={simEnabled} onToggle={onToggleSim} disabled={toggling} />
      </div>
    </header>
  );
}
