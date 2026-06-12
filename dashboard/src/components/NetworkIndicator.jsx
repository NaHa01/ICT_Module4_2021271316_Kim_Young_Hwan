// 네트워크 상태 인디케이터 - 색상 점 + 상태 라벨 + 보조 설명 (기획서 4).
// Constrained 일 때 경고 텍스트가 점멸(blink)한다. 색상은 부드럽게 transition.

const STATUS = {
  Normal: {
    color: 'var(--status-normal)',
    label: '정상 작동 중',
    desc: '메인 API 실시간 수신',
    blink: false,
  },
  Constrained: {
    color: 'var(--status-constrained)',
    label: '메인 API 지연 감지 중',
    desc: '타임아웃 처리 · 업데이트 일시 정지',
    blink: true,
  },
  Recovered: {
    color: 'var(--status-recovered)',
    label: '보조 API로 복구됨',
    desc: '우회 가동 · 업데이트 재개',
    blink: false,
  },
};

export default function NetworkIndicator({ status, source }) {
  const s = STATUS[status] || STATUS.Normal;

  return (
    <div className="indicator" style={{ '--indicator-color': s.color }}>
      <span className="indicator__dot" />
      <div className="indicator__text">
        <span className={`indicator__label ${s.blink ? 'indicator__label--blink' : ''}`}>
          {s.label}
        </span>
        <span className="indicator__desc">
          {s.desc}
          {source && status !== 'Constrained' ? ` · source: ${source}` : ''}
        </span>
      </div>
    </div>
  );
}
