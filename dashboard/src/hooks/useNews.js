// 경제 뉴스 훅 - 초기 로드 + 60초 주기 갱신.

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const REFRESH_INTERVAL_MS = 60_000;

export function useNews() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.getNews();
        if (!cancelled) setItems(data.items || []);
      } catch (err) {
        if (!cancelled) console.warn('[useNews] 로드 실패:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { items, loading };
}
