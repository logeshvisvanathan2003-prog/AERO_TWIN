import { Line } from 'react-chartjs-2';
import { C, axis } from './theme.js';

/**
 * series: [{ label, color: 'accent'|'#hex', axis: 'y'|'y1', fill, dash }]
 * points: array of frame objects; `getters` maps each series to a value fn.
 */
export default function RollingLineChart({ labels, series, getters, yOpts = {}, y1Opts = null, height = 220 }) {
  const data = {
    labels,
    datasets: series.map((s, i) => ({
      label: s.label,
      data: getters[i],
      borderColor: C[s.color] || s.color,
      backgroundColor: (C[s.color] || s.color) + '22',
      borderWidth: 1.6, pointRadius: 0, tension: 0.28,
      yAxisID: s.axis || 'y', fill: s.fill ?? false, borderDash: s.dash || [],
    })),
  };
  const options = {
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: series.length > 1, position: 'top', align: 'end' },
      tooltip: { backgroundColor: '#0c141c', borderColor: '#1c2733', borderWidth: 1 },
    },
    scales: {
      x: axis({ ticks: { maxTicksLimit: 5, padding: 6 } }),
      y: axis(yOpts),
      ...(y1Opts ? { y1: axis({ position: 'right', grid: { display: false }, ...y1Opts }) } : {}),
    },
  };
  return <div style={{ height }}><Line data={data} options={options} /></div>;
}
