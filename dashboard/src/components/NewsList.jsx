// 경제 뉴스 리스트 - 세로 스크롤.

import NewsItem from './NewsItem.jsx';

export default function NewsList({ items, loading }) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <h2>실시간 경제 뉴스</h2>
        <span className="sidebar__sub">증시 · 환율</span>
      </div>
      <div className="news-list">
        {loading && !items.length ? (
          <div className="news-list__empty">뉴스를 불러오는 중…</div>
        ) : (
          items.map((item, i) => <NewsItem key={`${item.link}-${i}`} item={item} />)
        )}
      </div>
    </aside>
  );
}
