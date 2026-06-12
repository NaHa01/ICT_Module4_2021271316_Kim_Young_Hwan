# /data — Sample (Synthetic) Data

The JSON files in this folder are **synthetic samples of the response contracts** returned by the backend API.
In production the data comes live from external APIs (KIS · Kiwoom · Yahoo · Frankfurter · Naver);
when keys are missing or every external source fails, the server generates mock data of the same shape at runtime
(`mockQuote` / `buildMockPoints` in `src/services/marketData.js`, `buildMockNews` in `src/services/newsService.js`).

| File | Corresponding API | Description |
|------|-------------------|-------------|
| `sample-financial-data.json` | `GET /api/financial-data` | 7 indicator cards + network status |
| `sample-chart-kospi-1d.json` | `GET /api/chart/:id?range=1d` | Line-chart points for a period |
| `sample-news.json` | `GET /api/news` | Economic news list (mock-fallback shape) |
