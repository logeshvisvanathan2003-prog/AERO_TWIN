import { Bar } from 'react-chartjs-2';
import { C, axis } from './theme.js';

export default function BarChartCard({ labels, values, horizontal = false, colors, xOpts = {}, height = 220 }) {
  const data = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: colors || C.accent,
      borderRadius: 3,
      barThickness: 14,
    }],
  };
  const options = {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0c141c' } },
    scales: { x: axis(xOpts), y: axis({}) },
  };
  return <div style={{ height }}><Bar data={data} options={options} /></div>;
}
