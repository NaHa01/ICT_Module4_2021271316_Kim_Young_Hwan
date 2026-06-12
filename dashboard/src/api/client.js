// fetch 래퍼 - /api 는 Vite 프록시를 통해 backend 로 전달된다.

async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getFinancialData: () => request('/api/financial-data'),
  getNews: () => request('/api/news'),
  getChart: (id, range) =>
    request(
      `/api/chart/${encodeURIComponent(id)}${range ? `?range=${encodeURIComponent(range)}` : ''}`
    ),
  toggleSimulation: (enabled) =>
    request('/api/simulate/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
};
