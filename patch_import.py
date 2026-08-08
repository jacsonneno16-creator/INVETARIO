from pathlib import Path

path = Path('public/js/analista/13-enderecos-importacao-selecao.js')
text = path.read_text(encoding='utf-8', errors='replace').splitlines()

# Patch helper
for i, line in enumerate(text):
    if line.strip() == "function normalizeImportValue(value) {":
        helper_start = i
        break
else:
    raise SystemExit('normalizeImportValue helper not found')

# Replace helper block lines
text[helper_start + 1] = "  return String(value || '').trim().toUpperCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');"
text[helper_start + 2] = "}"

# Find tipo_endereco block
block_start = None
for i, line in enumerate(text):
    if line.strip() == "const selTipoEnd = document.getElementById('map-sel-tipo_endereco');":
        if i + 1 < len(text) and text[i + 1].strip() == "if (selTipoEnd && selTipoEnd.value !== '') {":
            block_start = i + 2
            break
if block_start is None:
    raise SystemExit('tipo_endereco block start not found')

block_end = None
for j in range(block_start, len(text)):
    if text[j].strip() == "const cleanedTipoEnd = normalizedTipoEnd.replace(/[^A-Z0-9]/g, '');":
        block_end = j
        break
if block_end is None:
    raise SystemExit('tipo_endereco block end not found')

# Replace from block_start through block_end inclusive
new_lines = [
    "      const rawTipoEnd = normalizeImportValue(row[parseInt(selTipoEnd.value)] ?? '');",
    "      const cleanedTipoEnd = rawTipoEnd.replace(/[^A-Z0-9]/g, '');",
    "      if (/^(VIRTUAL|VIRT|V)$/.test(cleanedTipoEnd)) tipoEndereco = 'VIRTUAL';",
    "      else if (/^(FISICO|FISICA|F)$/.test(cleanedTipoEnd)) tipoEndereco = 'FISICO';"
]
text = text[:block_start] + new_lines + text[block_end + 1:]
path.write_text('\n'.join(text) + '\n', encoding='utf-8')
print('patched')
