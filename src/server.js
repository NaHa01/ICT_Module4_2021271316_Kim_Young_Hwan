// Express 진입점 - 라우트 등록, CORS, .env 로딩.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { config } from './config.js';
import { networkState } from './state/networkState.js';
import * as marketData from './services/marketData.js';
import financialRouter from './routes/financial.js';
import simulateRouter from './routes/simulate.js';
import newsRouter from './routes/news.js';
import chartRouter from './routes/chart.js';

const app = express();

app.use(cors());
app.use(express.json());

// 헬스체크.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    network: networkState.snapshot(),
    sources: marketData.getSourceSummary(),
    uptime: process.uptime(),
  });
});

app.use('/api/financial-data', financialRouter);
app.use('/api/simulate', simulateRouter);
app.use('/api/news', newsRouter);
app.use('/api/chart', chartRouter);

// 외부 실데이터 백그라운드 갱신을 먼저 시작(최초 스냅샷 확보 후 서버 오픈).
await marketData.start();

app.listen(config.port, () => {
  console.log(`[backend] 실시간 금융 모니터링 서버 가동: http://localhost:${config.port}`);
  console.log(
    `[backend] timeout=${config.mainTimeoutMs}ms, injectedDelay=${config.injectedDelayMs}ms, autoRecovery=${config.autoRecoveryMs}ms`
  );
  console.log(
    `[backend] 실시간 페이싱: gap하한=${config.indicatorGapMs}ms, KIS=키별 1000÷담당지표수, 키움≤${config.kiwoomMaxPerSec}콜/초`
  );
});
