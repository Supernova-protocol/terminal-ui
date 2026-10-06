import './polyfills';
// Order matters: the original page loaded Tailwind (Play CDN) after its own stylesheet, so utilities win.
import './styles/site.css';
import './styles/tailwind.css';
import './globals';
import './live/bridge';
import './app.js';
