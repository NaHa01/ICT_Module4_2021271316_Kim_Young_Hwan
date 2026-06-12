// 메인 대시보드("/") - 헤더 + 7:3 레이아웃 + 섹션 카드 + 뉴스 사이드바.
// 카드 본문 클릭은 상세 페이지로 이동, ▼ 아이콘은 카드 아래 간략 차트를 펼친다.

import { useEffect, useRef, useState } from 'react';
import Header from '../components/Header.jsx';
import IndexGrid from '../components/IndexGrid.jsx';
import NewsList from '../components/NewsList.jsx';
import { useNews } from '../hooks/useNews.js';
import { useFinancial } from '../context/FinancialProvider.jsx';
import { api } from '../api/client.js';

export default function Dashboard() {
  const { indices, networkStatus, source, timestamp } = useFinancial();
  const { items, loading } = useNews();

  // 시뮬레이션 버튼 상태(프론트 로컬). 백엔드가 자동 원복 시 networkStatus 로 동기화.
  const [simEnabled, setSimEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);
  const prevStatus = useRef(networkStatus);

  // 섹션별로 펼쳐진 카드 1개씩(아코디언). 로드 시 기본 펼침: USD/KRW, KOSPI, S&P 500.
  const [expanded, setExpanded] = useState({
    fx: 'usdkrw',
    kr_index: 'kospi',
    us_index: 'sp500',
  });

  // 같은 섹션 내에서만 토글: 열려있던 카드면 닫고, 아니면 그 카드로 교체(이전 카드 자동 접힘).
  const handleToggleCard = (category, id) => {
    setExpanded((prev) => ({ ...prev, [category]: prev[category] === id ? null : id }));
  };

  const handleToggleSim = async (next) => {
    setToggling(true);
    try {
      const res = await api.toggleSimulation(next);
      setSimEnabled(res.simulationEnabled);
    } catch (err) {
      console.warn('[Dashboard] 시뮬레이션 토글 실패:', err.message);
    } finally {
      setToggling(false);
    }
  };

  // 자동 원복: Recovered/Constrained → Normal 로 돌아오면 버튼을 OFF 로 표시.
  useEffect(() => {
    if (prevStatus.current !== 'Normal' && networkStatus === 'Normal') {
      setSimEnabled(false);
    }
    prevStatus.current = networkStatus;
  }, [networkStatus]);

  return (
    <div className="app">
      <Header
        networkStatus={networkStatus}
        source={source}
        simEnabled={simEnabled}
        onToggleSim={handleToggleSim}
        toggling={toggling}
      />
      <div className="layout">
        <main className="main-panel">
          <IndexGrid
            indices={indices}
            timestamp={timestamp}
            expanded={expanded}
            onToggle={handleToggleCard}
          />
        </main>
        <NewsList items={items} loading={loading} />
      </div>
    </div>
  );
}
