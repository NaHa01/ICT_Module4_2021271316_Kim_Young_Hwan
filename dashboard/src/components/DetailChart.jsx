// 상세 페이지 큰 라인 차트 (Recharts). 기간별 데이터 + KST 툴팁.
// 라인 색상: 선택 기간의 시작값 대비 상승이면 빨강, 하락이면 파랑.

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { api } from '../api/client.js';
import { formatAxisTime, formatTooltipTime } from '../utils/time.js';

const UP = '#FA5252';
const DOWN = '#339AF0';

// 기간별 X축 눈금 라벨 길이가 달라 겹치지 않도록 최소 간격을 다르게 둔다.
//   1d "HH:MM" · 1w "M/D HH:MM" · 1m "M/D" · 1y "YYYY/M/D" · 3y "YYYY/MM"
const TICK_GAP = { '1d': 40, '1w': 70, '1m': 36, '1y': 72, '3y': 60 };

export default function DetailChart({ id, range }) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const data = await api.getChart(id, range);
        if (cancelled) return;
        setPoints((data.points || []).map((p) => ({ t: p.t, value: p.value })));
      } catch (err) {
        if (!cancelled) console.warn('[DetailChart] 로드 실패:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    // 단기(1일/1주)는 실시간성이 있어 주기 갱신, 장기는 갱신 불필요.
    const interval =
      range === '1d' || range === '1w' ? setInterval(load, 30_000) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [id, range]);

  if (loading && !points.length) {
    return <div className="detail-chart detail-chart--empty">차트를 불러오는 중…</div>;
  }
  if (!points.length) {
    return <div className="detail-chart detail-chart--empty">차트 데이터가 없습니다.</div>;
  }

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const color = last >= first ? UP : DOWN;

  // 1일 탭이라도 데이터가 하루를 넘으면(분봉 없는 카드의 일별 폴백) 날짜 축으로 전환한다.
  const spanMs =
    points.length > 1 ? new Date(points[points.length - 1].t) - new Date(points[0].t) : 0;
  const axisRange = range === '1d' && spanMs > 36 * 3600e3 ? '1m' : range;

  return (
    <div className="detail-chart">
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={points} margin={{ top: 10, right: 24, bottom: 6, left: 6 }}>
          <CartesianGrid stroke="#E9ECEF" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 11, fill: '#868E96' }}
            tickFormatter={(t) => formatAxisTime(t, axisRange)}
            interval="preserveStartEnd"
            minTickGap={TICK_GAP[axisRange] ?? 40}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 11, fill: '#868E96' }}
            width={64}
            tickFormatter={(v) => v.toLocaleString('ko-KR')}
          />
          <Tooltip
            formatter={(v) => [v.toLocaleString('ko-KR'), '값']}
            labelFormatter={(t) => formatTooltipTime(t)}
            contentStyle={{ borderRadius: 8, border: '1px solid #E9ECEF', fontSize: 12 }}
            labelStyle={{ color: '#212529', fontWeight: 600 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
