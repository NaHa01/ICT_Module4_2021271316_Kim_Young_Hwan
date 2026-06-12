// 지표 카드 - 본문 클릭은 상세 페이지로 이동, ▼ 아이콘은 카드 아래 간략 차트 펼침/접힘.
// 색상 규칙: up=빨강 + ▲, down=파랑 + ▼, flat=회색 + ▬.

import { useNavigate } from 'react-router-dom';

const DIRECTION = {
  up: { color: 'var(--color-up)', arrow: '▲', sign: '+' },
  down: { color: 'var(--color-down)', arrow: '▼', sign: '' },
  flat: { color: 'var(--color-flat)', arrow: '▬', sign: '' },
};

function formatNumber(value) {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--:--';
  return new Date(timestamp).toLocaleTimeString('ko-KR', { hour12: false });
}

export default function IndexCard({ index, timestamp, expanded, onToggle }) {
  const navigate = useNavigate();
  const dir = DIRECTION[index.direction] || DIRECTION.flat;

  const goDetail = () => navigate(`/detail/${index.id}`);
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goDetail();
    }
  };
  const toggleChart = (e) => {
    e.stopPropagation(); // 본문(상세 이동) 클릭과 분리
    onToggle(index.category, index.id);
  };

  return (
    <div
      className={`card ${expanded ? 'card--expanded' : ''}`}
      role="button"
      tabIndex={0}
      onClick={goDetail}
      onKeyDown={handleKey}
      title="클릭하면 상세 페이지로 이동"
    >
      <div className="card__header">
        <span className="card__name">{index.name}</span>
        <button
          type="button"
          className="card__expand"
          onClick={toggleChart}
          aria-expanded={expanded}
          aria-label={expanded ? '간략 차트 접기' : '간략 차트 펼치기'}
          title={expanded ? '간략 차트 접기' : '간략 차트 펼치기'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      <div className="card__value">{formatNumber(index.value)}</div>
      <div className="card__change" style={{ color: dir.color }}>
        <span className="card__arrow">{dir.arrow}</span>
        <span>
          {dir.sign}
          {formatNumber(Math.abs(index.change))}
        </span>
        <span className="card__pct">
          ({index.changePercent > 0 ? '+' : ''}
          {index.changePercent.toFixed(2)}%)
        </span>
      </div>

      <div className="card__time">업데이트 {formatTime(timestamp)}</div>
    </div>
  );
}
