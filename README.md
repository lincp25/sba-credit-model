# What does a small business loan cost a bank?

An interactive expected loss model built on **1,391,586 SBA 7(a) loans**, FY2000 to FY2026.

Pick a borrower and the whole page re-prices around them: the survival curve of a hundred
identical loans, where the risk comes from, what the model got right and wrong on loans it had
never seen, where the borrower sits among all 5,040 profiles, how much of the principal is lost
when one of them fails, and the smallest government guarantee at which a commercial lender stops
losing money on them.

**Live site:** https://YOUR-USERNAME.github.io/YOUR-REPO/

---

## Running it

The page loads its data with `fetch`, so it needs to be served over HTTP rather than opened as a
file.

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
cd YOUR-REPO
python3 -m http.server 8000
# then open http://localhost:8000
```

To publish: push to GitHub, then **Settings → Pages → Source: deploy from branch → main / (root)**.
The `.nojekyll` file is already in place so GitHub serves the directory as-is.

There is no build step and no framework. Every chart is hand-drawn SVG, so the only external
request is the Google Fonts stylesheet, and the page degrades to system serifs without it.

## Checking the numbers

```bash
node test.mjs
```

`test.mjs` re-derives the model in Node and asserts it against the values in the original
spreadsheet. The most important check reprices all 5,040 borrower profiles from the raw
coefficients and compares each against the probability of default the Python model produced;
the largest discrepancy is 1.0 × 10⁻⁴, which is the rounding granularity of the stored values.

## Layout

```
index.html          markup and all prose
css/style.css       one stylesheet
js/model.js         the model: PD hazard curve, LGD lookup, cost stack
js/charts.js        SVG drawing helpers, no dependencies
js/app.js           shared borrower state and the six exhibits
data/*.json         extracted from the workbook, 1.4 MB in total
test.mjs            verification harness
```

## Where the data comes from

| Source | Used for |
|---|---|
| SBA 7(a) FOIA loan-level release, as of 31 March 2026 | loan terms, defaults, charge-offs, guarantee shares, interest rates |
| FDIC call reports, FY2024 | bank funding cost, capital ratios, return on equity, operating cost |

Probability of default is a discrete-time hazard model with an age effect estimated every three
months and separate coefficient sets for benign, through-the-cycle and crisis conditions. Loss
severity is measured directly from realised charge-offs by loan size and industry, falling back to
the size-band average wherever a cell rests on fewer than 100 observed defaults.

**Horizon convention.** The age effect on each row applies to the quarter *ending* at that month,
so cumulative default by month H is `1 − Π(1 − hazard(a))³` for `a = 0, 3, … H`. Month 0 carries a
near-zero effect and acts as a seed. This reproduces the Python model to four decimal places at
12, 36 and 60 months.

## Corrections applied to the original workbook

The spreadsheet this is built from carried several inconsistencies. The site uses the corrected
versions throughout, and they are worth naming rather than quietly fixing:

- **Expected loss is annualised.** The lender pricing sheet subtracted a five-year cumulative loss
  from an otherwise annual spread. Every cost here is per year.
- **The guarantee relieves capital as well as loss.** A government-guaranteed portion carries a 0%
  risk weight, so the capital charge is scaled by `(1 − guarantee)`. The workbook did this on the
  scorecard but not in the sensitivity grids.
- **Servicing is charged consistently.** Two sheets computed the same "required rate" one
  percentage point apart because one omitted the 1% servicing cost.
- **Keys are normalised to upper case.** The workbook mixed `FALSE`/`False` and `crisis`/`Crisis`,
  which Excel resolves case-insensitively and JavaScript does not.
- **Each chart covers the range its own data covers.** Nothing is truncated to a common window,
  because the windows genuinely differ: the seasoning record runs 26 years for the 2000&ndash;2004
  vintages but only 13 for 2013&ndash;2016, the validation curves run 15 years, and the model's age
  table is estimated to 10. R² is quoted over the first ten years, matching the workbook's own
  scoring range, with the full-span figure stated alongside it. Where a size band's at-risk pool
  falls below 5,000 loans the line keeps going but is drawn faintly.

## What this cannot tell you

1. Charge-offs are recorded with an administrative lag, so defaults are dated later than they
   happened and the seasoning curve is shifted right by an unknown amount.
2. Interest rates only exist in the SBA record from FY2009, so anything about pricing rests on the
   post-2009 book rather than the full twenty-six years.
3. Loss is measured against the original loan amount, not the balance outstanding at default, which
   overstates severity on long-seasoned loans.
4. This is a record of *approved* loans. It says nothing about borrowers who were turned down,
   which is exactly the population an access-to-capital argument most needs.

Two further judgements are mine rather than the data's: expected loss is spread evenly across five
years when real losses arrive back-loaded, and the cost stack assumes a lender can fund the
guaranteed portion without holding capital against it.

Nothing here is investment advice or a credit recommendation.

## Licence

Code MIT. The underlying SBA and FDIC data are public records.
