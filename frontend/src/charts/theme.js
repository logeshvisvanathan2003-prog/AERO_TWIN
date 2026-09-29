import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  RadialLinearScale, Title, Tooltip, Legend, Filler,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  RadialLinearScale, Title, Tooltip, Legend, Filler);

export const C = { accent: '#00d3a7', info: '#35c5ff', warn: '#ffb020', crit: '#ff4d5e', ok: '#2fd07a', muted: '#8496a8', line: '#1c2733' };

ChartJS.defaults.color = '#8496a8';
ChartJS.defaults.font.family = "'JetBrains Mono', monospace";
ChartJS.defaults.font.size = 10;
ChartJS.defaults.animation = false;
ChartJS.defaults.plugins.legend.labels.boxWidth = 8;
ChartJS.defaults.plugins.legend.labels.boxHeight = 8;
ChartJS.defaults.plugins.legend.labels.usePointStyle = true;
ChartJS.defaults.plugins.tooltip.backgroundColor = '#0c141c';
ChartJS.defaults.plugins.tooltip.titleColor = '#dde5ee';
ChartJS.defaults.plugins.tooltip.bodyColor = '#8496a8';
ChartJS.defaults.plugins.tooltip.borderColor = '#1c2733';
ChartJS.defaults.plugins.tooltip.borderWidth = 1;
ChartJS.defaults.plugins.tooltip.padding = 8;
ChartJS.defaults.plugins.tooltip.cornerRadius = 6;
ChartJS.defaults.plugins.tooltip.displayColors = true;

export const axis = (opts = {}) => ({
  grid: { color: '#16202b', drawTicks: false },
  border: { color: '#1c2733' },
  ticks: { maxTicksLimit: 6, padding: 6 },
  ...opts,
});
