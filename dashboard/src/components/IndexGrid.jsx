// 카테고리별 섹션 그리드. 카드 클릭 시 카드 행 전체 아래(섹션 폭 전체)에 24h 차트를 펼친다.
// 차트는 카드 그리드 바깥(섹션 레벨)에 렌더링하므로 카드는 항상 가로 배열을 유지한다.

import IndexCard from './IndexCard.jsx';
import ChartPanel from './ChartPanel.jsx';

// 섹션 순서/제목 (기획서 3절).
const SECTIONS = [
  { key: 'fx', title: '환율' },
  { key: 'kr_index', title: '한국 주가지수' },
  { key: 'us_index', title: '해외 주가지수' },
];

export default function IndexGrid({ indices, timestamp, expanded, onToggle }) {
  if (!indices.length) {
    return <div className="grid__empty">데이터를 불러오는 중…</div>;
  }

  const byCategory = indices.reduce((acc, idx) => {
    (acc[idx.category] ||= []).push(idx);
    return acc;
  }, {});

  return (
    <div className="sections">
      {SECTIONS.map((section) => {
        const cards = byCategory[section.key];
        if (!cards || !cards.length) return null;
        const expandedId = expanded[section.key];
        const expandedCard = cards.find((c) => c.id === expandedId);

        return (
          <section className="section" key={section.key}>
            <h2 className="section__title">{section.title}</h2>
            {/* 카드는 항상 가로 그리드 유지 */}
            <div className="grid">
              {cards.map((index) => (
                <IndexCard
                  key={index.id}
                  index={index}
                  timestamp={timestamp}
                  expanded={expandedId === index.id}
                  onToggle={onToggle}
                />
              ))}
            </div>
            {/* 펼친 차트는 카드 행 전체 아래, 섹션 폭 전체로 렌더링 */}
            {expandedCard ? (
              <div className="chart-cell">
                <ChartPanel
                  id={expandedCard.id}
                  direction={expandedCard.direction}
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
