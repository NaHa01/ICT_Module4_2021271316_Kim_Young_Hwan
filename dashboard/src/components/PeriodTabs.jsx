// 기간 선택 탭: [1일][1주][1개월][1년][3년]. 선택 탭 강조.

const PERIODS = [
  { key: '1d', label: '1일' },
  { key: '1w', label: '1주' },
  { key: '1m', label: '1개월' },
  { key: '1y', label: '1년' },
  { key: '3y', label: '3년' },
];

export default function PeriodTabs({ value, onChange }) {
  return (
    <div className="period-tabs" role="tablist" aria-label="기간 선택">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          role="tab"
          aria-selected={value === p.key}
          className={`period-tab ${value === p.key ? 'period-tab--active' : ''}`}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export { PERIODS };
