import { Radar } from 'react-chartjs-2';
import { C } from './theme.js';

export default function RadarChartCard({ labels, now, start, height = 260 }) {
  const data = {
    labels,
    datasets: [
      { label: 'Now', data: now, borderColor: C.accent, backgroundColor: C.accent + '26', borderWidth: 1.8, pointRadius: 2, pointBackgroundColor: C.accent },
      { label: 'Sortie start', data: start, borderColor: C.muted, backgroundColor: 'transparent', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
    ],
  };
  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', align: 'end' } },
    scales: {
      r: {
        min: 0, max: 100, angleLines: { color: '#16202b' }, grid: { color: '#16202b' },
        pointLabels: { color: '#8496a8', font: { size: 9.5, family: "'Inter', sans-serif" } },
        ticks: { display: false, stepSize: 25 },
      },
    },
  };
  return <div style={{ height }}><Radar data={data} options={options} /></div>;
}
