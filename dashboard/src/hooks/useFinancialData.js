// 1초 간격 폴링으로 /api/financial-data 를 호출하는 커스텀 훅.
// Constrained 일 때는 직전 indices 를 유지하여 화면 깜빡임을 방지한다.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

const POLL_INTERVAL_MS = 1000;

export function useFinancialData() {
  const [indices, setIndices] = useState([]);
  const [networkStatus, setNetworkStatus] = useState('Normal');
  const [source, setSource] = useState('main');
  const [timestamp, setTimestamp] = useState(null);
  const [responseTimeMs, setResponseTimeMs] = useState(null);

  // 직전 indices 를 유지하기 위한 ref(클로저 최신값 보장).
  const lastIndices = useRef([]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const data = await api.getFinancialData();
        if (cancelled) return;

        setNetworkStatus(data.networkStatus);
        setSource(data.source);
        setResponseTimeMs(data.responseTimeMs);
        setTimestamp(data.timestamp);

        // Constrained: 업데이트 정지 → 직전 값 유지. 그 외에는 갱신.
        if (data.networkStatus !== 'Constrained' && Array.isArray(data.indices) && data.indices.length) {
          lastIndices.current = data.indices;
          setIndices(data.indices);
        }
      } catch (err) {
        // 네트워크 오류 시에도 직전 값을 유지하고 다음 폴링을 기다린다.
        if (!cancelled) console.warn('[useFinancialData] poll 실패:', err.message);
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { indices, networkStatus, source, timestamp, responseTimeMs };
}
