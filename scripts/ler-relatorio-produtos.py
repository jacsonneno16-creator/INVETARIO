import zipfile
import re
import csv
import sys
from xml.etree import ElementTree as ET

CAMINHO = r"C:\Users\Daterrinha69\OneDrive - daterrinhaalimentos.com.br\relatorio-cadastro-produtos-logistico (1).xlsx"
SAIDA = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Daterrinha69\AppData\Local\Temp\relatorio-produtos.csv"

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def col_letras(ref):
    m = re.match(r'([A-Z]+)(\d+)', ref)
    return m.group(1), int(m.group(2))

with zipfile.ZipFile(CAMINHO) as z:
    with z.open('xl/sharedStrings.xml') as f:
        sst_root = ET.parse(f).getroot()
    shared = []
    for si in sst_root.findall('m:si', NS):
        textos = si.findall('.//m:t', NS)
        shared.append(''.join(t.text or '' for t in textos))
    with z.open('xl/worksheets/sheet1.xml') as f:
        sheet_root = ET.parse(f).getroot()

linhas = {}
for row in sheet_root.findall('.//m:row', NS):
    r = int(row.get('r'))
    linhas[r] = {}
    for c in row.findall('m:c', NS):
        ref = c.get('r')
        colletra, _ = col_letras(ref)
        t = c.get('t')
        v = c.find('m:v', NS)
        valor = ''
        if v is not None:
            if t == 's':
                valor = shared[int(v.text)]
            else:
                valor = v.text
        linhas[r][colletra] = valor

max_r = max(linhas.keys())
colunas = ['A','B','C','D','E','F','G','H','I']
with open(SAIDA, 'w', newline='', encoding='utf-8-sig') as out:
    w = csv.writer(out, delimiter=';')
    for r in range(1, max_r + 1):
        linha = linhas.get(r, {})
        w.writerow([linha.get(c, '') for c in colunas])

print('Linhas:', max_r)
print('Gravado em:', SAIDA)
