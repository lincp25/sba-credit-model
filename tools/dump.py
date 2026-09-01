import sys, re, os
from xml.etree import ElementTree as ET

BASE = '/home/claude/x/xl'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def shared_strings():
    ss = []
    for _, el in ET.iterparse(os.path.join(BASE, 'sharedStrings.xml'), events=('end',)):
        if el.tag == NS + 'si':
            ss.append(''.join(t.text or '' for t in el.iter(NS + 't')))
            el.clear()
    return ss

SS = shared_strings()

def sheetmap():
    s = open(os.path.join(BASE, 'workbook.xml')).read()
    sheets = re.findall(r'<sheet name="([^"]+)" sheetId="\d+"(?: state="\w+")? r:id="(rId\d+)"', s)
    rels = open(os.path.join(BASE, '_rels/workbook.xml.rels')).read()
    m = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(worksheets/[^"]+)"', rels))
    return [(n, os.path.join(BASE, m[r])) for n, r in sheets]

SHEETS = sheetmap()
BYNAME = {n: p for n, p in SHEETS}

def colrow(ref):
    m = re.match(r'([A-Z]+)(\d+)', ref)
    return m.group(1), int(m.group(2))

def dump(name, maxrow=200, maxcolletter='Z', show_values=True):
    path = BYNAME[name]
    out = []
    def colnum(c):
        n = 0
        for ch in c:
            n = n * 26 + ord(ch) - 64
        return n
    lim = colnum(maxcolletter)
    for _, el in ET.iterparse(path, events=('end',)):
        if el.tag == NS + 'row':
            r = int(el.get('r'))
            if r > maxrow:
                el.clear()
                break
            for c in el.findall(NS + 'c'):
                ref = c.get('r')
                col, row = colrow(ref)
                if colnum(col) > lim:
                    continue
                t = c.get('t')
                f = c.find(NS + 'f')
                v = c.find(NS + 'v')
                isel = c.find(NS + 'is')
                val = None
                if t == 's' and v is not None:
                    val = SS[int(v.text)]
                elif t == 'inlineStr' and isel is not None:
                    val = ''.join(x.text or '' for x in isel.iter(NS + 't'))
                elif v is not None:
                    val = v.text
                fs = None
                if f is not None:
                    fs = '=' + (f.text or '')
                    if f.get('t') == 'shared' and not f.text:
                        fs = '=<shared si%s>' % f.get('si')
                if fs is None and val is None:
                    continue
                out.append((ref, fs, val))
            el.clear()
    return out

if __name__ == '__main__':
    name = sys.argv[1]
    maxrow = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    maxcol = sys.argv[3] if len(sys.argv) > 3 else 'Z'
    prev = None
    for ref, f, v in dump(name, maxrow, maxcol):
        col, row = colrow(ref)
        if prev is not None and row != prev:
            print('---')
        prev = row
        if f:
            print(f'{ref}: {f}   -> {v}')
        else:
            print(f'{ref}: {v}')
