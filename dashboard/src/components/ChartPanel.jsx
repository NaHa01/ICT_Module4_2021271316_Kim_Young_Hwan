// 24시간 라인 차트 (Recharts). 카드가 펼쳐질 때 그 아래에 표시된다.
// X축 1시간 간격 HH:MM, Y축 지표값. 라인 색상: up=빨강, down=파랑.

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

const COLOR = { up: '#FA5252', down: '#339AF0', flat: '#868E96' };

export default function ChartPanel({ id, direction }) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.getChart(id);
        if (cancelled) return;
        setPoints((data.points || []).map((p) => ({ t: p.t, value: p.value })));
      } catch (err) {
        if (!cancelled) console.warn('[ChartPanel] 차트 로드 실패:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    // 펼쳐진 동안 60초마다 갱신.
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  const color = COLOR[direction] || COLOR.flat;

  if (loading && !points.length) {
    return <div className="chart-panel chart-panel--empty">차트를 불러오는 중…</div>;
  }
  if (!points.length) {
    return <div className="chart-panel chart-panel--empty">차트 데이터가 없습니다.</div>;
  }

  // 분봉이 있으면 당일(시:분), 분봉이 없어 일별로 폴백되면(환율 등) 날짜 축으로 표시.
  const spanMs =
    points.length > 1 ? new Date(points[points.length - 1].t) - new Date(points[0].t) : 0;
  const multiDay = spanMs > 36 * 3600e3;
  const axisRange = multiDay ? '1m' : '1d';

  return (
    <div className="chart-panel">
      <div className="chart-panel__caption">{multiDay ? '최근 30일' : '당일'}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#E9ECEF" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 11, fill: '#868E96' }}
            tickFormatter={(t) => formatAxisTime(t, axisRange)}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 11, fill: '#868E96' }}
            width={56}
            tickFormatter={(v) => v.toLocaleString('ko-KR')}
          />
          <Tooltip
            formatter={(v) => v.toLocaleString('ko-KR')}
            labelFormatter={(t) => formatTooltipTime(t)}
            labelStyle={{ color: '#212529' }}
            contentStyle={{ borderRadius: 8, border: '1px solid #E9ECEF', fontSize: 12 }}
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
