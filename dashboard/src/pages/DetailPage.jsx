// 지표 상세 페이지("/detail/:id").
//  - 상단: ← 대시보드로 돌아가기 + 지표명/현재값/변동/카테고리
//  - 기간 탭 + 큰 라인 차트(KST 툴팁)
//  - 현재값은 공유 컨텍스트(1초 폴링)로 계속 갱신

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFinancial } from '../context/FinancialProvider.jsx';
import PeriodTabs from '../components/PeriodTabs.jsx';
import DetailChart from '../components/DetailChart.jsx';

const CATEGORY_LABEL = {
  fx: '환율',
  kr_index: '한국 주가지수',
  us_index: '해외 주가지수',
};

const DIRECTION = {
  up: { color: 'var(--color-up)', arrow: '▲', sign: '+' },
  down: { color: 'var(--color-down)', arrow: '▼', sign: '' },
  flat: { color: 'var(--color-flat)', arrow: '▬', sign: '' },
};

const fmt = (v) =>
  v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function BackLink() {
  return (
    <Link className="detail__back" to="/">
      ← 대시보드로 돌아가기
    </Link>
  );
}

export default function DetailPage() {
  const { id } = useParams();
  const { indices, timestamp } = useFinancial();
  const [range, setRange] = useState('1d');

  const index = indices.find((i) => i.id === id);

  if (!index) {
    return (
      <div className="detail">
        <BackLink />
        <div className="detail__loading">지표 데이터를 불러오는 중…</div>
      </div>
    );
  }

  const dir = DIRECTION[index.direction] || DIRECTION.flat;

  return (
    <div className="detail">
      <BackLink />

      <header className="detail__header">
        <div className="detail__title">
          <span className="detail__category">{CATEGORY_LABEL[index.category] || index.category}</span>
          <h1>{index.name}</h1>
        </div>

        <div className="detail__quote">
          <span className="detail__value">{fmt(index.value)}</span>
          <span className="detail__change" style={{ color: dir.color }}>
            {dir.arrow} {dir.sign}
            {fmt(Math.abs(index.change))} ({index.changePercent > 0 ? '+' : ''}
            {index.changePercent.toFixed(2)}%)
          </span>
        </div>
      </header>

      <section className="detail__chart-section">
        <div className="detail__chart-head">
          <h2 className="detail__section-title">가격 추이</h2>
          <PeriodTabs value={range} onChange={setRange} />
        </div>
        <DetailChart id={index.id} range={range} />
      </section>

      <div className="detail__updated">
        실시간 갱신 · 마지막 업데이트{' '}
        {timestamp ? new Date(timestamp).toLocaleTimeString('ko-KR', { hour12: false }) : '--:--:--'}
      </div>
    </div>
  );
}
