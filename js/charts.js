/* charts.js — minimal SVG drawing helpers. No dependencies, so the
   site works from a file:// path or GitHub Pages with nothing else. */

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

export function svg(w, h) {
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img' });
  s.W = w; s.H = h;
  return s;
}

export function scale(d0, d1, r0, r1) {
  const f = v => d1 === d0 ? r0 : r0 + (v - d0) / (d1 - d0) * (r1 - r0);
  f.invert = v => d0 + (v - r0) / (r1 - r0) * (d1 - d0);
  f.domain = [d0, d1]; f.range = [r0, r1];
  return f;
}

export function niceTicks(lo, hi, count = 5) {
  if (hi === lo) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function axes(s, x, y, opts = {}) {
  const g = el('g', { class: 'axis' });
  const [x0, x1] = x.range, [y1, y0] = [y.range[0], y.range[1]];
  const yt = opts.yTicks || niceTicks(y.domain[0], y.domain[1], opts.yCount || 5);
  yt.forEach(v => {
    const yy = y(v);
    g.appendChild(el('line', { x1: x0, x2: x1, y1: yy, y2: yy, class: v === 0 ? 'zero' : '' }));
    g.appendChild(el('text', { x: x0 - 8, y: yy + 3.5, 'text-anchor': 'end' },
      opts.yFmt ? opts.yFmt(v) : v));
  });
  const xt = opts.xTicks || niceTicks(x.domain[0], x.domain[1], opts.xCount || 6);
  xt.forEach(v => {
    const xx = x(v);
    g.appendChild(el('text', { x: xx, y: y1 + 17, 'text-anchor': 'middle' },
      opts.xFmt ? opts.xFmt(v) : v));
    if (opts.xGrid) g.appendChild(el('line', { x1: xx, x2: xx, y1: y0, y2: y1 }));
  });
  if (opts.xLabel) g.appendChild(el('text', { x: (x0 + x1) / 2, y: y1 + 36, 'text-anchor': 'middle', class: 'axlab' }, opts.xLabel));
  if (opts.yLabel) g.appendChild(el('text', {
    x: -(y0 + y1) / 2, y: 16, transform: 'rotate(-90)', 'text-anchor': 'middle', class: 'axlab'
  }, opts.yLabel));
  s.appendChild(g);
  return g;
}

export function linePath(pts, x, y) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join('');
}

export function line(s, pts, x, y, attrs = {}) {
  const p = el('path', {
    d: linePath(pts, x, y), fill: 'none', 'stroke-width': 1.8,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...attrs
  });
  s.appendChild(p);
  return p;
}

export function area(s, pts, x, y, base, attrs = {}) {
  const d = linePath(pts, x, y) +
    `L${x(pts[pts.length - 1][0]).toFixed(2)},${y(base).toFixed(2)}` +
    `L${x(pts[0][0]).toFixed(2)},${y(base).toFixed(2)}Z`;
  const p = el('path', { d, stroke: 'none', ...attrs });
  s.appendChild(p);
  return p;
}

/* Draw a path with a one-off reveal, respecting reduced-motion. */
export function reveal(path, ms = 900) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const len = path.getTotalLength();
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len;
  path.getBoundingClientRect();
  path.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.3,.7,.3,1)`;
  path.style.strokeDashoffset = 0;
}

/* ------------------------------------------------------------- tooltip */
let tipEl;
export function tip() {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  return tipEl;
}
export function showTip(evt, html) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add('on');
  const pad = 14, r = t.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
export function hideTip() { if (tipEl) tipEl.classList.remove('on'); }

export function hoverable(node, html) {
  node.addEventListener('mousemove', e => showTip(e, html));
  node.addEventListener('mouseleave', hideTip);
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', e => {
    const r = node.getBoundingClientRect();
    showTip({ clientX: r.left + r.width / 2, clientY: r.top }, html);
  });
  node.addEventListener('blur', hideTip);
}

/* Diverging credit ramp: teal (low loss) → gold → oxblood (high loss). */
export function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[0, [18, 131, 108]], [.5, [201, 154, 45]], [1, [192, 69, 61]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const u = (t - a) / (b - a);
      return `rgb(${ca.map((c, j) => Math.round(c + u * (cb[j] - c))).join(',')})`;
    }
  }
  return 'rgb(192,69,61)';
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
