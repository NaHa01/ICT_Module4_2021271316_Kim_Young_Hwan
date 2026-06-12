// 경제 뉴스 서비스 - 네이버 검색(뉴스) 오픈 API 호출 + HTML 태그 제거 + mock 폴백.
//
// 네이버 응답 title/description 에는 <b> 같은 HTML 태그와 엔티티가 섞여 있으므로
// sanitize 후 프론트로 전달한다. 자격증명이 없으면 mock 뉴스로 폴백한다.

import { config, hasNaverCredentials } from '../config.js';

const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';
const QUERIES = ['증시', '환율'];

// 짧은 캐시로 과도한 외부 호출을 방지(프론트 폴링 주기와 무관하게 보호).
let cache = { at: 0, items: null };
const CACHE_TTL_MS = 30_000;

/** HTML 태그 및 주요 엔티티 제거. */
function sanitize(text = '') {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** 네이버 pubDate(RFC1123) → ISO 문자열. 파싱 실패 시 원본 유지. */
function toIso(pubDate) {
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? pubDate : d.toISOString();
}

/** originallink/link 도메인에서 대략적인 출처 추출. */
function deriveSource(item) {
  const url = item.originallink || item.link || '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '뉴스';
  }
}

function buildMockNews() {
  const now = Date.now();
  const base = [
    { title: '코스피 1% 상승 마감…외국인·기관 동반 순매수', source: '한국경제' },
    { title: '원/달러 환율 5원 하락…1,380원선 공방', source: '연합뉴스' },
    { title: '코스닥 강보합 마감, 2차전지株 강세', source: '매일경제' },
    { title: '국제유가 상승…WTI 배럴당 78달러 돌파', source: '서울경제' },
    { title: '美 S&P500 사상 최고치 경신…기술주 랠리', source: '이데일리' },
    { title: '유로화 강세에 EUR/KRW 1,490원대 등락', source: '아시아경제' },
    { title: '증시 전문가 "하반기 변동성 확대 대비해야"', source: '머니투데이' },
    { title: '환율 변동성 확대에 수출기업 환헤지 분주', source: '파이낸셜뉴스' },
  ];
  return base.map((n, i) => ({
    title: n.title,
    link: 'https://finance.naver.com/',
    pubDate: new Date(now - i * 6 * 60_000).toISOString(),
    source: n.source,
  }));
}

async function fetchFromNaver() {
  const headers = {
    'X-Naver-Client-Id': config.naverClientId,
    'X-Naver-Client-Secret': config.naverClientSecret,
  };

  // 여러 키워드 결과를 병합한다.
  const requests = QUERIES.map(async (q) => {
    const url = `${NAVER_NEWS_URL}?query=${encodeURIComponent(q)}&display=10&sort=date`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`naver ${q} -> HTTP ${res.status}`);
    const json = await res.json();
    return json.items || [];
  });

  const groups = await Promise.all(requests);
  const merged = groups.flat();

  // link 기준 중복 제거 후 최신순 정렬.
  const seen = new Set();
  const items = [];
  for (const raw of merged) {
    const link = raw.originallink || raw.link;
    if (seen.has(link)) continue;
    seen.add(link);
    items.push({
      title: sanitize(raw.title),
      link,
      pubDate: toIso(raw.pubDate),
      source: deriveSource(raw),
    });
  }
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return items.slice(0, 20);
}

export async function getNews() {
  // 캐시 적중 시 즉시 반환.
  if (cache.items && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.items;
  }

  if (!hasNaverCredentials()) {
    const mock = buildMockNews();
    cache = { at: Date.now(), items: mock };
    return mock;
  }

  try {
    const items = await fetchFromNaver();
    cache = { at: Date.now(), items };
    return items;
  } catch (err) {
    // 호출 실패 시에도 시연이 막히지 않도록 mock 으로 폴백.
    console.warn('[newsService] 네이버 API 실패, mock 폴백:', err.message);
    const mock = buildMockNews();
    cache = { at: Date.now(), items: mock };
    return mock;
  }
}
