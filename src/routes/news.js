// GET /api/news
// 네이버 오픈 API 를 통해 '증시'/'환율' 경제 뉴스를 반환(키 없으면 mock 폴백).

import { Router } from 'express';
import { getNews } from '../services/newsService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const items = await getNews();
    res.json({ items });
  } catch (err) {
    console.error('[news] 처리 실패:', err);
    res.status(500).json({ error: 'failed to load news', items: [] });
  }
});

export default router;
