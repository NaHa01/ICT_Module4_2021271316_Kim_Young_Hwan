// 금융 데이터 폴링을 앱 전역에서 한 번만 수행하고 컨텍스트로 공유한다.
// 대시보드("/")와 상세 페이지("/detail/:id")가 같은 1초 폴링 결과를 구독하므로,
// 페이지 전환 후에도 현재값이 계속 갱신된다.

import { createContext, useContext } from 'react';
import { useFinancialData } from '../hooks/useFinancialData.js';

const FinancialContext = createContext(null);

export function FinancialProvider({ children }) {
  const data = useFinancialData();
  return <FinancialContext.Provider value={data}>{children}</FinancialContext.Provider>;
}

export function useFinancial() {
  const ctx = useContext(FinancialContext);
  if (!ctx) throw new Error('useFinancial 은 FinancialProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}
