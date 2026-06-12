// 루트 - 라우팅과 공유 폴링 컨텍스트만 담당한다.
//   "/"            → 대시보드
//   "/detail/:id"  → 지표 상세 페이지

import { Routes, Route } from 'react-router-dom';
import { FinancialProvider } from './context/FinancialProvider.jsx';
import Dashboard from './pages/Dashboard.jsx';
import DetailPage from './pages/DetailPage.jsx';

export default function App() {
  return (
    <FinancialProvider>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/detail/:id" element={<DetailPage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </FinancialProvider>
  );
}
