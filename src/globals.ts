/* Libraries the original page loaded from CDNs, now bundled and exposed the same way. */
import '@fortawesome/fontawesome-free/js/solid.js';
import '@fortawesome/fontawesome-free/js/regular.js';
import '@fortawesome/fontawesome-free/js/fontawesome.js';
import * as LightweightCharts from 'lightweight-charts';
import Chart from 'chart.js/auto';

(window as any).LightweightCharts = LightweightCharts;
(window as any).Chart = Chart;
