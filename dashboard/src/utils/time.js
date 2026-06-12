// 한국 시간(KST) 포맷 유틸. 백엔드 timestamp 는 ISO(UTC)이므로 Asia/Seoul 로 변환한다.

function kstParts(iso) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return parts; // { year, month, day, hour, minute }
}

/** 툴팁용: "6/6 14:30" (KST). */
export function formatTooltipTime(iso) {
  const p = kstParts(iso);
  if (!p.month) return '';
  return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`;
}

/**
 * X축 눈금용: 기간에 따라 시각/날짜 표기를 다르게.
 *  - 1d: HH:MM            (시:분)
 *  - 1w: M/D HH:MM        (월/일 시:분 — 여러 날에 걸치므로 날짜를 함께 표기)
 *  - 1m: M/D              (월/일)
 *  - 1y: YYYY/M/D         (연 포함 — 양끝이 같은 월/일이어도 연도로 구분되어 기간이 보임)
 *  - 3y: YYYY/MM          (연/월)
 */
export function formatAxisTime(iso, range) {
  const p = kstParts(iso);
  if (!p.month) return '';
  const M = Number(p.month);
  const D = Number(p.day);
  switch (range) {
    case '1d':
      return `${p.hour}:${p.minute}`;
    case '1w':
      return `${M}/${D} ${p.hour}:${p.minute}`;
    case '1m':
      return `${M}/${D}`;
    case '1y':
      return `${p.year}/${M}/${D}`;
    case '3y':
      return `${p.year}/${p.month}`;
    default:
      return `${M}/${D}`;
  }
}
