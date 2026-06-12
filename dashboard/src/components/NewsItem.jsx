// 뉴스 항목 - 제목 / 출처 / 시간 / 링크.

function formatRelative(pubDate) {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  return d.toLocaleDateString('ko-KR');
}

export default function NewsItem({ item }) {
  return (
    <a className="news-item" href={item.link} target="_blank" rel="noreferrer">
      <div className="news-item__title">{item.title}</div>
      <div className="news-item__meta">
        <span className="news-item__source">{item.source}</span>
        <span className="news-item__time">{formatRelative(item.pubDate)}</span>
      </div>
    </a>
  );
}
