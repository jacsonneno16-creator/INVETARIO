function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  6. IMPORTAÇÃO DE ARQUIVOS (BASE OFICIAL)
// ───────────────────────────────────────────────────────────────────

const CAMPOS_BASE = ['endereco','pallete_ou_capa','codigo_produto','descricao_produto','gtin','dun','quantidade_esperada','fator_caixa','setor','rua','nivel','custo_bruto','observacao'];
const ALIAS_BASE = {
  // ── Endereço ─────────────────────────────────────────────────────
  endereco: [
    // ⚡ Prioridade máxima — coluna padrão Da Terrinha
    'endereco_logistico_descritivo',
    // Demais colunas Da Terrinha
    'endereco_logistico_key',
    'end_logistico','localizacao','localizacao_estoque','posicao',
    // Padrão interno / genérico
    'endereco','endereço','end','address','cod_end','cod_endereco','codigo_endereco',
  ],
  // ── Palete / Capa ─────────────────────────────────────────────────
  pallete_ou_capa: [
    'pallete_ou_capa','pallete','pallet','capa','tipo','pallete ou capa',
    // Da Terrinha
    'palete_key','palete','pallet_key','num_palete','numero_palete',
  ],
  // ── Código do produto ─────────────────────────────────────────────
  codigo_produto: [
    'codigo_produto','codigo','código','sku','cod_produto','cod','item',
    // Da Terrinha
    'produto_key','produto_caixa_key','cod_item','codigo_item','item_key',
    'pessoa_key',  // fallback se for o único identificador
  ],
  // ── Descrição ─────────────────────────────────────────────────────
  descricao_produto: [
    'descricao_produto','descricao','descrição','description','produto','desc','nome_produto',
    // Da Terrinha
    'descricao_ficha_estq_detalhe','descricao_local_estoque','nome_abreviado',
    'desc_produto','nome_produto','descricao_item',
  ],
  // ── GTIN ──────────────────────────────────────────────────────────
  gtin: [
    'gtin','ean','ean13','barcode','codigo_barras','codigo_de_barras','cod_barras','gtin_ean','gtinean','ean_gtin','eangtin','gtin_principal',
  ],
  // ── DUN ───────────────────────────────────────────────────────────
  dun: [
    'dun','dun14','ean14',
  ],
  // ── Quantidade esperada ───────────────────────────────────────────
  quantidade_esperada: [
    'quantidade_enderecada','qtd_enderecada','quantidade_esperada','qtd_esperada',
    'saldo','saldo_estoque','qtd_sistema',
    'estoque_total_unidades','estoque_unidades','total_unidades_estoque',
    'expected_qty','saldo_erp','estoque_total','qtd_estoque',
    'total_unidades','quantidade','qtd','qty','estoque','qtde','qtd_estoque',
    // Genéricos
    'quantidade','qtd','qty','estoque','qtde','fator_estoque',
  ],
  // ── Setor ─────────────────────────────────────────────────────────
  setor: [
    'setor','sector','area','área','local_area',
    // Da Terrinha
    'setor_armazenagem','descricao_setor_armazenagem','setor_estoque',
    'descricao_setor','area_armazenagem',
  ],
  // ── Rua / Corredor ────────────────────────────────────────────────
  rua: [
    'rua','corredor','aisle',
  ],
  // ── Nível ─────────────────────────────────────────────────────────
  nivel: [
    'nivel','nível','level','andar',
  ],
  // ── Custo unitário do produto ─────────────────────────────────────
  custo_bruto: [
    'custo_bruto','custo_unitario','custo_unit','custo','cost','unit_cost',
    'preco_custo','preco','valor_unitario',
    // Da Terrinha — variações comuns nos relatórios WMS
    'custo_liquido','custo_medio','custo_med','custo_un','custo_und',
    'vlr_custo','valor_custo','vl_custo','vl_unitario','vl_unit',
    'preco_medio','preco_med','preco_unitario','preco_unit',
    'custo_bruto_unit','custo_bruto_unitario','custo_liq',
  ],
  // ── Observação ────────────────────────────────────────────────────
  observacao: [
    'observacao','observação','obs','nota','notas',
    // Da Terrinha — campos extras mapeados como observação
    'curva','data_de_validade','numero_do_lote',
    'custo_bruto_total',
  ],
  fator_caixa: [
    'fator_caixa','fator_embalagem','fator','unid_cx','unidades_por_caixa',
    'unid_por_cx','fator_conversao','conv','factor','qty_per_box','fator_palete',
    'fator_cxa','und_cx','unid_embalagem','qtd_embalagem','emb','fator_und'
  ],
};

function autoMapBase(headers) {
  // Normaliza: lowercase, espaços→_, remove acentos e chars especiais
  const normalize = x => String(x).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')   // remove acentos
    .replace(/[\s\/\-]+/g,'_').replace(/[^a-z0-9_]/g,'').replace(/^_+|_+$/g,'');

  const h = headers.map(normalize);
  const mapa = {};
  CAMPOS_BASE.forEach(campo => {
    const aliases = (ALIAS_BASE[campo] || [campo]).map(normalize);
    // Itera aliases NA ORDEM da lista — o primeiro alias que existir no CSV vence
    // (não itera os headers do CSV, evitando que a ordem das colunas defina prioridade)
    let found = -1;
    for (const alias of aliases) {
      const idx = h.indexOf(alias);
      if (idx >= 0) { found = idx; break; }
    }
    if (found >= 0) mapa[campo] = found;
  });
  return mapa;
}

function parseRowsToBase(rows, headers) {
  const mapa = autoMapBase(headers);
  return rows.map(r => {
    const obj = {};
    CAMPOS_BASE.forEach(c => { obj[c] = mapa[c] !== undefined ? String(r[mapa[c]] ?? '').trim() : ''; });
    // Garantir que campos numéricos sejam números
    obj.quantidade_esperada = Math.max(0, parseFloat(obj.quantidade_esperada) || 0);
    obj.custo_bruto         = Math.max(0, parseFloat(String(obj.custo_bruto).replace(',','.')) || 0);
    return obj;
  }).filter(r => r.endereco || r.codigo_produto);
}

// Drag & drop da base do inventário
function invDover(e) { e.preventDefault(); document.getElementById('inv-drop-zone').classList.add('drag'); }
function invDleave()  { document.getElementById('inv-drop-zone').classList.remove('drag'); }
function invDdrop(e)  { e.preventDefault(); invDleave(); if (e.dataTransfer.files[0]) processFileInv(e.dataTransfer.files[0]); }
function handleFileInv(e) { if (e.target.files[0]) processFileInv(e.target.files[0]); }

/* ── Utilitários de importação ── */
function stripBOM(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}
function detectSep(firstLine) {
  const sc = (firstLine.match(/;/g)||[]).length;
  const cc = (firstLine.match(/,/g)||[]).length;
  return sc >= cc ? ';' : ',';
}
function parseCSVRobust(text) {
  const clean = stripBOM(text);
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const sep = detectSep(lines[0]);
  const parseL = line => {
    const result = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === sep && !inQ) { result.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    result.push(cur.trim());
    return result;
  };
  return { headers: parseL(lines[0]), rows: lines.slice(1).map(parseL) };
}

// ── Contexto temporário para o mapeador da base ──────────────────────
let _invRawCtx = null; // { headers, rows, arquivo }

function processFileInv(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const isCsv = ext === 'csv';

  function _process(rawResult) {
    let rows, headers;
    if (isCsv) {
      let text = rawResult;
      if (/\uFFFD/.test(text)) { invFbErr('Arquivo CSV com encoding inválido. Salve como UTF-8 ou XLSX e tente novamente.'); return; }
      ({ headers, rows } = parseCSVRobust(text));
    } else {
      try {
        const wb = XLSX.read(new Uint8Array(rawResult), { type:'array', cellDates:true, raw:false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
        headers = (raw[0] || []).map(String);
        rows = raw.slice(1);
      } catch(e) { invFbErr('Erro ao ler XLSX: ' + e.message); return; }
    }
    if (!headers.length) { invFbErr('Arquivo vazio ou sem cabeçalho.'); return; }

    _invRawCtx = { headers, rows, arquivo: file.name };
    window.AnalistaState.set('ui.inventarioImportCtx', null, { source: 'arquivo-import-reset' });
    habilitarBtnCriar();

    // Limpar feedback anterior
    document.getElementById('inv-import-fb').innerHTML = '';
    document.getElementById('inv-end-sel-wrap').style.display = 'none';

    // Mostrar o mapeador
    renderInvMapper();
  }

  const reader = new FileReader();
  reader.onerror = () => invFbErr('Não foi possível ler o arquivo. Tente novamente.');
  reader.onload = ev => { try { _process(ev.target.result); } catch(err) { invFbErr('Erro ao processar arquivo: ' + err.message); } };
  if (isCsv) reader.readAsText(file, 'UTF-8');
  else reader.readAsArrayBuffer(file);
}

// ── Configuração dos campos do mapeador ──────────────────────────────
const INV_MAP_CAMPOS = [
  { key:'endereco',          label:'Endereço',              obrig:true,  icon:'📍', hint:'Código do endereço (ex: 01.02.A.01.01)' },
  { key:'codigo_produto',    label:'Código do Produto',     obrig:true,  icon:'🔑', hint:'SKU, código ou chave do produto' },
  { key:'descricao_produto', label:'Descrição do Produto',  obrig:false, icon:'📝', hint:'Nome ou descrição do produto' },
  { key:'quantidade_esperada',label:'Quantidade Esperada (Caixas)', obrig:true, icon:'🔢', hint:'Quantidade esperada em caixas/paletes para o endereço. Ex.: se o endereço possui 50 caixas, informe 50. O fator e o total em unidades ficam apenas como referência e não alteram esta quantidade.' },
  { key:'custo_bruto',       label:'Custo Unitário (R$)',   obrig:false, icon:'💰', hint:'Custo unitário do produto — usado para calcular Valor Ganho/Perda na Análise por Produto' },
  { key:'setor',             label:'Setor / Área',          obrig:false, icon:'🏭', hint:'Setor de armazenagem' },
  { key:'rua',               label:'Rua / Corredor',        obrig:false, icon:'🛤️', hint:'Rua ou corredor do endereço' },
  { key:'pallete_ou_capa',   label:'Palete / Capa',         obrig:false, icon:'🪵', hint:'Identificador de palete ou capa' },
  { key:'gtin',              label:'GTIN / EAN',            obrig:false, icon:'📊', hint:'Código de barras unitário' },
  { key:'dun',               label:'DUN / EAN-14',          obrig:false, icon:'📦', hint:'Código de barras de caixa' },
  { key:'observacao',        label:'Observação',            obrig:false, icon:'💬', hint:'Lote, validade, curva ou observação extra' },
  { key:'fator_caixa',      label:'Fator Caixa (Referência)',  obrig:false, icon:'📦', hint:'Informação de referência da embalagem. Não multiplica a quantidade esperada e não altera a contagem operacional em caixas.' },
];

function renderInvMapper() {
  const { headers, rows, arquivo } = _invRawCtx;
  const autoMap = autoMapBase(headers); // { campo: colIndex }

  // Opções de <select>: "" + cada coluna do arquivo
  const opts = `<option value="">— não usar —</option>` +
    headers.map((h,i) => `<option value="${i}">${h}</option>`).join('');

  // Prévia: primeiros 3 valores de uma coluna
  const preview3 = idx => {
    if (idx === '' || idx === undefined) return '';
    const vals = rows.slice(0,3).map(r => String(r[idx]||'').trim()).filter(Boolean);
    return vals.length ? vals.join(', ') : '';
  };

  const camposHtml = INV_MAP_CAMPOS.map(c => {
    const autoIdx = autoMap[c.key] !== undefined ? autoMap[c.key] : '';
    const sel = `<select id="imap-${c.key}" onchange="invMapperPreview()" style="flex:1;min-width:160px;font-size:.8rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
      ${opts.replace(`value="${autoIdx}"`, `value="${autoIdx}" selected`)}
    </select>`;
    const prevId = `imap-ex-${c.key}`;
    return `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;background:${c.obrig ? '#f0fdf4' : 'var(--bg)'};border:1px solid ${c.obrig ? '#bbf7d0' : 'var(--border)'}">
      <div style="min-width:24px;font-size:1rem;margin-top:2px">${c.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:.8rem;font-weight:700;color:var(--text)">${c.label}</span>
          ${c.obrig ? '<span style="font-size:.65rem;background:#dcfce7;color:#16a34a;padding:1px 5px;border-radius:4px;font-weight:700">OBRIGATÓRIO</span>' : ''}
          <span style="font-size:.68rem;color:var(--muted)">${c.hint}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">${sel}</div>
        <div id="${prevId}" style="margin-top:4px;font-size:.7rem;color:#0369a1;font-family:var(--mono);min-height:14px"></div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('inv-mapper-zone').style.display = 'block';
  document.getElementById('inv-mapper-zone').innerHTML = `
    <div style="border:1px solid #bae6fd;border-radius:10px;background:#f0f9ff;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px">
        <div>
          <div style="font-weight:700;font-size:.88rem;color:#0369a1">🗂️ Mapeamento de Colunas — <span style="font-weight:400">${arquivo}</span></div>
          <div style="font-size:.73rem;color:var(--muted);margin-top:2px">${headers.length} colunas detectadas · ${rows.length.toLocaleString('pt-BR')} linhas · Para cada campo, escolha a coluna correspondente do seu arquivo</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="resetInvImport()" style="white-space:nowrap;flex-shrink:0">↩ Outro arquivo</button>
      </div>

      <!-- Prévia rápida do arquivo -->
      <div style="margin-bottom:12px;overflow-x:auto;border-radius:7px;border:1px solid #bae6fd">
        <table style="font-size:.7rem;border-collapse:collapse;width:100%;min-width:400px">
          <thead><tr style="background:#dbeafe">
            ${headers.map(h => `<th style="padding:5px 8px;text-align:left;color:#1d4ed8;font-weight:700;white-space:nowrap">${h}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.slice(0,3).map(r => `<tr style="border-top:1px solid #e0f2fe">${headers.map((_,i) => `<td style="padding:4px 8px;color:var(--text);white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis">${String(r[i]||'').trim().slice(0,40)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">${camposHtml}</div>

      <div style="margin-top:12px;text-align:right">
        <button class="btn btn-success" onclick="confirmarInvMapper()">✓ Aplicar Mapeamento e Importar</button>
      </div>
    </div>`;

  // ── Carregar mapeamento salvo se houver ──
  try {
    const headerKey = headers.join('|').toLowerCase();
    const savedMaps = JSON.parse(localStorage.getItem('inv_col_map') || '{}');
    const saved = savedMaps[headerKey];
    if (saved?.mapa) {
      INV_MAP_CAMPOS.forEach(c => {
        const sel = document.getElementById(`imap-${c.key}`);
        // quantidade_esperada: sempre usar autoMap (nunca restaurar valor salvo)
        // para evitar que mapeamento antigo fique com coluna errada
        if (c.key === 'quantidade_esperada') return;
        if (sel && saved.mapa[c.key] !== undefined) {
          sel.value = saved.mapa[c.key];
        }
      });
      dbg('[Mapper] Mapeamento anterior restaurado de', saved.arquivo);
      // Mostrar aviso
      const mapperZone = document.getElementById('inv-mapper-zone');
      if (mapperZone) {
        const aviso = document.createElement('div');
        aviso.style.cssText = 'margin-bottom:8px;padding:8px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:.75rem;color:#92400e;display:flex;justify-content:space-between;align-items:center';
        aviso.innerHTML = `<span>✅ Mapeamento anterior restaurado automaticamente (${saved.arquivo})</span>
          <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#92400e;font-size:.9rem">✕</button>`;
        mapperZone.insertBefore(aviso, mapperZone.firstChild);
      }
    }
  } catch(e) {}

  // Popular prévias com o auto-mapeamento
  invMapperPreview();
}

function invMapperPreview() {
  if (!_invRawCtx) return;
  const { rows } = _invRawCtx;
  INV_MAP_CAMPOS.forEach(c => {
    const sel = document.getElementById(`imap-${c.key}`);
    const ex  = document.getElementById(`imap-ex-${c.key}`);
    if (!sel || !ex) return;
    if (sel.value === '') { ex.textContent = ''; return; }
    const idx = parseInt(sel.value);
    const vals = rows.slice(0,3).map(r => String(r[idx]||'').trim()).filter(Boolean);
    ex.textContent = vals.length ? '👁 ' + vals.join(' · ') : '(vazio nas primeiras linhas)';
  });
}

function confirmarInvMapper() {
  if (!_invRawCtx) return;
  const { headers, rows, arquivo } = _invRawCtx;

  // Validar obrigatórios
  const missing = INV_MAP_CAMPOS.filter(c => c.obrig && !document.getElementById(`imap-${c.key}`)?.value);
  if (missing.length) {
    invFbErr(`Campos obrigatórios não mapeados: ${missing.map(c=>c.label).join(', ')}`);
    return;
  }

  // Montar mapa { campo: colIndex } — autoMap como fallback, seleção do usuário tem prioridade
  const autoMap = autoMapBase(headers);
  const mapa = {};
  // Aplica autoMap como base (garante custo_bruto e outros campos sem UI no mapper)
  CAMPOS_BASE.forEach(campo => {
    if (autoMap[campo] !== undefined) mapa[campo] = autoMap[campo];
  });
  // Sobrescreve com escolhas explícitas do usuário
  INV_MAP_CAMPOS.forEach(c => {
    const sel = document.getElementById(`imap-${c.key}`);
    if (sel && sel.value !== '') mapa[c.key] = parseInt(sel.value);
    else if (sel && sel.value === '' && autoMap[c.key] !== undefined) delete mapa[c.key]; // usuário optou por "não usar"
  });

  // Log para diagnóstico
  console.log('[Mapper] mapa final:', JSON.stringify(mapa));
  console.log('[Mapper] fator_caixa col index:', mapa['fator_caixa'], '| ex valor linha0:', mapa['fator_caixa'] !== undefined ? String(rows[0]?.[mapa['fator_caixa']] ?? '') : 'NÃO MAPEADO');

  // Processar linhas com o mapa final
  const base = rows.map(r => {
    const obj = {};
    CAMPOS_BASE.forEach(campo => {
      obj[campo] = mapa[campo] !== undefined ? String(r[mapa[campo]] ?? '').trim() : '';
    });
    const fatorCx = Math.max(1, parseFloat(String(obj.fator_caixa || '').replace(',','.')) || 1);
    obj.fator_caixa        = fatorCx;
    // quantidade_esperada representa CAIXAS/PALetes conforme a contagem operacional.
    // Não multiplicar pelo fator: o comparativo de divergência usa a mesma unidade informada pelo operador.
    obj.quantidade_esperada = Math.max(0, parseFloat(obj.quantidade_esperada) || 0);
    obj.custo_bruto         = Math.max(0, parseFloat(String(obj.custo_bruto).replace(',','.')) || 0);
    return obj;
  }).filter(r => r.endereco && r.codigo_produto); // obrigatório: endereço E produto

  if (!base.length) {
    invFbErr('Nenhum registro válido após o mapeamento. Verifique as colunas selecionadas.');
    return;
  }

  window.AnalistaState.set('ui.inventarioImportCtx', { base, arquivo, headers, rows }, { source: 'arquivo-import-ok' });

  // ── Salvar mapeamento para reutilizar na próxima importação ──
  try {
    const mapaUser = {};
    INV_MAP_CAMPOS.forEach(c => {
      const sel = document.getElementById(`imap-${c.key}`);
      if (sel) mapaUser[c.key] = sel.value; // salva o índice selecionado
    });
    // Chave baseada nos nomes das colunas (independente da ordem das linhas)
    const headerKey = headers.join('|').toLowerCase();
    const savedMaps = JSON.parse(localStorage.getItem('inv_col_map') || '{}');
    savedMaps[headerKey] = { mapa: mapaUser, arquivo, ts: Date.now() };
    // Manter só os 5 mais recentes
    const entries = Object.entries(savedMaps).sort((a,b) => (b[1].ts||0)-(a[1].ts||0)).slice(0,5);
    localStorage.setItem('inv_col_map', JSON.stringify(Object.fromEntries(entries)));
    dbg('[Mapper] Mapeamento salvo para', headers.length, 'colunas');
  } catch(e) {}

  // Ocultar mapeador e mostrar resultado
  document.getElementById('inv-mapper-zone').style.display = 'none';
  const endsU = [...new Set(base.map(r=>r.endereco).filter(Boolean))].length;
  const prodsU = [...new Set(base.map(r=>r.codigo_produto).filter(Boolean))].length;
  document.getElementById('inv-import-fb').innerHTML = `
    <div class="status-box ok">
      <div class="sb-icon">✅</div>
      <div>
        <div class="sb-text">${base.length.toLocaleString('pt-BR')} registros importados com mapeamento personalizado</div>
        <div class="sb-sub">${arquivo} · ${endsU} endereços únicos · ${prodsU} produtos únicos
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('inv-mapper-zone').style.display='block'" style="margin-left:8px;font-size:.7rem;padding:2px 8px">✏️ Editar mapeamento</button>
        </div>
      </div>
    </div>`;
  document.getElementById('inv-end-sel-wrap').style.display = 'block';
  document.getElementById('inv-end-resumo-txt').textContent = `${endsU} endereços únicos da base serão incluídos automaticamente`;
  habilitarBtnCriar();
}

function resetInvImport() {
  _invRawCtx = null;
  window.AnalistaState.set('ui.inventarioImportCtx', null, { source: 'reset-import' });
  document.getElementById('inv-mapper-zone').style.display = 'none';
  document.getElementById('inv-mapper-zone').innerHTML = '';
  document.getElementById('inv-import-fb').innerHTML = '';
  document.getElementById('inv-end-sel-wrap').style.display = 'none';
  document.getElementById('file-inv').value = '';
  document.getElementById('inv-drop-zone').classList.remove('drag');
  habilitarBtnCriar();
}

function invFbErr(msg) {
  document.getElementById('inv-import-fb').innerHTML = `<div class="status-box err"><div class="sb-icon">❌</div><div><div class="sb-text">Erro na importação</div><div class="sb-sub">${msg}</div></div></div>`;
  window.AnalistaState.set('ui.inventarioImportCtx', null, { source: 'reset-import' });
  habilitarBtnCriar();
}

