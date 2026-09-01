# Regenerating the data

These two scripts read the Excel workbook and rewrite everything in `../data/`.
Run them whenever you change the model in Excel.

```bash
# put credit_model.xlsx somewhere, then:
mkdir -p /tmp/x && unzip -q credit_model.xlsx -d /tmp/x
# edit BASE at the top of dump.py to point at /tmp/x/xl
python3 extract.py
```

`dump.py` streams cells straight out of the sheet XML, because the workbook is
54 MB and openpyxl will not open it in reasonable time.

`extract.py` pulls each sheet into a compact JSON file. It does not correct
anything: the site applies the cost-stack corrections in `js/model.js`, so if
you fix them in Excel instead, remove the duplicate fix from `costStack()`.
