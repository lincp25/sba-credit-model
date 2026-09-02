import * as M from './model.js';
import * as C from './charts.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const COL = { teal: '#12836C', gold: '#C08A1E', ox: '#C0453D', steel: '#2B5C93',
              ink: '#13314F', faint: '#94A3B8', line: '#EEF2F7' };
const BAND_COL = { '<50K': '#C0453D', '50-150K': '#D98324', '150-350K': '#B08B1E',
                   '350K-1M': '#2B5C93', '1M+': '#12836C' };

const S = {
  businesstype: 'CORPORATION', sector: 'Accommodation & Food',
  subprogram: 'Guaranty', collateral: 0, size: '<50K',
  regime: 'through-cycle', unemployment: 6, prime: 5, hpi: 0,
  survMode: 'surv', showRegimes: false,
  era: 'all', seaMode: 'haz', seaGhost: true, seaPool: false, prevEra: null,
  valSet: 'holdout', valHidden: true,
  scThin: true, scUnder: false, scGuar: false,
  lgdThin: true, driverShown: true,
  policyG: 0,
  A: { ...M.DEFAULTS }
};

/* =============================================================== boot */
M.load().then(() => { buildRail(); wire(); renderAll(); })
  .catch(e => { document.querySelector('.main').innerHTML =
    `<div class="wrap" style="padding:60px 40px"><h2>Could not load the data</h2>
     <p class="note">${e.message}. If you opened this file directly, run a local server
     instead: <span class="mono">python3 -m http.server</span> in this folder, then visit
     <span class="mono">localhost:8000</span>.</p></div>`; });

function buildRail() {
  fill('#f-size', M.BANDS, S.size);
  fill('#f-sector', M.D.levels.sector, S.sector);
  fill('#f-bt', M.D.levels.businesstype, S.businesstype);
  fill('#f-prog', M.D.levels.subprogram, S.subprogram);
  $('#f-col').value = String(S.collateral);
  $('#f-reg').value = S.regime;
  const f = M.D.costs.funding, cc = M.D.costs.capital_charge;
  const opts = (obj, cur) => Object.keys(obj)
    .map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${k} — ${(obj[k] * 100).toFixed(2)}%</option>`).join('');
  $('#a-fund').innerHTML = opts(f, S.A.fund);
  $('#a-cap').innerHTML  = opts(cc, S.A.capital);
  syncAssumptions();
}
function fill(sel, vals, cur) {
  $(sel).innerHTML = vals.map(v => `<option${v === cur ? ' selected' : ''}>${v}</option>`).join('');
}

function wire() {
  const bind = (sel, key, cast = x => x) =>
    $(sel).addEventListener('change', e => { S[key] = cast(e.target.value); renderAll(); });
  bind('#f-size', 'size'); bind('#f-sector', 'sector'); bind('#f-bt', 'businesstype');
  bind('#f-prog', 'subprogram'); bind('#f-col', 'collateral', Number); bind('#f-reg', 'regime');

  [['#f-un', 'unemployment', '#o-un', v => v.toFixed(1) + '%'],
   ['#f-pr', 'prime', '#o-pr', v => v.toFixed(2) + '%'],
   ['#f-hp', 'hpi', '#o-hp', v => v.toFixed(1) + '%']].forEach(([sel, key, out, fmt]) => {
    $(sel).addEventListener('input', e => {
      S[key] = +e.target.value; $(out).textContent = fmt(S[key]); renderAll();
    });
  });

  segGroup('#surv-mode', v => { S.survMode = v; renderSurvival(); });
  $('#btn-regimes').addEventListener('click', e => {
    S.showRegimes = !S.showRegimes;
    e.target.classList.toggle('on', S.showRegimes);
    e.target.textContent = S.showRegimes ? 'Show this regime only' : 'Compare all three regimes';
    renderSurvival();
  });

  segGroup('#sea-era', v => { S.prevEra = S.era; S.era = v; renderSeason(); });
  segGroup('#sea-mode', v => { S.seaMode = v; S.prevEra = null; renderSeason(); });
  $('#sea-ghost').addEventListener('change', e => { S.seaGhost = e.target.checked; renderSeason(); });
  $('#sea-pool').addEventListener('change', e => { S.seaPool = e.target.checked; renderSeason(); });

  segGroup('#val-set', v => { S.valSet = v; renderValid(); });
  $('#btn-guess').addEventListener('click', e => {
    S.valHidden = !S.valHidden;
    e.target.classList.toggle('on', S.valHidden);
    e.target.textContent = S.valHidden ? 'Reveal observed series' : 'Hide observed series';
    renderValid();
  });

  $('#sc-thin').classList.add('on');
  toggle('#sc-thin', 'scThin', renderScatter);
  toggle('#sc-under', 'scUnder', renderScatter);
  $('#sc-guar').addEventListener('change', e => { S.scGuar = e.target.checked; renderScatter(); });
  $('#lgd-thin').addEventListener('change', e => { S.lgdThin = e.target.checked; renderLGD(); });
  

    const setA = (k, v) => { S.A[k] = v; syncAssumptions(); renderAll(); };
  $('#a-fund').addEventListener('change', e => setA('fund', e.target.value));
  $('#a-cap').addEventListener('change',  e => setA('capital', e.target.value));
  $('#a-hor').addEventListener('change',  e => setA('horizon', +e.target.value));
  $('#a-relief').addEventListener('change', e => setA('capitalRelief', e.target.value === '1'));
  $('#a-serv').addEventListener('input', e => setA('servicing', +e.target.value / 100));
  $('#a-orig').addEventListener('input', e => setA('origMult', +e.target.value));
  $('#a-min').addEventListener('input',  e => setA('minLoans', +e.target.value));
  $('#a-reset').addEventListener('click', () => {
    S.A = { ...M.DEFAULTS };
    $('#a-fund').value = S.A.fund; $('#a-cap').value = S.A.capital;
    $('#a-hor').value = S.A.horizon; $('#a-relief').value = '1';
    $('#a-serv').value = S.A.servicing * 100; $('#a-orig').value = S.A.origMult;
    $('#a-min').value = S.A.minLoans;
    syncAssumptions(); renderAll();
  });
  $('#gp-g').addEventListener('input', e => {
    S.policyG = +e.target.value; $('#o-gp').textContent = S.policyG + '%'; renderPolicy();
  });
}
function segGroup(sel, cb) {
  $$(`${sel} button`).forEach(b => b.addEventListener('click', () => {
    $$(`${sel} button`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    cb(b.dataset.v);
  }));
}
function toggle(sel, key, cb) {
  $(sel).addEventListener('click', e => { S[key] = !S[key]; e.target.classList.toggle('on', S[key]); cb(); });
}

function renderAll() {
  $('#macro-box').style.display = S.regime === 'through-cycle' ? '' : 'none';
  $('#macro-note').textContent = '';
  renderRail(); renderSurvival(); renderWaterfall(); renderSwaps();
  renderSeason(); renderValid(); renderErrors(); renderScatter();
  renderLGD(); renderDriver(); renderStack(); renderPolicy(); renderSplit(); renderLimits();
}

/* =============================================================== rail */
function profile() { return { ...S }; }

function renderRail() {
  const p = profile(), r = M.row(p), lg = M.lgdFor(p);
  const pd = h => M.pdAt(p, S.regime, h);
  const pd60 = pd(60);
  const el = pd60 == null ? null : pd60 * lg.lgd;

  const box = $('#r-el');
  box.textContent = el == null ? 'n/a' : M.fmtPct(el, 1);
  box.className = 'big ' + (el == null ? '' : el > .12 ? 'risk' : el < .05 ? 'ok' : '');

  $('#r-pd12').textContent = M.fmtPct(pd(12));
  $('#r-pd36').textContent = M.fmtPct(pd(36), 1);
  $('#r-pd60').textContent = M.fmtPct(pd60, 1);
  $('#r-lgd').textContent = M.fmtPct(lg.lgd, 0);
  $('#r-rank').textContent = el == null ? '—' : M.ordinal(Math.round(M.percentileOfEL(el) * 100)) + ' pct';
  $('#r-n').textContent = r ? M.fmtNum(r[M.D.ix.loans]) : '0';
  $('#r-avg').textContent = r && r.avgLoan ? M.fmtUSD(r.avgLoan) : '—';

  const w = [];
  if (!r || r[M.D.ix.loans] === 0)
    w.push('This combination does not occur in the SBA record. The model will price it, but no observations support the result.');
  else if (r[M.D.ix.loans] < S.A.minLoans)
    w.push(`${r[M.D.ix.loans]} loans match this profile. Below 100, figures are indicative only.`);
  if (lg.thin)
    w.push(`Severity for ${S.size} in ${S.sector} rests on ${lg.n} defaults; the ${S.size} band average is used instead.`);
  if (S.regime !== 'through-cycle' && M.pdAt(p, S.regime, 60) == null)
    w.push(`No ${S.regime} observations exist for this profile.`);
  $('#r-warn').innerHTML = w.map(t => `<div class="warn">${t}</div>`).join('');
}

/* ========================================================== survival */
function renderSurvival() {
  const host = $('#fig-surv'); C.clear(host);
  const W = 700, H = 320, m = { t: 14, r: 108, b: 46, l: 64 };
  const s = C.svg(W, H);
  const p = profile();
  const paths = S.showRegimes
    ? M.REGIMES.map(rg => ({ rg, path: M.survivalPath(p, rg) })).filter(x => x.path)
    : [{ rg: S.regime, path: M.survivalPath(p, S.regime) }];
  if (!paths.length) { host.innerHTML = '<p class="note">No model for this profile.</p>'; return; }

  const haz = S.survMode === 'haz';
  const vals = paths.flatMap(x => x.path.map(d => haz ? d.hazard : d.survival * 100));
  const top = haz ? Math.max(...vals) * 1.15 : 100;
  const bot = haz ? 0 : Math.min(Math.min(...vals) * .96, 99.5);
  const x = C.scale(0, 120, m.l, W - m.r), y = C.scale(bot, top, H - m.b, m.t);

  C.axes(s, x, y, {
    xTicks: [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    xFmt: v => v % 24 ? '' : v / 12 + 'y',
    yFmt: v => haz ? (v * 100).toFixed(2) + '%' : v.toFixed(0),
    xLabel: 'age of the loan',
    yLabel: haz ? 'monthly default rate' : 'performing, per 100 originated'
  });

  const regCol = { benign: COL.teal, 'through-cycle': COL.steel, crisis: COL.ox };
  paths.forEach(({ rg, path }) => {
    const pts = path.map(d => [d.month, haz ? d.hazard : d.survival * 100]);
    const col = S.showRegimes ? regCol[rg] : COL.ink;
    if (!haz && !S.showRegimes)
      C.area(s, pts, x, y, bot, { fill: COL.ink, opacity: .06 });
    const ln = C.line(s, pts, x, y, { stroke: col, 'stroke-width': rg === S.regime ? 2.2 : 1.5 });
    if (S.showRegimes) {
      const last = pts[pts.length - 1];
      s.appendChild(C.el('text', { x: x(last[0]) + 7, y: y(last[1]) + 4, fill: col, class: 'serieslab' }, rg));
    } else C.reveal(ln, 850);
  });

  if (!S.showRegimes && !haz) {
    const path = paths[0].path;
    [12, 36, 60].forEach(mo => {
      const d = path.find(v => v.month === mo); if (!d) return;
      const yy = y(d.survival * 100), xx = x(mo);
      s.appendChild(C.el('line', { x1: xx, x2: xx, y1: yy, y2: H - m.b, stroke: COL.gold, 'stroke-dasharray': '2 3', 'stroke-width': 1 }));
      const dot = C.el('circle', { cx: xx, cy: yy, r: 4, fill: COL.gold });
      C.hoverable(dot, `<b>month ${mo}</b><br>${(d.cum * 100).toFixed(2)} of 100 loans defaulted`);
      s.appendChild(dot);
      s.appendChild(C.el('text', { x: xx + 6, y: yy - 8, fill: COL.gold, class: 'serieslab' }, (d.cum * 100).toFixed(1) + '% defaulted'));
    });
  }
  host.appendChild(s);

  const path = paths.find(v => v.rg === S.regime)?.path;
  const p60 = path?.find(v => v.month === 60);
  $('#surv-title').textContent = haz ? 'Monthly default rate' : 'Loans performing, per 100 originated';

  // describe the actual shape of this borrower's hazard, which differs by regime
  let shape = '';
  if (path) {
    let pk = 0;
    path.forEach((v, i) => { if (v.hazard > path[pk].hazard) pk = i; });
    const peak = path[pk], end = path[path.length - 1];
    const to90 = path.find(v => v.hazard >= .9 * peak.hazard);
    shape = peak.month >= end.month
      ? `The monthly default rate is still rising at month 120, having reached 90% of its maximum by
         month ${to90.month}. No decline occurs within the modelled window.`
      : `The monthly default rate peaks at month ${peak.month} and then declines, ending
         ${((1 - end.hazard / peak.hazard) * 100).toFixed(0)}% below that maximum. Under crisis
         coefficients, defaults are concentrated early in the life of the loan.`;
  }
  $('#cap-surv').innerHTML = !p60 ? '' :
    `<b>${(p60.cum * 100).toFixed(1)} of 100 loans default within five years</b>;
     ${(p60.survival * 100).toFixed(1)} remain performing. ${shape}
     ${S.showRegimes ? 'The three series are the same profile under benign, through-cycle and crisis coefficients.' : ''}`;
}

/* ========================================================= waterfall */
function renderWaterfall() {
  const host = $('#fig-water'); C.clear(host);
  const L = M.loadings(profile(), S.regime);
  const items = [
    ['Business type', L.businesstype, S.businesstype],
    ['Industry', L.sector, S.sector],
    ['Programme', L.subprogram, S.subprogram],
    ['Collateral', L.collateral, S.collateral ? 'secured' : 'unsecured'],
    ['Loan size', L.size, S.size]
  ];
  const W = 420, rowH = 34, H = items.length * rowH + 34, m = { l: 108, r: 56 };
  const s = C.svg(W, H);
  const mx = Math.max(.75, ...items.map(i => Math.abs(i[1]))) * 1.12;
  const x = C.scale(-mx, mx, m.l, W - m.r), zero = x(0);

  s.appendChild(C.el('line', { x1: zero, x2: zero, y1: 8, y2: H - 26, stroke: COL.ink, 'stroke-width': 1 }));
  s.appendChild(C.el('text', { x: zero, y: H - 12, 'text-anchor': 'middle', class: 'axlab' }, 'no effect'));
  s.appendChild(C.el('text', { x: m.l, y: H - 12, 'text-anchor': 'start', class: 'axlab' }, 'safer'));
  s.appendChild(C.el('text', { x: W - m.r, y: H - 12, 'text-anchor': 'end', class: 'axlab' }, 'riskier'));

  items.forEach(([label, v, val], i) => {
    const yy = 12 + i * rowH, x0 = Math.min(zero, x(v)), w = Math.abs(x(v) - zero);
    s.appendChild(C.el('text', { x: m.l - 10, y: yy + 14, 'text-anchor': 'end', class: 'serieslab', fill: COL.ink }, label));
    const bar = C.el('rect', {
      x: x0, y: yy + 3, width: Math.max(w, v === 0 ? 0 : 1.5), height: 15, rx: 3,
      fill: v > 0 ? COL.ox : v < 0 ? COL.teal : COL.faint, opacity: v === 0 ? .35 : .88
    });
    C.hoverable(bar, `<b>${val}</b><br>multiplies the odds of default by ${Math.exp(v).toFixed(2)}×<br>
      <span style="color:#8FA5B0">log-odds ${v >= 0 ? '+' : ''}${v.toFixed(3)}</span>`);
    s.appendChild(bar);
    s.appendChild(C.el('text', {
      x: v >= 0 ? x(v) + 6 : x(v) - 6, y: yy + 15,
      'text-anchor': v >= 0 ? 'start' : 'end', class: 'serieslab', fill: COL.faint
    }, Math.exp(v).toFixed(2) + '×'));
  });
  host.appendChild(s);
}

/* ============================================================= swaps */
function renderSwaps() {
  const host = $('#fig-swaps');
  const p = profile();
  const base = M.pdAt(p, S.regime, 60);
  if (base == null) { host.innerHTML = '<p class="note">Not available for this profile.</p>'; return; }
  const baseEL = base * M.lgdFor(p, S.A.minDefaults).lgd;
  const sw = M.singleSwaps(p, S.regime);
  const best = sw.slice(0, 4), worst = sw.slice(-2).reverse();
  const label = { businesstype: 'Become', sector: 'Move into', subprogram: 'Borrow under', size: 'Borrow', collateral: 'Pledge' };
  const line = s => `<tr><td>${label[s.field] || 'Change to'} <b>${s.to}</b></td>
      <td style="text-align:right;color:${s.delta < 0 ? COL.teal : COL.ox}">
      ${s.delta < 0 ? '−' : '+'}${Math.abs(s.delta * 100).toFixed(1)} pts</td>
      <td style="text-align:right;color:var(--muted)">${(s.el * 100).toFixed(1)}%</td></tr>`;
  host.innerHTML = `<table>
    <tr><th>Attribute changed</th><th style="text-align:right">Effect</th><th style="text-align:right">New loss</th></tr>
    <tr class="hi"><td>Selected profile</td><td style="text-align:right">—</td>
        <td style="text-align:right"><b>${(baseEL * 100).toFixed(1)}%</b></td></tr>
    ${best.map(line).join('')}
    <tr><td colspan="3" style="border:0;height:8px"></td></tr>
    <tr><th colspan="3" style="border-bottom:0;padding-top:0">Largest increases</th></tr>
    ${worst.map(line).join('')}
  </table>`;
}

/* ========================================================= seasoning */
/* Monthly hazard on a single size band is noisy enough to hide the
   pattern, so the displayed rate is a centred 7-month mean. The
   cumulative series is built from the raw rates, not the smoothed ones.
   Nothing is dropped: once a band's at-risk pool falls below THIN loans
   the line keeps going but is drawn faintly, because a single default
   in a pool of a hundred is a spike, not a signal. */
const SMOOTH = 7, THIN = 5000;
function smooth(a, w) {
  const h = (w - 1) / 2;
  return a.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) { sum += a[j]; n++; }
    return sum / n;
  });
}

function seriesFor(era) {
  const e = M.D.seasoning.eras[era];
  return M.BANDS.map(b => {
    const raw = [];
    let surv = 1;
    for (let i = 0; i < e.month.length; i++) {
      const ar = e.at_risk[b][i], hz = e.hazard[b][i];
      if (ar == null || ar === 0) break;
      surv *= (1 - (hz || 0));
      raw.push({ month: e.month[i], hazard: hz || 0, cum: 1 - surv, at_risk: ar });
    }
    const sm = smooth(raw.map(p => p.hazard), SMOOTH);
    raw.forEach((p, i) => { p.hazard = sm[i]; });
    const cut = raw.findIndex(p => p.at_risk < THIN);
    return { band: b, pts: raw, solid: cut < 0 ? raw.length : cut };
  }).filter(s => s.pts.length > 4);
}

/* Push overlapping end-of-line labels apart so all five stay readable. */
function spread(ys, gap = 13) {
  const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(ys.length);
  let last = -Infinity;
  order.forEach(([y, i]) => { const v = Math.max(y, last + gap); out[i] = v; last = v; });
  return out;
}

function renderSeason() {
  const host = $('#fig-season'); C.clear(host);
  const W = 700, H = 350, m = { t: 14, r: 30, b: 46, l: 66 };
  const s = C.svg(W, H);
  const cur = seriesFor(S.era);
  const ghost = S.seaGhost && S.prevEra && S.prevEra !== S.era ? seriesFor(S.prevEra) : null;
  const key = S.seaMode === 'cum' ? 'cum' : 'hazard';
  const all = [...cur, ...(ghost || [])].flatMap(g => g.pts.map(p => p[key]));
  const top = Math.max(...all) * 1.1;
  const lastMonth = Math.max(...[...cur, ...(ghost || [])].flatMap(g => g.pts.map(p => p.month)));
  const x = C.scale(0, lastMonth, m.l, W - m.r), y = C.scale(0, top, H - m.b, m.t);
  const tickStep = lastMonth > 200 ? 60 : lastMonth > 120 ? 36 : 24;
  const xTicks = [];
  for (let v = 0; v <= lastMonth; v += 12) xTicks.push(v);

  C.axes(s, x, y, {
    xTicks,
    xFmt: v => v % tickStep ? '' : v / 12 + 'y',
    yFmt: v => (v * 100).toFixed(key === 'cum' ? 0 : 2) + '%',
    xLabel: 'age of the loan',
    yLabel: key === 'cum' ? 'defaulted so far' : 'defaulting this month'
  });

  if (S.seaPool) {
    const mxAr = Math.max(...cur.flatMap(g => g.pts.map(p => p.at_risk)));
    const y2 = C.scale(0, mxAr, H - m.b, m.t);
    cur.forEach(g => C.area(s, g.pts.map(p => [p.month, p.at_risk]), x, y2, 0,
      { fill: BAND_COL[g.band], opacity: .05 }));
    s.appendChild(C.el('text', { x: W - m.r + 6, y: m.t + 10, class: 'axlab' }, 'shaded: loans'));
    s.appendChild(C.el('text', { x: W - m.r + 6, y: m.t + 22, class: 'axlab' }, 'still at risk'));
  }

  if (ghost) ghost.forEach(g => C.line(s, g.pts.map(p => [p.month, p[key]]), x, y,
    { stroke: BAND_COL[g.band], 'stroke-width': 1, opacity: .22, 'stroke-dasharray': '3 3' }));

  // Label each band where its evidence runs out, not at the end of the faded
  // tail, where all five collapse on top of each other.
  const anchor = cur.map(g => g.pts[Math.max(0, g.solid - 1)]);
  const placed = spread(anchor.map(a => y(a[key])));
  cur.forEach((g, i) => {
    const pts = g.pts.map(p => [p.month, p[key]]);
    if (g.solid < pts.length)
      C.line(s, pts.slice(Math.max(0, g.solid - 1)), x, y,
        { stroke: BAND_COL[g.band], 'stroke-width': 1.2, opacity: .28 });
    C.line(s, pts.slice(0, g.solid), x, y, { stroke: BAND_COL[g.band], 'stroke-width': 1.9 });
    const a = anchor[i], ax = x(a.month), ay = y(a[key]);
    if (Math.abs(placed[i] - ay) > 2)
      s.appendChild(C.el('path', {
        d: `M${ax},${ay}L${ax + 5},${placed[i]}`, stroke: BAND_COL[g.band],
        'stroke-width': .8, fill: 'none', opacity: .6
      }));
    s.appendChild(C.el('text', { x: ax + 9, y: placed[i] + 4, fill: BAND_COL[g.band], class: 'serieslab' }, g.band));
    const hit = C.el('circle', { cx: ax, cy: ay, r: 3, fill: BAND_COL[g.band] });
    const p60 = g.pts.find(p => p.month === 60);
    C.hoverable(hit, `<b>${g.band}</b>${p60 ? `<br>${(p60.cum * 100).toFixed(1)}% defaulted by year five` : ''}<br>
      <span style="color:#8FA5B0">solid to year ${(a.month / 12).toFixed(0)}, then under 5,000 loans left</span>`);
    s.appendChild(hit);
  });

  // annotate where the whole-book curve stops climbing, from the data itself
  if (key === 'hazard') {
    const wb = M.D.seasoning.whole_book.filter(([mo, ar]) => ar >= 200000);
    const sm = smooth(wb.map(r => r[2] || 0), 13);
    let pk = 0;
    sm.forEach((v, i) => { if (v > sm[pk]) pk = i; });
    const pm = wb[pk][0], xx = x(pm);
    s.appendChild(C.el('line', { x1: xx, x2: xx, y1: m.t, y2: H - m.b, stroke: COL.faint, 'stroke-dasharray': '2 4' }));
    s.appendChild(C.el('text', { x: xx + 5, y: m.t + 11, class: 'axlab', fill: COL.faint },
      `whole book stops climbing ≈ year ${(pm / 12).toFixed(0)}`));
  }
  host.appendChild(s);

  // figures for the vintages actually on screen, not always the whole book
  const small = cur.find(g => g.band === '<50K'), big = cur.find(g => g.band === '1M+');
  const at = (g, mo) => { const p = g && g.pts.find(v => v.month === mo); return p ? p.cum : null; };
  const eraName = { all: 'every vintage in the book', pre_crisis: 'loans made in 2000&ndash;2004',
    cohort_2005_12: 'loans made in 2005&ndash;2012', post_crisis: 'loans made in 2013&ndash;2016' }[S.era];
  const gap = at(small, 60) != null && at(big, 60) != null
    ? `<b>By year five, ${(at(small, 60) * 100).toFixed(1)}% of the sub-$50K loans have defaulted
       against ${(at(big, 60) * 100).toFixed(1)}% of those over $1M</b>, a gap of
       ${(at(small, 60) / at(big, 60)).toFixed(0)} times.` : '';
  const vintage = ['pre_crisis', 'cohort_2005_12', 'post_crisis'].map(k => {
    const e = M.D.seasoning.eras[k];
    let s = 1, v = null;
    for (let i = 0; i < e.month.length; i++) {
      if (e.month[i] > 60) break;
      s *= (1 - (e.hazard['<50K'][i] || 0));
      if (e.month[i] === 60) v = 1 - s;
    }
    return v;
  });
  // where each band actually turns, measured from the data on screen
  const peaks = cur.map(g => {
    let pk = g.pts[0];
    g.pts.slice(0, g.solid).forEach(p => { if (p.hazard > pk.hazard) pk = p; });
    return { band: g.band, month: pk.month, rate: pk.hazard,
             y1: (g.pts.find(p => p.month === 12) || {}).hazard };
  });
  const sml = peaks.find(p => p.band === '<50K'), lrg = peaks.find(p => p.band === '1M+');
  const turn = key === 'hazard' && sml && lrg
    ? `The monthly rate on sub-$50K loans peaks in year ${(sml.month / 12).toFixed(0)} at
       ${(sml.rate * 100).toFixed(2)}%, about ${(sml.rate / (sml.y1 || 1)).toFixed(0)} times its
       first-anniversary level, and only then turns down. Loans over $1M do not peak until year
       ${(lrg.month / 12).toFixed(0)}.` : '';
  $('#cap-season').innerHTML =
    `Showing ${eraName}. ${gap} ${turn} Vintage matters as much as size: the same sub-$50K band runs
     ${(vintage[0] * 100).toFixed(1)}% over five years for the 2000&ndash;2004 loans,
     ${(vintage[1] * 100).toFixed(1)}% for 2005&ndash;2012 and ${(vintage[2] * 100).toFixed(1)}% for
     2013&ndash;2016, which is why the model carries separate coefficients for benign, average and
     crisis conditions rather than one. All months in the record are drawn, to
     ${(lastMonth / 12).toFixed(0)} years for these vintages. Each series fades where fewer than
     5,000 loans in that band remain at risk. Monthly rates are shown as a centred seven-month mean;
     cumulative rates use the unsmoothed series.
     ${S.seaGhost && S.prevEra && S.prevEra !== S.era ? 'The dashed lines are the vintages you were looking at before.' : ''}`;
}

/* ======================================================== validation */
function renderValid() {
  const host = $('#fig-valid'); C.clear(host);
  const rows = M.D.validation[S.valSet];
  const lastMonth = rows[rows.length - 1][0];
  const W = 700, H = 320, m = { t: 14, r: 96, b: 46, l: 66 };
  const s = C.svg(W, H);
  const top = Math.max(...rows.flatMap(r => [r[4], r[5]])) * 1.12;
  const x = C.scale(0, lastMonth, m.l, W - m.r), y = C.scale(0, top, H - m.b, m.t);
  const xTicks = [];
  for (let v = 0; v <= lastMonth; v += 12) xTicks.push(v);

  C.axes(s, x, y, {
    xTicks,
    xFmt: v => v % 36 ? '' : v / 12 + 'y',
    yFmt: v => (v * 100).toFixed(2) + '%',
    xLabel: 'age of the loan', yLabel: 'defaulting that month'
  });

  const pred = rows.map(r => [r[0], r[5]]);
  C.line(s, pred, x, y, { stroke: COL.steel, 'stroke-width': 2.1 });
  const lp = pred[pred.length - 1];
  s.appendChild(C.el('text', { x: x(lp[0]) + 6, y: y(lp[1]) + 4, fill: COL.steel, class: 'serieslab' }, 'model'));

  if (S.valHidden) {
    s.appendChild(C.el('text', {
      x: (m.l + W - m.r) / 2, y: m.t + 26, 'text-anchor': 'middle', class: 'axlab', fill: COL.gold
    }, 'Where do you think the real defaults fall?'));
  } else {
    const act = rows.map(r => [r[0], r[4]]);
    const ln = C.line(s, act, x, y, { stroke: COL.ox, 'stroke-width': 2.1, 'stroke-dasharray': '5 3' });
    C.reveal(ln, 1100);
    const la = act[act.length - 1];
    s.appendChild(C.el('text', { x: x(la[0]) + 6, y: y(la[1]) + 4, fill: COL.ox, class: 'serieslab' }, 'actual'));
    rows.forEach(r => {
      const d = C.el('circle', { cx: x(r[0]), cy: y(r[4]), r: 2.6, fill: COL.ox, opacity: .8 });
      C.hoverable(d, `<b>month ${r[0]}</b><br>actual ${(r[4] * 100).toFixed(3)}%<br>
        model ${(r[5] * 100).toFixed(3)}%<br><span style="color:#8FA5B0">${M.fmtNum(r[1])} loans at risk</span>`);
      s.appendChild(d);
    });
  }
  host.appendChild(s);

  // The model's age table is estimated to ten years, which is the window the
  // workbook scores. The chart shows every month the validation record holds.
  const FITTED = 120;
  const inR = rows.filter(r => r[0] <= FITTED);
  const r2 = rsq(inR.map(r => r[4]), inR.map(r => r[5]));
  const sl = slope(inR.map(r => r[4]), inR.map(r => r[5]));
  const r2all = rsq(rows.map(r => r[4]), rows.map(r => r[5]));
  const ad = inR.reduce((a, r) => a + r[2], 0), pdd = inR.reduce((a, r) => a + r[3], 0);

  // where the fit is worst, measured rather than asserted
  const worst = inR.reduce((a, r) => Math.abs(r[5] - r[4]) > Math.abs(a[5] - a[4]) ? r : a, inR[1]);
  const late = rows.filter(r => r[0] > FITTED);
  const high = late.filter(r => r[5] > r[4]).length;
  const lean = high > late.length * .6 ? 'runs high' : high < late.length * .4 ? 'runs low' : 'wanders either side';

  $('#val-title').textContent = S.valSet === 'holdout'
    ? 'Loans the model has never seen' : 'Loans the model was fitted on';
  $('#cap-valid').innerHTML = S.valHidden
    ? 'The model line is drawn. Decide where you think the observed defaults sit, then reveal.'
    : `On ${S.valSet === 'holdout' ? 'loans held out of fitting entirely' : 'the training sample'},
       <b>R² ${r2.toFixed(3)}</b> with a slope of ${sl.toFixed(3)}, where 1.000 would mean the model
       is neither systematically cautious nor systematically loose. It predicted
       <b>${M.fmtNum(Math.round(pdd))} defaults against ${M.fmtNum(ad)} that happened</b>, a miss of
       ${((pdd / ad - 1) * 100).toFixed(1)}%. These figures cover months 0 to 120, the range over
       which the age effect is estimated. Largest single-month error in that range is month
       ${worst[0]}, at ${Math.abs((worst[5] - worst[4]) * 100).toFixed(3)} percentage points
       ${worst[5] > worst[4] ? 'above' : 'below'} observed. Beyond month 120 the model extrapolates;
       it ${lean} on ${high} of ${late.length} readings, and R² over the full
       ${(lastMonth / 12).toFixed(0)}-year span is ${r2all.toFixed(3)}.`;
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function rsq(a, b) {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return (num / Math.sqrt(da * db)) ** 2;
}
function slope(a, b) { // actual on predicted
  const ma = mean(a), mb = mean(b);
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) { num += (b[i] - mb) * (a[i] - ma); den += (b[i] - mb) ** 2; }
  return num / den;
}

function renderErrors() {
  const host = $('#fig-errors'); C.clear(host);
  const segs = M.D.validation.segments.filter(s => s.actual_defaults >= 100);
  const W = 700, H = 150, m = { t: 26, r: 24, b: 42, l: 24 };
  const s = C.svg(W, H);
  const errs = segs.map(g => g.predicted - g.actual);
  const mx = Math.max(...errs.map(Math.abs)) * 1.15;
  const x = C.scale(-mx, mx, m.l, W - m.r), mid = H / 2 - 4;

  s.appendChild(C.el('line', { x1: m.l, x2: W - m.r, y1: mid, y2: mid, stroke: COL.rule }));
  [-mx, -mx / 2, 0, mx / 2, mx].forEach(v => {
    s.appendChild(C.el('line', { x1: x(v), x2: x(v), y1: mid - 34, y2: mid + 34, stroke: v === 0 ? COL.ink : COL.rule, 'stroke-width': v === 0 ? 1.2 : 1 }));
    s.appendChild(C.el('text', { x: x(v), y: H - 20, 'text-anchor': 'middle', class: 'axis' , fill: COL.faint,
      'font-family': 'IBM Plex Sans', 'font-size': 10.5 }, (v * 100).toFixed(2)));
  });
  s.appendChild(C.el('text', { x: m.l, y: 14, class: 'axlab' }, 'model charged too little'));
  s.appendChild(C.el('text', { x: W - m.r, y: 14, 'text-anchor': 'end', class: 'axlab' }, 'model charged too much'));
  s.appendChild(C.el('text', { x: (m.l + W - m.r) / 2, y: H - 5, 'text-anchor': 'middle', class: 'axlab' }, 'error, percentage points of monthly default rate'));

  const seen = new Map();
  segs.forEach(g => {
    const e = g.predicted - g.actual, xx = x(e);
    const k = Math.round(xx / 7);
    const n = seen.get(k) || 0; seen.set(k, n + 1);
    const yy = mid + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 8;
    const isMine = g.size === S.size && g.sector === S.sector;
    const d = C.el('circle', {
      cx: xx, cy: yy, r: isMine ? 6 : 4,
      fill: isMine ? COL.gold : Math.abs(e) > .0005 ? COL.ox : COL.teal,
      opacity: isMine ? 1 : .55, stroke: isMine ? COL.ink : 'none', 'stroke-width': 1.3
    });
    C.hoverable(d, `<b>${g.size} · ${g.sector}</b><br>actual ${(g.actual * 100).toFixed(3)}%<br>
      model ${(g.predicted * 100).toFixed(3)}%<br>
      <span style="color:#8FA5B0">${M.fmtNum(g.actual_defaults)} defaults observed</span>`);
    s.appendChild(d);
  });
  host.appendChild(s);
  const me = mean(errs);
  host.insertAdjacentHTML('beforeend',
    `<p class="note" style="margin-top:10px">${segs.length} segments carry 100 or more defaults.
     Mean error <b>${(me * 100).toFixed(4)} percentage points</b>, with a maximum absolute error of
     ${(Math.max(...errs.map(Math.abs)) * 100).toFixed(2)}. Segments the model fits poorly are shown
     alongside those it fits well. The gold marker, where present, indicates the selected segment.</p>`);
}

/* =========================================================== scatter */
function requiredRate(r, useGuarantee) {
  return M.requiredRate(r, useGuarantee ? (r[M.D.ix.guarantee] ?? .75) : 0, S.A);
}

function renderScatter() {
  const host = $('#fig-scatter'); C.clear(host);
  const ix = M.D.ix;
  const rows = M.D.scorecard.rows.filter(r =>
    r[ix.rate] != null && (!S.scThin || r[ix.loans] >= S.A.minLoans));
  const W = 700, H = 430, m = { t: 16, r: 20, b: 48, l: 66 };
  const s = C.svg(W, H);
  const lim = .16;
  const x = C.scale(0, lim, m.l, W - m.r), y = C.scale(0, lim, H - m.b, m.t);

  C.axes(s, x, y, {
    yTicks: [0, .04, .08, .12, .16], xTicks: [0, .04, .08, .12, .16],
    yFmt: v => (v * 100).toFixed(0) + '%', xFmt: v => (v * 100).toFixed(0) + '%', xGrid: true,
    xLabel: `rate the loan needs to break even${S.scGuar ? ', with the SBA guarantee' : ', with no guarantee'}`,
    yLabel: 'rate lenders actually charged'
  });
  s.appendChild(C.el('line', { x1: x(0), y1: y(0), x2: x(lim), y2: y(lim), stroke: COL.ink, 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }));
  s.appendChild(C.el('text', { x: x(.138), y: y(.121), fill: COL.faint, class: 'serieslab', 'text-anchor': 'end' }, 'break even'));
  s.appendChild(C.el('text', { x: x(.012), y: y(.145), fill: COL.teal, class: 'serieslab' }, 'lender makes money'));
  s.appendChild(C.el('text', { x: x(.088), y: y(.012), fill: COL.ox, class: 'serieslab' }, 'lender loses money'));

  const meKey = M.keyOf(profile());
  let ok = 0, needs = 0;
  rows.forEach(r => {
    const req = requiredRate(r, S.scGuar), rate = r[ix.rate];
    const good = rate > req;
    if (good) ok++;
    const needsG = !good && rate > requiredRate(r, true);
    if (needsG) needs++;
    const mine = M.keyOf({ businesstype: r[ix.businesstype], sector: r[ix.sector], subprogram: r[ix.subprogram], collateral: r[ix.collateral], size: r[ix.size] }) === meKey;
    const hl = S.scUnder && needsG;
    const d = C.el('circle', {
      cx: x(Math.min(req, lim)), cy: y(Math.min(rate, lim)),
      r: mine ? 7 : Math.max(2, Math.min(7, Math.sqrt(r[ix.loans]) / 14)),
      fill: mine ? COL.gold : hl ? COL.gold : good ? COL.teal : COL.ox,
      opacity: mine ? 1 : S.scUnder && !hl ? .12 : .42,
      stroke: mine ? COL.ink : 'none', 'stroke-width': 1.5
    });
    C.hoverable(d, `<b>${r[ix.size]} · ${r[ix.sector]}</b><br>${r[ix.businesstype].toLowerCase()},
      ${r[ix.collateral] ? 'secured' : 'unsecured'}, ${r[ix.subprogram]}<br>
      charged ${(rate * 100).toFixed(2)}% · needs ${(req * 100).toFixed(2)}%<br>
      <span style="color:${good ? '#7FCFC7' : '#E8A0A6'}">${good ? 'clears' : 'short'} by
      ${Math.abs(rate - req) * 100 < .01 ? '<0.01' : (Math.abs(rate - req) * 100).toFixed(2)} pts</span><br>
      <span style="color:#8FA5B0">${M.fmtNum(r[ix.loans])} loans</span>`);
    s.appendChild(d);
  });
  host.appendChild(s);
  $('#cap-scatter').innerHTML =
    `${M.fmtNum(rows.length)} profiles have both a model price and an observed rate.
     <b>${M.fmtNum(ok)} of them clear their own cost${S.scGuar ? ' once the guarantee is applied' : ' with no government support at all'}</b>.
     Marker size is the number of loans in the profile. A further <b>${M.fmtNum(needs)}</b> clear only
     once the guarantee is applied.
     ${S.scThin
        ? 'Only profiles with 100 or more loans are shown; removing the filter roughly triples the sample, most of it one or two loans deep.'
        : 'The loan-count filter is off, so much of this sample rests on very few loans.'}`;
}

/* =============================================================== LGD */
function renderLGD() {
  const host = $('#fig-lgd'); C.clear(host);
  const cells = M.D.lgd.cells;
  const sectors = [...new Set(cells.map(c => c.sector))];
  const avg = {};
  sectors.forEach(sec => {
    const rs = cells.filter(c => c.sector === sec && c.defaults >= S.A.minDefaults);
    avg[sec] = rs.length ? rs.reduce((a, c) => a + c.charge_off, 0) / rs.reduce((a, c) => a + c.approval, 0) : 0;
  });
  sectors.sort((a, b) => avg[b] - avg[a]);

  const cw = 74, ch = 30, m = { l: 176, t: 42 };
  const W = m.l + cw * M.BANDS.length + 60, H = m.t + ch * sectors.length + 18;
  const s = C.svg(W, H);
  const lo = .5, hi = .9;

  M.BANDS.forEach((b, i) => s.appendChild(C.el('text', {
    x: m.l + i * cw + cw / 2, y: m.t - 12, 'text-anchor': 'middle', class: 'serieslab', fill: COL.ink
  }, b)));
  s.appendChild(C.el('text', { x: m.l - 10, y: m.t - 12, 'text-anchor': 'end', class: 'axlab' },
    '% of principal'));

  sectors.forEach((sec, r) => {
    const yy = m.t + r * ch;
    s.appendChild(C.el('text', { x: m.l - 10, y: yy + 20, 'text-anchor': 'end', class: 'serieslab',
      fill: sec === S.sector ? COL.ink : '#5B6C77', 'font-weight': sec === S.sector ? 600 : 400 }, sec));
    M.BANDS.forEach((b, i) => {
      const c = cells.find(z => z.sector === sec && z.size === b);
      const g = C.el('g');
      const thin = !c || c.defaults < S.A.minDefaults;
      const v = c ? c.lgd : null;
      const rect = C.el('rect', {
        x: m.l + i * cw + 1.5, y: yy + 2, width: cw - 3, height: ch - 4, rx: 5,
        fill: v == null ? '#EEF1F2' : C.ramp((v - lo) / (hi - lo)),
        opacity: thin && S.lgdThin ? .22 : 1,
        stroke: (sec === S.sector && b === S.size) ? COL.ink : 'none', 'stroke-width': 2
      });
      g.appendChild(rect);
      if (v != null) g.appendChild(C.el('text', {
        x: m.l + i * cw + cw / 2, y: yy + 20, 'text-anchor': 'middle',
        class: 'serieslab', fill: thin && S.lgdThin ? '#5B6C77' : '#fff'
      }, (v * 100).toFixed(0) + '%'));
      if (c) C.hoverable(g, `<b>${b} · ${sec}</b><br>${(c.lgd * 100).toFixed(1)}% of principal lost<br>
        ${M.fmtNum(c.defaults)} defaults, ${M.fmtUSD(c.charge_off)} charged off
        ${thin ? '<br><span style="color:#E8CE94">under 100 defaults, so the model uses the size-band average instead</span>' : ''}`);
      s.appendChild(g);
    });
  });
  host.appendChild(s);

  const fb = M.D.lgd.fallback;
  const ix = M.D.ix;
  const secShare = b => {
    let sec = 0, tot = 0;
    M.D.scorecard.rows.forEach(r => {
      if (r[ix.size] !== b) return;
      tot += r[ix.loans]; if (r[ix.collateral]) sec += r[ix.loans];
    });
    return tot ? sec / tot : null;
  };
  $('#cap-lgd').innerHTML =
    `Each cell is the percentage of the original loan amount written off, averaged over the loans in
     that cell that defaulted. Darker is worse. Reading across, the gradient runs left to right in
     almost every industry:
     <b>a defaulted loan under $50K loses ${(fb['<50K'] * 100).toFixed(0)}% of principal, while one
     over $1M loses ${(fb['1M+'] * 100).toFixed(0)}%.</b> One measurable reason sits in the same data:
     only ${(secShare('<50K') * 100).toFixed(0)}% of sub-$50K loans are secured at all, against
     ${(secShare('1M+') * 100).toFixed(0)}% of loans over $1M are secured. The spread is
     ${((fb['<50K'] - fb['1M+']) * 100).toFixed(0)} percentage points of severity, in addition to the
     difference in default probability. Faded cells rest on fewer than 100 observed defaults and use
     the size-band average, which is why those rows read identically across industries.`;
}

function renderDriver() {
  const host = $('#fig-driver'); C.clear(host);
  
  const d = M.D.lgd.drivers;
  const items = [['Collateral pledged', d.collateral], ['Industry', d.sector], ['Loan size', d.size_band]]
    .filter(x => x[1] && x[1].range != null);
  const W = 620, rowH = 46, H = items.length * rowH + 30, m = { l: 156, r: 70 };
  const s = C.svg(W, H);
  const mx = Math.max(...items.map(i => i[1].range)) * 1.1;
  const x = C.scale(0, mx, m.l, W - m.r);
  items.sort((a, b) => a[1].range - b[1].range).forEach(([label, dd], i) => {
    const yy = 14 + i * rowH;
    s.appendChild(C.el('text', { x: m.l - 12, y: yy + 20, 'text-anchor': 'end', class: 'serieslab', fill: COL.ink }, label));
    s.appendChild(C.el('rect', {
      x: m.l, y: yy + 6, width: Math.max(x(dd.range) - m.l, 2), height: 20,
      rx: 4, fill: dd.range < .01 ? COL.faint : COL.ox, opacity: .9
    }));
    s.appendChild(C.el('text', {
      x: Math.max(x(dd.range), m.l + 4) + 8, y: yy + 21, class: 'serieslab', fill: COL.muted || '#5B6C77'
    }, (dd.range * 100).toFixed(dd.range < .01 ? 3 : 1) + ' pts'));
  });
  s.appendChild(C.el('text', { x: m.l, y: H - 4, class: 'axlab' }, 'spread between best and worst category, in percentage points of loss severity'));
  host.appendChild(s);
  $('#cap-driver').innerHTML =
    `<b>Collateral moves loss severity by ${(d.collateral.range * 100).toFixed(3)} percentage points.
     Industry moves it by ${(d.sector.range * 100).toFixed(1)} and loan size by
     ${(d.size_band.range * 100).toFixed(1)}.</b> Secured loans lose
     ${(d.collateral.rows.find(r => /true/i.test(r.label))?.lgd * 100).toFixed(1)}% of principal on
     default against ${(d.collateral.rows.find(r => /false/i.test(r.label))?.lgd * 100).toFixed(1)}%
     for unsecured, a difference within the range of noise. Collateral is conventionally the first item examined in credit assessment, yet in this record it
     carries no measurable information about severity. Severity is therefore keyed off size and
     industry. Collateral is retained in the default probability, where its coefficient remains
     material.`;
}

/* ========================================================= cost stack */
function renderStack() {
  const host = $('#fig-stack'); C.clear(host);
  const p = profile(), r = M.row(p), ix = M.D.ix;
  const pd60 = M.pdAt(p, S.regime, 60);
  if (pd60 == null || !r) { host.innerHTML = '<p class="note">No priced record for this profile.</p>'; $('#cap-stack').textContent = ''; return; }
  const pdH = M.pdAt(p, S.regime, S.A.horizon * 12);
  const el5 = (pdH == null ? pd60 : pdH) * M.lgdFor(p, S.A.minDefaults).lgd;
  const rate = r[ix.rate];
  const opts = {
    funding: M.D.costs.funding[S.A.fund],
    origination: M.D.costs.origination[S.size] * S.A.origMult,
    el5, capitalCharge: M.D.costs.capital_charge[S.A.capital],
    avgLoan: r.avgLoan, rate, A: S.A
  };
  const g = M.guaranteeFor(p);
  const withG = M.costStack(p, { ...opts, guarantee: g });
  const noG = M.costStack(p, { ...opts, guarantee: 0 });
  const need = rate == null ? null : M.guaranteeNeeded(p, opts);

  const parts = [
    ['funding', COL.steel], ['servicing', '#7A8C97'], ['origination', '#A9B6BE'],
    ['capital', COL.gold], ['expectedLoss', COL.ox]
  ];
  const names = { funding: 'Funding', servicing: 'Servicing', origination: 'Origination', capital: 'Capital', expectedLoss: 'Expected loss' };
  const W = 700, H = 210, m = { l: 128, r: 24, t: 24 };
  const s = C.svg(W, H);
  const mx = Math.max(noG.required, rate || 0) * 1.12;
  const x = C.scale(0, mx, m.l, W - m.r);

  [['With no guarantee', noG, 34], [`With the ${(g * 100).toFixed(0)}% SBA guarantee`, withG, 92]].forEach(([lab, st, yy]) => {
    s.appendChild(C.el('text', { x: m.l - 12, y: yy + 20, 'text-anchor': 'end', class: 'serieslab', fill: COL.ink }, lab));
    let acc = 0;
    parts.forEach(([k, col]) => {
      const w = x(st[k]) - x(0);
      if (w <= .3) { acc += st[k]; return; }
      const rect = C.el('rect', { x: x(acc), y: yy + 4, width: w, height: 26, rx: 3, fill: col });
      C.hoverable(rect, `<b>${names[k]}</b><br>${(st[k] * 100).toFixed(2)}% a year`);
      s.appendChild(rect);
      if (w > 42) s.appendChild(C.el('text', {
        x: x(acc) + w / 2, y: yy + 21, 'text-anchor': 'middle', class: 'serieslab', fill: '#fff'
      }, (st[k] * 100).toFixed(1)));
      acc += st[k];
    });
    s.appendChild(C.el('text', { x: x(st.required) + 7, y: yy + 22, class: 'serieslab', fill: COL.ink }, (st.required * 100).toFixed(2) + '%'));
  });

  if (rate != null) {
    const xr = x(rate);
    s.appendChild(C.el('line', { x1: xr, x2: xr, y1: 20, y2: 148, stroke: COL.teal, 'stroke-width': 2 }));
    s.appendChild(C.el('text', { x: xr, y: 14, 'text-anchor': 'middle', class: 'serieslab', fill: COL.teal },
      `charged ${(rate * 100).toFixed(2)}%`));
  }
  parts.forEach(([k, col], i) => {
    const xx = m.l + i * 112;
    s.appendChild(C.el('rect', { x: xx, y: H - 26, width: 10, height: 10, rx: 2.5, fill: col }));
    s.appendChild(C.el('text', { x: xx + 15, y: H - 17, class: 'axlab' }, names[k]));
  });
  host.appendChild(s);

  const verdict = rate == null ? null : withG.spread > 0;
  $('#gs-title').textContent = 'Cost of this loan, against what lenders charged it';
  $('#cap-stack').innerHTML = rate == null
    ? `No interest rate is recorded for this profile, so it cannot be compared against cost.
       Rates appear in the SBA data only from FY2009.`
    : `Lenders charged this borrower <b>${(rate * 100).toFixed(2)}%</b>. Standing alone the loan
       needs ${(noG.required * 100).toFixed(2)}% to break even, so unaided it
       ${noG.spread > 0 ? `clears by ${(noG.spread * 100).toFixed(2)} points` : `falls short by ${(-noG.spread * 100).toFixed(2)} points`}.
       With the guarantee it needs ${(withG.required * 100).toFixed(2)}% and
       ${verdict ? `clears by ${(withG.spread * 100).toFixed(2)} points` : `still falls short by ${(-withG.spread * 100).toFixed(2)} points`}.
       <b>${need === null ? 'No guarantee up to 100% covers cost at these assumptions.'
            : need === 0 ? 'Minimum required guarantee: zero.'
            : `Minimum required guarantee: ${(need * 100).toFixed(0)}%.`}</b>
       Expected loss is annualised over five years; all other costs are annual.`;
}

/* ============================================================ policy */
function renderPolicy() {
  const host = $('#fig-policy'); C.clear(host);
  const ix = M.D.ix, c = M.D.costs;
  const rows = M.D.scorecard.rows.filter(r => r[ix.rate] != null && r[ix.loans] >= S.A.minLoans);
  const curve = [];
  for (let gi = 0; gi <= 90; gi += 5) {
    const g = gi / 100;
    let n = 0, dollars = 0;
    rows.forEach(r => {
      if (r[ix.rate] > M.requiredRate(r, g, S.A)) { n++; dollars += r[ix.dollars]; }
    });
    curve.push({ g: gi, n, dollars });
  }
  const W = 700, H = 300, m = { t: 18, r: 24, b: 48, l: 70 };
  const s = C.svg(W, H);
  const x = C.scale(0, 90, m.l, W - m.r), y = C.scale(0, rows.length, H - m.b, m.t);
  C.axes(s, x, y, {
    xTicks: [0, 15, 30, 45, 60, 75, 90], xFmt: v => v + '%',
    yFmt: v => v.toFixed(0), xLabel: 'share of the loss the SBA absorbs',
    yLabel: 'profiles a lender can serve'
  });
  C.area(s, curve.map(d => [d.g, d.n]), x, y, 0, { fill: COL.teal, opacity: .12 });
  C.line(s, curve.map(d => [d.g, d.n]), x, y, { stroke: COL.teal, 'stroke-width': 2.2 });
  curve.forEach(d => {
    const dot = C.el('circle', { cx: x(d.g), cy: y(d.n), r: d.g === S.policyG ? 6 : 3, fill: d.g === S.policyG ? COL.gold : COL.teal, stroke: d.g === S.policyG ? COL.ink : 'none', 'stroke-width': 1.4 });
    C.hoverable(dot, `<b>${d.g}% guarantee</b><br>${d.n} of ${rows.length} profiles clear<br>
      <span style="color:#8FA5B0">$${(d.dollars / 1e9).toFixed(1)}bn lent</span>`);
    s.appendChild(dot);
  });
  const cur = curve.find(d => d.g === S.policyG), zero = curve[0], top = curve[curve.length - 1];
  s.appendChild(C.el('line', { x1: x(S.policyG), x2: x(S.policyG), y1: y(cur.n), y2: H - m.b, stroke: COL.gold, 'stroke-dasharray': '3 3' }));
  host.appendChild(s);

  // describe the shape the curve actually has, rather than assuming one
  const gains = curve.slice(1).map((d, i) => ({ at: d.g, gain: d.n - curve[i].n }));
  const bestStep = gains.reduce((a, b) => b.gain > a.gain ? b : a);
  const firstHalf = gains.filter(g => g.at <= 45).reduce((a, g) => a + g.gain, 0);
  const secondHalf = gains.filter(g => g.at > 45).reduce((a, g) => a + g.gain, 0);
  $('#cap-policy').innerHTML =
    `Only profiles with 100 or more loans and an observed rate are counted, ${M.fmtNum(rows.length)} of them.
     <b>With no guarantee, ${zero.n} clear on commercial terms. At ${S.policyG}% the figure is ${cur.n},
     and at 90% it is ${top.n}.</b> Returns diminish across the range: the first 45 points of
     guarantee add ${firstHalf} profiles, the next 45 add ${secondHalf}, and the largest single
     increment is the step to ${bestStep.at}%, adding ${bestStep.gain}. Above the midpoint the guarantee
     principally deepens coverage on loans that already clear rather than extending access to new
     borrowers. Whether that additional coverage is warranted is a separate question, and one this
     chart does not address.`;
}

/* ============================================================ limits */
function renderLimits() {
  const r = M.row(profile());
  const hasRate = r && r[M.D.ix.rate] != null;
  $$('.limits li').forEach(li => li.classList.remove('live'));
  if (!hasRate) $('#lim-rate').classList.add('live');
  if (S.size === '<50K') $('#lim-bal').classList.add('live');
}


/* ====================================================== three-way split */
function renderSplit() {
  const host = $('#fig-split'); if (!host) return;
  const ix = M.D.ix, c = M.D.costs;
  const rows = M.D.scorecard.rows.filter(r => r[ix.rate] != null && r[ix.loans] >= S.A.minLoans);
  const req = (r, g) => M.requiredRate(r, g, S.A);
  const gOf = r => r[ix.guarantee] ?? .75;
  const alone = rows.filter(r => r[ix.rate] > req(r, 0));
  const needs = rows.filter(r => r[ix.rate] <= req(r, 0) && r[ix.rate] > req(r, gOf(r)));
  const never = rows.filter(r => r[ix.rate] <= req(r, gOf(r)));
  const D = a => a.reduce((x, r) => x + r[ix.dollars], 0);
  const L = a => a.reduce((x, r) => x + r[ix.loans], 0);
  const tD = D(rows), tL = L(rows);
  // mirror the split into the rail, right under the assumption controls
  const set = (id, v) => { const n = $(id); if (n) n.textContent = v; };
  set('#l-tot', M.fmtNum(rows.length));
  set('#l-a', alone.length); set('#l-b', needs.length); set('#l-c', never.length);
  [['#l-ba', alone], ['#l-bb', needs], ['#l-bc', never]].forEach(([id, a]) => {
    const n = $(id); if (n) n.style.width = (100 * a.length / (rows.length || 1)) + '%';
  });

  const line = (label, a, cls) => `<tr>
      <td><span class="pill ${cls}">${label}</span></td>
      <td style="text-align:right"><b>${a.length}</b></td>
      <td style="text-align:right">${(100 * L(a) / tL).toFixed(1)}%</td>
      <td style="text-align:right">${(100 * D(a) / tD).toFixed(1)}%</td></tr>`;
  host.innerHTML = `
    <table>
      <tr><th>Of ${M.fmtNum(rows.length)} priceable profiles</th>
          <th style="text-align:right">Profiles</th>
          <th style="text-align:right">Share of loans</th>
          <th style="text-align:right">Share of dollars</th></tr>
      ${line('Clear unaided', alone, 'ok')}
      ${line('Need the guarantee', needs, 'thin')}
      ${line('Never clear', never, 'no')}
    </table>
    <p class="figcap">This is the result toward which the preceding sections build.
      <b>${needs.length} profiles clear only because the guarantee exists.</b> They are
      ${(100 * L(needs) / tL).toFixed(0)}% of all loans and ${(100 * D(needs) / tD).toFixed(1)}% of
      all dollars. Its effect therefore falls on a large number of very small borrowers:
      ${needs.filter(r => r[ix.size] === '<50K' || r[ix.size] === '50-150K').length} of the
      ${needs.length} are loans under $150,000. A further ${never.length} profiles do not clear even
      at their full guarantee.</p>`;
}


/* Keep the panel's readouts in step, and show when anything is off default. */
function syncAssumptions() {
  const A = S.A, o = M.DEFAULTS;
  $('#o-serv').textContent = (A.servicing * 100).toFixed(1) + '%';
  $('#o-orig').textContent = '\u00d7' + A.origMult;
  $('#o-min').textContent = A.minLoans;
  const bands = M.BANDS.map(b => M.fmtUSD(M.D.costs.origination[b] * A.origMult));
  $('#a-orig-note').textContent =
    `${bands[0]} on loans under $350K, ${bands[3]} on $350K\u20131M, ${bands[4]} above.`;
  const changed = Object.keys(o).filter(k => A[k] !== o[k]);
  $('#a-reset').hidden = changed.length === 0;
  const h = document.querySelector('.assump-head h4');
  h.innerHTML = 'Values used' + (changed.length
    ? `<span class="badge">${changed.length} changed</span>` : '');
}
