import { Scatter } from 'react-chartjs-2';
import { C, axis } from './theme.js';

export default function ScatterChartCard({ points, height = 240 }) {
  const data = {
    datasets: [{ label: 'Cylinders 1-4', data: points, backgroundColor: C.accent, pointRadius: 7, pointHoverRadius: 9 }],
  };
  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (i) => `Cyl ${i.dataIndex + 1}: EGT ${i.parsed.x.toFixed(0)} \u00b0C / CHT ${i.parsed.y.toFixed(0)} \u00b0C` } },
    },
    scales: {
      x: axis({ title: { display: true, text: 'EGT (\u00b0C)', color: '#55677a' } }),
      y: axis({ title: { display: true, text: 'CHT (\u00b0C)', color: '#55677a' } }),
    },
  };
  return <div style={{ height }}><Scatter data={data} options={options} /></div>;
}
