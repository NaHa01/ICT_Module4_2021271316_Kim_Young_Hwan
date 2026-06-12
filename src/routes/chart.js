// GET /api/chart/:id?range=1d|1w|1m|1y|3y
// 기간별 라인 차트. 1일=지수 Yahoo 분봉+실시간 누적 꼬리·환율 Yahoo 분봉,
// 1주~3년=지수 Yahoo 일/주봉·환율 Frankfurter(ECB). 실패 시 KIS→mock. (상세: marketData.getChart)

import { Router } from 'express';
import { getChart } from '../services/marketData.js';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const data = await getChart(req.params.id, req.query.range);
    res.json(data);
  } catch (err) {
    console.error('[chart] 처리 실패:', err);
    res.status(500).json({ id: req.params.id, points: [], error: 'failed to load chart' });
  }
});

export default router;
