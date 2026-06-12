// POST /api/simulate/toggle
// 장애 시뮬레이션 ON/OFF 토글. ON 시 메인 API 에 INJECTED_DELAY_MS 지연이 주입된다.

import { Router } from 'express';
import { config } from '../config.js';
import { networkState } from '../state/networkState.js';

const router = Router();

router.post('/toggle', (req, res) => {
  const { enabled } = req.body ?? {};
  const next = networkState.setSimulation(enabled);
  res.json({
    simulationEnabled: next,
    injectedDelayMs: config.injectedDelayMs,
  });
});

export default router;
