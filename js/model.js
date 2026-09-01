/* ------------------------------------------------------------------
   model.js — the credit model, ported from the workbook.

   PD is a discrete-time hazard model. The workbook stores an age
   effect every 3 months and a coefficient per borrower attribute.

   HORIZON RULE (verified against the workbook to 4 decimal places):
     cumulative default by month H
       = 1 - product over a = 0,3,6,...,H of (1 - hazard(a))^3
   The age effect on each row applies to the quarter ENDING at that
   month. Month 0 carries a near-zero effect and acts as a seed row.
   ------------------------------------------------------------------ */

export const BANDS = ['<50K', '50-150K', '150-350K', '350K-1M', '1M+'];
export const REGIMES = ['benign', 'through-cycle', 'crisis'];

export const D = {};       // filled by load()

export async function load() {
  const names = ['model', 'costs', 'scorecard', 'regimes', 'seasoning', 'validation', 'lgd'];
  const got = await Promise.all(
    names.map(n => fetch(`data/${n}.json`).then(r => {
      if (!r.ok) throw new Error(`could not load data/${n}.json`);
      return r.json();
    }))
  );
  names.forEach((n, i) => { D[n] = got[i]; });

  // index the scorecard by key and precompute expected loss
  const f = D.scorecard.fields, ix = {};
  f.forEach((name, i) => { ix[name] = i; });
  D.ix = ix;
  D.byKey = new Map();
  D.scorecard.rows.forEach(r => {
    r.el5 = (r[ix.pd60] || 0) * (r[ix.lgd] || 0);
    r.avgLoan = r[ix.loans] ? r[ix.dollars] / r[ix.loans] : null;
    D.byKey.set(keyOf({
      businesstype: r[ix.businesstype], sector: r[ix.sector],
      subprogram: r[ix.subprogram], collateral: r[ix.collateral], size: r[ix.size]
    }), r);
  });

  // sorted expected loss, for percentile ranking
  D.elSorted = D.scorecard.rows.map(r => r.el5).sort((a, b) => a - b);

  // distinct attribute values, in the order they should appear
  D.levels = {
    businesstype: uniq('businesstype'),
    sector: uniq('sector'),
    subprogram: uniq('subprogram'),
    size: BANDS.slice()
  };

  // LGD lookup: "size|sector"
  D.lgdMap = new Map();
  D.lgd.cells.forEach(c => D.lgdMap.set(`${c.size}|${c.sector}`.toUpperCase(), c));
  return D;
}

function uniq(field) {
  const i = D.ix[field];
  return [...new Set(D.scorecard.rows.map(r => r[i]))].sort();
}

/* Keys are normalised to upper case on purpose. The workbook relies on
   Excel's case-insensitive MATCH and mixes FALSE/False and crisis/Crisis;
   JavaScript would silently fail to match. */
export function keyOf(p) {
  return [p.businesstype, p.sector, p.subprogram,
          p.collateral ? 'TRUE' : 'FALSE', p.size].join('|').toUpperCase();
}

export function row(p) { return D.byKey.get(keyOf(p)) || null; }

const logistic = x => 1 / (1 + Math.exp(-x));

/* Sum of attribute coefficients, relative to the reference borrower. */
export function loadings(p, regime) {
  const c = D.model.coef, g = k => c[`${regime}|${k}`] ?? 0;
  return {
    businesstype: g(`businesstype|${p.businesstype}`),
    sector: g(`sector|${p.sector}`),
    subprogram: g(`subprogram|${p.subprogram}`),
    collateral: g(`collateralind|${p.collateral ? 'True' : 'False'}`),
    size: g(`size_band|${p.size}`)
  };
}

/* The macro terms only apply under through-cycle. Under benign and
   crisis the regime's own intercept already carries the cycle, so
   adding them would double count. */
export function macroTerm(p, regime) {
  if (regime !== 'through-cycle') return 0;
  const m = D.model.macro;
  return m.unemployment * p.unemployment + m.prime * p.prime + m.hpi * p.hpi;
}

/* Full survival path: [{month, hazard, survival, cumDefault}] */
export function survivalPath(p, regime) {
  const c = D.model.coef, a = D.model.age;
  const intercept = c[`${regime}|INTERCEPT`];
  if (intercept === undefined) return null;
  const lp = Object.values(loadings(p, regime)).reduce((s, x) => s + x, 0);
  const macro = macroTerm(p, regime);
  const out = [];
  let surv = 1;
  for (let m = 0; m <= 120; m += 3) {
    const eff = a[`${regime}|${m}`];
    if (eff === undefined) break;
    const h = logistic(intercept + eff + lp + macro);
    surv *= Math.pow(1 - h, 3);
    out.push({ month: m, hazard: h, survival: surv, cum: 1 - surv });
  }
  return out;
}

export function pdAt(p, regime, months) {
  const path = survivalPath(p, regime);
  if (!path) return null;
  const hit = path.find(x => x.month === months);
  return hit ? hit.cum : null;
}

/* Loss given default: size|sector, falling back to the size-band average
   when the cell rests on fewer than 100 defaults. */
export function lgdFor(p) {
  const cell = D.lgdMap.get(`${p.size}|${p.sector}`.toUpperCase());
  if (cell && cell.defaults >= 100) return { lgd: cell.lgd, thin: false, n: cell.defaults };
  const fb = D.lgd.fallback[p.size];
  return { lgd: fb, thin: true, n: cell ? cell.defaults : 0 };
}

export function guaranteeFor(p) {
  const r = row(p);
  if (r && r[D.ix.guarantee] != null) return r[D.ix.guarantee];
  if (p.subprogram === 'FA$TRK (Small Loan Express)') return 0.5;
  return (p.size === '<50K' || p.size === '50-150K') ? 0.85 : 0.75;
}

/* ------------------------------------------------------------------
   Cost stack.

   This is the CORRECTED version. Two fixes against the workbook:
     · expected loss is annualised (5-year loss / 5) so it sits in the
       same units as funding, servicing and capital;
     · the guarantee relieves the capital charge as well as the loss,
       since the guaranteed portion carries a 0% risk weight.
   Both are already done correctly on the scorecard sheet; the
   sensitivity grids and the lender pricing sheet were inconsistent.
   ------------------------------------------------------------------ */
export function costStack(p, opts) {
  const c = D.costs;
  const guarantee = opts.guarantee;
  const avgLoan = opts.avgLoan || 150000;
  const funding = opts.funding * (1 - c.capital_ratio);
  const origination = (opts.origination / avgLoan) / 5;
  const el = opts.el5 / 5 * (1 - guarantee);
  const capital = opts.capitalCharge * (1 - guarantee);
  const servicing = c.servicing;
  const required = funding + origination + el + capital + servicing;
  return {
    funding, origination, expectedLoss: el, capital, servicing, required,
    spread: opts.rate == null ? null : opts.rate - required
  };
}

/* Smallest guarantee, to the nearest percentage point, at which the
   segment clears its cost of funds. */
export function guaranteeNeeded(p, opts) {
  for (let g = 0; g <= 100; g++) {
    const s = costStack(p, { ...opts, guarantee: g / 100 });
    if (s.spread != null && s.spread > 0) return g / 100;
  }
  return null;
}

export function percentileOfEL(el) {
  const a = D.elSorted;
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < el) lo = mid + 1; else hi = mid; }
  return lo / a.length;
}

/* For "what one change helps most": try every single-attribute swap. */
export function singleSwaps(p, regime) {
  const base = pdAt(p, regime, 60);
  if (base == null) return [];
  const baseEL = base * lgdFor(p).lgd;
  const out = [];
  for (const field of ['businesstype', 'sector', 'subprogram', 'size']) {
    for (const v of D.levels[field]) {
      if (v === p[field]) continue;
      const q = { ...p, [field]: v };
      const pd = pdAt(q, regime, 60);
      if (pd == null) continue;
      out.push({ field, from: p[field], to: v, el: pd * lgdFor(q).lgd, delta: pd * lgdFor(q).lgd - baseEL });
    }
  }
  if (!p.collateral) {
    const q = { ...p, collateral: 1 };
    const pd = pdAt(q, regime, 60);
    if (pd != null) out.push({ field: 'collateral', from: 'unsecured', to: 'secured', el: pd * lgdFor(q).lgd, delta: pd * lgdFor(q).lgd - baseEL });
  }
  return out.sort((a, b) => a.delta - b.delta);
}

export const fmtPct = (x, d = 2) => x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%';
export const fmtNum = n => n == null ? '—' : n.toLocaleString('en-US');
export const fmtUSD = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
export const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
