// GET /api/financial-data
// 실시간 금융 지표 + 현재 네트워크 상태를 반환. 프론트가 1초 간격으로 폴링한다.

import { Router } from 'express';
import { getFinancialData } from '../services/failover.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const payload = await getFinancialData();
    res.json(payload);
  } catch (err) {
    console.error('[financial] 처리 실패:', err);
    res.status(500).json({ error: 'failed to resolve financial data' });
  }
});

export default router;
