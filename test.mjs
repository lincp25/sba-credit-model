import fs from 'fs';
global.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync('./' + p, 'utf8')) });
global.document = { createElementNS: () => ({ setAttribute() {}, appendChild() {}, style: {} }) };
global.matchMedia = () => ({ matches: false });

const M = await import('./js/model.js');
await M.load();

let fail = 0;
const ok = (name, got, want, tol = 5e-4) => {
  const good = want == null ? got == null : Math.abs(got - want) <= tol;
  if (!good) fail++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}: got ${got} want ${want}`);
};

console.log('--- data shape ---');
ok('scorecard rows', M.D.scorecard.rows.length, 5040, 0);
ok('lgd cells present', M.D.lgd.cells.length > 80 ? 1 : 0, 1, 0);
ok('coef count', Object.keys(M.D.model.coef).length, 111, 0);

console.log('\n--- PD engine vs workbook (reference segment, through-cycle, u=6 prime=5) ---');
const ref = { businesstype: 'CORPORATION', sector: 'Accommodation & Food',
  subprogram: 'Community Express', collateral: 0, size: '150-350K',
  unemployment: 6, prime: 5, hpi: 0 };
ok('pd 12m', M.pdAt(ref, 'through-cycle', 12), 0.0037);
ok('pd 36m', M.pdAt(ref, 'through-cycle', 36), 0.0718);
ok('pd 60m', M.pdAt(ref, 'through-cycle', 60), 0.1653);

console.log('\n--- PD engine vs the pasted scorecard, across many segments ---');
const ix = M.D.ix;
let n = 0, worst = 0, worstKey = '';
for (const r of M.D.scorecard.rows) {
  const p = { businesstype: r[ix.businesstype], sector: r[ix.sector], subprogram: r[ix.subprogram],
    collateral: r[ix.collateral], size: r[ix.size], unemployment: 6, prime: 5, hpi: 0 };
  const got = M.pdAt(p, 'through-cycle', 60);
  if (got == null || r[ix.pd60] == null) continue;
  const d = Math.abs(got - r[ix.pd60]);
  if (d > worst) { worst = d; worstKey = M.keyOf(p); }
  n++;
}
console.log(`compared ${n} segments; largest absolute difference ${worst.toExponential(2)} (${worstKey})`);
ok('max PD deviation within rounding', worst < 3e-4 ? 1 : 0, 1, 0);

console.log('\n--- LGD lookup ---');
ok('<50K fallback', M.D.lgd.fallback['<50K'], 0.83256);
ok('1M+ fallback', M.D.lgd.fallback['1M+'], 0.56700);
const lg = M.lgdFor({ size: '<50K', sector: 'Accommodation & Food' });
ok('<50K Accommodation', lg.lgd, 0.80520);
ok('  flagged as thick', lg.thin ? 0 : 1, 1, 0);
const thin = M.lgdFor({ size: '<50K', sector: 'Mining' });
ok('<50K Mining falls back', thin.lgd, 0.83256);
ok('  flagged as thin', thin.thin ? 1 : 0, 1, 0);

console.log('\n--- driver test (the collateral finding) ---');
ok('collateral range pp', M.D.lgd.drivers.collateral.range * 100, 0.075, 0.01);
ok('size range pp', M.D.lgd.drivers.size_band.range * 100, 26.56, 0.05);

console.log('\n--- cost stack and guarantee solver ---');
const r0 = M.row({ businesstype: 'CORPORATION', sector: 'Retail Trade', subprogram: 'Guaranty',
  collateral: 1, size: '150-350K' });
if (r0) {
  const el5 = r0[ix.pd60] * r0[ix.lgd];
  const opts = { funding: M.D.costs.funding['SBA-weighted'], origination: 3500, el5,
    capitalCharge: M.D.costs.capital_charge['SBA-weighted'], avgLoan: r0.avgLoan, rate: r0[ix.rate] };
  const s0 = M.costStack({}, { ...opts, guarantee: 0 });
  const s1 = M.costStack({}, { ...opts, guarantee: 0.75 });
  console.log(`  no guarantee: required ${(s0.required*100).toFixed(2)}%  charged ${(r0[ix.rate]*100).toFixed(2)}%`);
  console.log(`  75% guarantee: required ${(s1.required*100).toFixed(2)}%`);
  ok('guarantee lowers the required rate', s1.required < s0.required ? 1 : 0, 1, 0);
  ok('servicing is charged', Math.abs(s0.servicing - 0.01) < 1e-9 ? 1 : 0, 1, 0);
  ok('capital is relieved by the guarantee',
     Math.abs(s1.capital - M.D.costs.capital_charge['SBA-weighted'] * 0.25) < 1e-9 ? 1 : 0, 1, 0);
  const need = M.guaranteeNeeded({}, opts);
  console.log(`  smallest guarantee that clears: ${need == null ? 'none works' : (need*100).toFixed(0)+'%'}`);
}

console.log('\n--- headline counts quoted in the copy ---');
const priced = M.D.scorecard.rows.filter(r => r[ix.rate] != null && r[ix.loans] >= 100);
const c = M.D.costs;
const req = (r, g) => c.funding['SBA-weighted'] * (1 - c.capital_ratio)
  + (c.origination[r[ix.size]] / (r.avgLoan || 150000)) / 5
  + (r.el5 / 5) * (1 - g) + c.capital_charge['SBA-weighted'] * (1 - g) + c.servicing;
const clearsAlone = priced.filter(r => r[ix.rate] > req(r, 0)).length;
const clearsWith  = priced.filter(r => r[ix.rate] > req(r, r[ix.guarantee] ?? .75)).length;
console.log(`  priced segments with 100+ loans: ${priced.length}`);
console.log(`  clear with no guarantee: ${clearsAlone}`);
console.log(`  clear with the guarantee: ${clearsWith}`);
console.log(`  need the guarantee: ${clearsWith - clearsAlone}`);

console.log('\n--- seasoning cumulative defaults (whole book) ---');
let sv = 1; const cum = {};
M.D.seasoning.whole_book.forEach(([mo, ar, hz]) => { sv *= (1 - (hz || 0)); cum[mo] = 1 - sv; });
console.log(`  year 1 ${(cum[12]*100).toFixed(2)}%  year 3 ${(cum[36]*100).toFixed(2)}%  year 5 ${(cum[60]*100).toFixed(2)}%`);

console.log('\n--- validation stats quoted in the copy ---');
const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
function rsq(a,b){const ma=mean(a),mb=mean(b);let nu=0,da=0,db=0;
  for(let i=0;i<a.length;i++){nu+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}
  return (nu/Math.sqrt(da*db))**2;}
for (const k of ['fit','holdout']) {
  const rows = M.D.validation[k];
  console.log(`  ${k}: R2 ${rsq(rows.map(r=>r[4]),rows.map(r=>r[5])).toFixed(3)}, ` +
    `actual ${rows.reduce((a,r)=>a+r[2],0)}, predicted ${rows.reduce((a,r)=>a+r[3],0).toFixed(0)}`);
}
const segs = M.D.validation.segments.filter(s => s.actual_defaults >= 100);
console.log(`  segments with 100+ defaults: ${segs.length}`);

console.log(`\n${fail ? fail + ' CHECK(S) FAILED' : 'all checks passed'}`);
process.exit(fail ? 1 : 0);
