import json, re, os, sys
sys.path.insert(0, '/home/claude')
import dump

OUT = '/home/claude/site/data'
os.makedirs(OUT, exist_ok=True)

def grid(name, maxrow, maxcol):
    d = {}
    for ref, f, v in dump.dump(name, maxrow, maxcol):
        m = re.match(r'([A-Z]+)(\d+)', ref)
        d[(m.group(1), int(m.group(2)))] = v
    return d

def num(x):
    if x is None or x == '':
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def r6(x):
    return None if x is None else round(x, 8)

def write(name, obj):
    p = os.path.join(OUT, name)
    with open(p, 'w') as fh:
        json.dump(obj, fh, separators=(',', ':'))
    print(f'{name}: {os.path.getsize(p)/1024:.0f} KB')

BANDS = ['<50K', '50-150K', '150-350K', '350K-1M', '1M+']

# ---------------------------------------------------------------- seasoning
def curve_all():
    d = grid('01_seasoning_curve', 400, 'E')
    n = max(r for c, r in d)
    out = []
    for r in range(2, n + 1):
        if d.get(('A', r)) is None:
            continue
        out.append([int(num(d[('A', r)])), int(num(d[('B', r)])), r6(num(d[('D', r)]))])
    return out

def curve_by_size(sheet):
    d = grid(sheet, 400, 'K')
    n = max(r for c, r in d)
    cols = {b: (chr(ord('B') + 2 * i), chr(ord('C') + 2 * i)) for i, b in enumerate(BANDS)}
    out = {'month': [], 'at_risk': {b: [] for b in BANDS}, 'hazard': {b: [] for b in BANDS}}
    for r in range(2, n + 1):
        if d.get(('A', r)) is None:
            continue
        out['month'].append(int(num(d[('A', r)])))
        for b in BANDS:
            ac, hc = cols[b]
            ar = num(d.get((ac, r)))
            hz = num(d.get((hc, r)))
            out['at_risk'][b].append(None if ar is None else int(ar))
            out['hazard'][b].append(r6(hz))
    return out

seasoning = {
    'whole_book': curve_all(),
    'eras': {
        'all': curve_by_size('02_seasoning_by_size'),
        'cohort_2005_12': curve_by_size('03_seasoning_cohort_2005_12'),
        'pre_crisis': curve_by_size('04_seasoning_pre_crisis'),
        'post_crisis': curve_by_size('05_seasoning_post_crisis'),
    },
}
write('seasoning.json', seasoning)

# ---------------------------------------------------------------- validation
def check(sheet):
    d = grid(sheet, 60, 'F')
    n = max(r for c, r in d)
    rows = []
    for r in range(2, n + 1):
        if d.get(('A', r)) is None:
            continue
        rows.append([
            int(num(d[('A', r)])), int(num(d[('B', r)])), num(d[('C', r)]),
            r6(num(d[('D', r)])), r6(num(d[('E', r)])), r6(num(d[('F', r)]))
        ])
    return rows

seg = grid('holdout_by_segment', 200, 'J')
n = max(r for c, r in seg)
segments = []
for r in range(2, n + 1):
    if seg.get(('A', r)) is None:
        continue
    segments.append({
        'size': seg[('A', r)], 'sector': seg[('B', r)],
        'exposures': int(num(seg[('C', r)]) or 0),
        'actual_defaults': int(num(seg[('D', r)]) or 0),
        'actual': r6(num(seg.get(('F', r)))),
        'predicted': r6(num(seg.get(('G', r)))),
    })

write('validation.json', {'fit': check('fit_check_curve'),
                          'holdout': check('holdout_check_curve'),
                          'segments': segments})

# ---------------------------------------------------------------- lgd
d = grid('LGD_by_sizesector', 200, 'G')
n = max(r for c, r in d)
cells = []
for r in range(3, n + 1):
    size = d.get(('A', r))
    sector = d.get(('B', r))
    if not size or not sector or 'Total' in str(size):
        continue
    cells.append({
        'size': size, 'sector': sector,
        'charge_off': num(d.get(('C', r))), 'approval': num(d.get(('D', r))),
        'defaults': int(num(d.get(('E', r))) or 0), 'lgd': r6(num(d.get(('G', r)))),
    })

lp = grid('lgd_pivot_pre', 45, 'D')
n2 = max(r for c, r in lp)
def block(start):
    out = []
    r = start
    while r <= n2:
        lab = lp.get(('A', r))
        if lab is None or str(lab) in ('range',):
            break
        v = num(lp.get(('D', r)))
        if v is None:
            break
        out.append({'label': str(lab), 'lgd': r6(v),
                    'charge_off': num(lp.get(('B', r))), 'approval': num(lp.get(('C', r)))})
        r += 1
    return out

drivers = {
    'collateral': {'rows': block(3), 'range': r6(num(lp.get(('D', 6))))},
    'size_band': {'rows': block(9), 'range': r6(num(lp.get(('D', 15))))},
}
# the sector block opens with an unlabelled row, so scan for named rows
sector_rows = []
r = 18
while r <= n2:
    lab = lp.get(('A', r))
    v = num(lp.get(('D', r)))
    if v is None and lab is None:
        r += 1
        if r > 18 + 3:
            break
        continue
    if lab and str(lab).lower().startswith('range'):
        break
    if v is not None and lab:
        sector_rows.append({'label': str(lab), 'lgd': r6(v),
                            'charge_off': num(lp.get(('B', r))), 'approval': num(lp.get(('C', r)))})
    r += 1
named = [x for x in sector_rows if x['label'] != 'Grand Total']
if named:
    vals = [x['lgd'] for x in named]
    drivers['sector'] = {'rows': named, 'range': r6(max(vals) - min(vals))}

write('lgd.json', {'cells': cells, 'drivers': drivers,
                   'fallback': {x['label']: x['lgd'] for x in block(9)}})

# ---------------------------------------------------------------- model
d = grid('pd-Coef', 400, 'D')
n = max(r for c, r in d)
coef = {}
for r in range(3, n + 1):
    key = d.get(('D', r))
    v = num(d.get(('B', r)))
    if key and v is not None:
        coef[str(key)] = r6(v)

d = grid('pd-age', 400, 'D')
n = max(r for c, r in d)
ageeff = {}
for r in range(3, n + 1):
    key = d.get(('D', r))
    v = num(d.get(('B', r)))
    if key and v is not None:
        ageeff[str(key)] = r6(v)

calc = grid('pdxlgd_expected loss ', 20, 'D')
macro = {
    'unemployment': num(calc.get(('C', 11))),
    'prime': num(calc.get(('C', 12))),
    'hpi': num(calc.get(('C', 13))),
}
write('model.json', {'coef': coef, 'age': ageeff, 'macro': macro})

# ---------------------------------------------------------------- costs
bc = grid('bank_costs+capital', 20, 'AC')
sens = grid('sensitvity analysis', 20, 'K')
costs = {
    'funding': {
        'median bank': r6(num(bc.get(('Z', 2)))),
        'low (25th)': r6(num(bc.get(('Z', 3)))),
        'high (75th)': r6(num(bc.get(('Z', 4)))),
        'SBA-weighted': r6(num(bc.get(('Z', 5)))),
        'through-cycle': r6(num(bc.get(('Z', 6)))),
    },
    'capital_charge': {
        'median bank': r6(num(bc.get(('Z', 8)))),
        'low (25th)': r6(num(bc.get(('Z', 9)))),
        'high (75th)': r6(num(bc.get(('Z', 10)))),
        'SBA-weighted': r6(num(bc.get(('Z', 11)))),
    },
    'capital_ratio': r6(num(bc.get(('Z', 13)))),
    'operating_cost': {
        'sba_concentrated': r6(num(bc.get(('Z', 15)))),
        'all_lenders': r6(num(bc.get(('Z', 16)))),
    },
    'servicing': 0.01,
    'origination': {BANDS[i]: num(sens.get(('F', 11 + i))) for i in range(5)},
}
write('costs.json', costs)

# ---------------------------------------------------------------- scorecard
d = grid('pd_scorecard_weighted', 5042, 'AE')
rows = []
for r in range(3, 5043):
    bt = d.get(('A', r))
    if not bt:
        continue
    rows.append([
        str(bt), str(d.get(('B', r))), str(d.get(('C', r))),
        1 if str(d.get(('D', r))) in ('1', 'True', 'TRUE') else 0,
        str(d.get(('E', r))),
        r6(num(d.get(('F', r)))), r6(num(d.get(('G', r)))), r6(num(d.get(('H', r)))),
        int(num(d.get(('K', r))) or 0), num(d.get(('L', r))) or 0,
        r6(num(d.get(('M', r)))), r6(num(d.get(('T', r)))), r6(num(d.get(('Y', r)))),
    ])
print('scorecard rows:', len(rows))

# three-regime PDs keyed by the scorecard key
tr = grid('scorecard_3regime', 11045, 'K')
n = max(r for c, r in tr)
regimes = {}
for r in range(3, n + 1):
    k = tr.get(('K', r))
    reg = tr.get(('J', r))
    if not k or not reg:
        continue
    pd60 = num(tr.get(('H', r)))
    if pd60 is None:
        continue
    regimes.setdefault(str(k).upper(), {})[str(reg)] = [
        r6(num(tr.get(('F', r)))), r6(num(tr.get(('G', r)))), r6(pd60)
    ]
print('regime keys:', len(regimes))

write('scorecard.json', {
    'fields': ['businesstype', 'sector', 'subprogram', 'collateral', 'size',
               'pd12', 'pd36', 'pd60', 'loans', 'dollars', 'lgd', 'rate', 'guarantee'],
    'rows': rows,
})
write('regimes.json', regimes)
