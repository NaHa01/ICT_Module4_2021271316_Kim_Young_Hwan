// '통신 장애 시뮬레이션' 토글 버튼.
// ON 일 때 강조 표시. 자동 원복 후 부모가 OFF 로 되돌린다.

export default function SimulationButton({ enabled, onToggle, disabled }) {
  return (
    <button
      type="button"
      className={`sim-btn ${enabled ? 'sim-btn--on' : ''}`}
      onClick={() => onToggle(!enabled)}
      disabled={disabled}
    >
      <span className="sim-btn__icon">{enabled ? '⚡' : '🛠'}</span>
      {enabled ? '시뮬레이션 ON' : '통신 장애 시뮬레이션'}
    </button>
  );
}
