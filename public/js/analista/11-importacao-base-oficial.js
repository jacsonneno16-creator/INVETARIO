function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  6. IMPORTAÇÃO DE ARQUIVOS (BASE OFICIAL)
// ───────────────────────────────────────────────────────────────────

const CAMPOS_BASE = ['endereco','pallete_ou_capa','codigo_produto','descricao_produto','gtin','dun','quantidade_esperada','total_unidades_sistema','fator_caixa','tipo_produto','tipo_endereco','contabiliza_inventario','permite_multiplos_operadores','setor','rua','nivel','custo_bruto','lote_produto','validade','palete','observacao'];
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

  total_unidades_sistema: ['total_unidades_sistema','total_em_unidades','estoque_total_unidades','saldo_unidades','quantidade_sistema_unidades','qtd_total_unidades'],
  tipo_produto: ['tipo_produto','categoria_produto','categoria_inventario','grupo_produto','classe_produto','tipo_item','familia_produto'],
  tipo_endereco: ['tipo_endereco','fisico_virtual','endereco_fisico_virtual','classificacao_endereco'],
  contabiliza_inventario: ['contabiliza_inventario','contar_inventario','entra_inventario','considerar_inventario','inventariavel'],
  permite_multiplos_operadores: ['permite_multiplos_operadores','multi_operador','contagem_colaborativa','permite_contagem_simultanea'],
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
  lote_produto: ['lote_produto','lote','numero_lote'],
  validade: ['validade','data_validade'],
  palete: ['palete','pallet','capa_palete','pallete_ou_capa'],
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
    obj.total_unidades_sistema = Math.max(0, parseFloat(String(obj.total_unidades_sistema).replace(',','.')) || (obj.quantidade_esperada * (Math.max(1, parseFloat(String(obj.fator_caixa).replace(',','.')) || 1))));
    obj.tipo_produto = String(obj.tipo_produto || 'NAO CLASSIFICADO').trim().toUpperCase();
    obj.tipo_endereco = String(obj.tipo_endereco || 'FISICO').trim().toUpperCase();
    obj.contabiliza_inventario = !/^(NAO|NÃO|FALSE|0)$/i.test(String(obj.contabiliza_inventario || (obj.tipo_endereco === 'VIRTUAL' ? 'NAO' : 'SIM')).trim());
    obj.permite_multiplos_operadores = /^(SIM|TRUE|1)$/i.test(String(obj.permite_multiplos_operadores || (obj.tipo_endereco === 'VIRTUAL' ? 'SIM' : 'NAO')).trim());
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
  { key:'quantidade_esperada',label:'Quantidade Sistema (Caixas/Volumes)', obrig:true, icon:'🔢', hint:'Quantidade prevista no sistema na unidade original da base.' },
  { key:'total_unidades_sistema',label:'Total Sistema em Unidades', obrig:false, icon:'🧮', hint:'Total já convertido em unidades. Se vazio, será calculado por quantidade × fator da caixa.' },
  { key:'tipo_produto',label:'Tipo do Produto', obrig:false, icon:'🏷️', hint:'Produto de venda, insumo, embalagem, matéria-prima etc.' },
  { key:'tipo_endereco',label:'Tipo do Endereço', obrig:false, icon:'📍', hint:'FISICO ou VIRTUAL.' },
  { key:'contabiliza_inventario',label:'Contabiliza no Inventário', obrig:false, icon:'✅', hint:'SIM para entrar no progresso; NÃO para endereço virtual fora da soma.' },
  { key:'permite_multiplos_operadores',label:'Permite Vários Operadores', obrig:false, icon:'👥', hint:'SIM para contagem colaborativa no mesmo endereço.' },
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
          <div style="font-weight:700;font-size:.88rem;color:#0369a1">🗂️ Mapeamento de Colunas — <span style="font-weight:400">${escHTML(arquivo)}</span></div>
          <div style="font-size:.73rem;color:var(--muted);margin-top:2px">${headers.length} colunas detectadas · ${rows.length.toLocaleString('pt-BR')} linhas · Para cada campo, escolha a coluna correspondente do seu arquivo</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="resetInvImport()" style="white-space:nowrap;flex-shrink:0">↩ Outro arquivo</button>
      </div>

      <!-- Prévia rápida do arquivo -->
      <div style="margin-bottom:12px;overflow-x:auto;border-radius:7px;border:1px solid #bae6fd">
        <table style="font-size:.7rem;border-collapse:collapse;width:100%;min-width:400px">
          <thead><tr style="background:#dbeafe">
            ${headers.map(h => `<th style="padding:5px 8px;text-align:left;color:#1d4ed8;font-weight:700;white-space:nowrap">${escHTML(h)}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.slice(0,3).map(r => `<tr style="border-top:1px solid #e0f2fe">${headers.map((_,i) => `<td style="padding:4px 8px;color:var(--text);white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis">${escHTML(String(r[i]||'').trim().slice(0,40))}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">${camposHtml}</div>

      <div style="margin-top:12px;text-align:right">
        <div id="inv-mapper-action-status" style="margin-bottom:8px;min-height:18px;font-size:.75rem;text-align:left"></div>
        <button type="button" id="btn-confirmar-inv-mapper" class="btn btn-success">✓ Aplicar Mapeamento e Importar</button>
      </div>
    </div>`;

  // Vincular o clique sem depender de onclick inline. Isso evita falha silenciosa
  // quando o navegador bloqueia handlers inline ou quando o escopo global muda.
  const btnAplicarMapper = document.getElementById('btn-confirmar-inv-mapper');
  if (btnAplicarMapper) {
    btnAplicarMapper.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      confirmarInvMapper();
    });
  }

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
        aviso.innerHTML = `<span>✅ Mapeamento anterior restaurado automaticamente (${escHTML(saved.arquivo)})</span>
          <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#92400e;font-size:.9rem">✕</button>`;
        mapperZone.insertBefore(aviso, mapperZone.firstChild);
      }
    }
  } catch(e){ console.warn("[Erro tratado]", e); }

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
  const statusEl = document.getElementById('inv-mapper-action-status');
  const btn = document.getElementById('btn-confirmar-inv-mapper');
  const setStatus = (msg, tipo) => {
    if (!statusEl) return;
    const cores = { e:'#b91c1c', w:'#92400e', i:'#0369a1', s:'#166534' };
    statusEl.style.color = cores[tipo] || cores.i;
    statusEl.textContent = msg || '';
  };

  if (!_invRawCtx) {
    setStatus('O arquivo não está mais carregado. Selecione o arquivo novamente.', 'e');
    invFbErr('O arquivo não está mais carregado. Selecione o arquivo novamente.');
    return false;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = '⏳ Aplicando mapeamento...';
    }
    setStatus('Validando colunas e processando os registros...', 'i');

    const { headers, rows, arquivo } = _invRawCtx;

    const missing = INV_MAP_CAMPOS.filter(c => {
      if (!c.obrig) return false;
      const sel = document.getElementById(`imap-${c.key}`);
      return !sel || sel.value === '';
    });
    if (missing.length) {
      const msg = `Campos obrigatórios não mapeados: ${missing.map(c => c.label).join(', ')}`;
      setStatus(msg, 'e');
      invFbErr(msg);
      return false;
    }

    const autoMap = autoMapBase(headers);
    const mapa = {};
    CAMPOS_BASE.forEach(campo => {
      if (autoMap[campo] !== undefined) mapa[campo] = autoMap[campo];
    });
    INV_MAP_CAMPOS.forEach(c => {
      const sel = document.getElementById(`imap-${c.key}`);
      if (sel && sel.value !== '') mapa[c.key] = Number(sel.value);
      else if (sel && autoMap[c.key] !== undefined) delete mapa[c.key];
    });

    const base = rows.map(r => {
      const obj = {};
      CAMPOS_BASE.forEach(campo => {
        obj[campo] = mapa[campo] !== undefined ? String(r[mapa[campo]] ?? '').trim() : '';
      });
      obj.fator_caixa = Math.max(1, parseFloat(String(obj.fator_caixa || '').replace(',','.')) || 1);
      obj.quantidade_esperada = Math.max(0, parseFloat(String(obj.quantidade_esperada || '').replace(',','.')) || 0);
      obj.custo_bruto = Math.max(0, parseFloat(String(obj.custo_bruto || '').replace(',','.')) || 0);
      obj.total_unidades_sistema = Math.max(0, parseFloat(String(obj.total_unidades_sistema || '').replace(',','.')) || (obj.quantidade_esperada * obj.fator_caixa));
      obj.tipo_produto = String(obj.tipo_produto || 'NAO CLASSIFICADO').trim().toUpperCase();
      obj.tipo_endereco = String(obj.tipo_endereco || 'FISICO').trim().toUpperCase();
      obj.contabiliza_inventario = !/^(NAO|NÃO|FALSE|0)$/i.test(String(obj.contabiliza_inventario || (obj.tipo_endereco === 'VIRTUAL' ? 'NAO' : 'SIM')).trim());
      obj.permite_multiplos_operadores = /^(SIM|TRUE|1)$/i.test(String(obj.permite_multiplos_operadores || (obj.tipo_endereco === 'VIRTUAL' ? 'SIM' : 'NAO')).trim());
      return obj;
    }).filter(r => r.endereco && r.codigo_produto);

    if (!base.length) {
      const msg = 'Nenhum registro válido após o mapeamento. Verifique Endereço, Código do Produto e Quantidade Esperada.';
      setStatus(msg, 'e');
      invFbErr(msg);
      return false;
    }

    if (!window.AnalistaState || typeof window.AnalistaState.set !== 'function') {
      throw new Error('Store do Analista não está disponível. Atualize a página e tente novamente.');
    }

    window.AnalistaState.set('ui.inventarioImportCtx', { base, arquivo, headers, rows }, { source: 'arquivo-import-ok' });

    try {
      const mapaUser = {};
      INV_MAP_CAMPOS.forEach(c => {
        const sel = document.getElementById(`imap-${c.key}`);
        if (sel) mapaUser[c.key] = sel.value;
      });
      const headerKey = headers.join('|').toLowerCase();
      const savedMaps = JSON.parse(localStorage.getItem('inv_col_map') || '{}');
      savedMaps[headerKey] = { mapa: mapaUser, arquivo, ts: Date.now() };
      const entries = Object.entries(savedMaps).sort((a,b) => (b[1].ts||0)-(a[1].ts||0)).slice(0,5);
      localStorage.setItem('inv_col_map', JSON.stringify(Object.fromEntries(entries)));
    } catch(e) {
      console.warn('[Mapper] Não foi possível salvar o mapeamento local:', e);
    }

    const mapperZone = document.getElementById('inv-mapper-zone');
    if (mapperZone) mapperZone.style.display = 'none';
    const endsU = [...new Set(base.map(r=>r.endereco).filter(Boolean))].length;
    const prodsU = [...new Set(base.map(r=>r.codigo_produto).filter(Boolean))].length;
    const fb = document.getElementById('inv-import-fb');
    if (fb) fb.innerHTML = `
      <div class="status-box ok">
        <div class="sb-icon">✅</div>
        <div>
          <div class="sb-text">${base.length.toLocaleString('pt-BR')} registros importados com mapeamento personalizado</div>
          <div class="sb-sub">${escHTML(arquivo)} · ${endsU} endereços únicos · ${prodsU} produtos únicos
            <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('inv-mapper-zone').style.display='block'" style="margin-left:8px;font-size:.7rem;padding:2px 8px">✏️ Editar mapeamento</button>
          </div>
        </div>
      </div>`;
    const selWrap = document.getElementById('inv-end-sel-wrap');
    if (selWrap) selWrap.style.display = 'block';
    const resumo = document.getElementById('inv-end-resumo-txt');
    if (resumo) resumo.textContent = `${endsU} endereços únicos da base serão incluídos automaticamente`;
    if (typeof habilitarBtnCriar === 'function') habilitarBtnCriar();
    if (typeof showToast === 'function') showToast(`✅ ${base.length.toLocaleString('pt-BR')} registros importados`, 's');
    return true;
  } catch (error) {
    console.error('[confirmarInvMapper]', error);
    const msg = 'Erro ao aplicar o mapeamento: ' + (error?.message || error);
    setStatus(msg, 'e');
    // Silenciado de propósito: invFbErr() já é chamado dentro do handler de
    // erro deste bloco (catch externo). Se ela própria lançar (ex.: elemento
    // de feedback ausente no DOM), não deve derrubar o fluxo de erro que já
    // está em andamento — o toast e o setStatus acima garantem que o usuário
    // é avisado mesmo que este log auxiliar falhe.
    try { invFbErr(msg); } catch (_) {}
    if (typeof showToast === 'function') showToast(msg, 'e');
    return false;
  } finally {
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = '✓ Aplicar Mapeamento e Importar';
    }
  }
}
window.confirmarInvMapper = confirmarInvMapper;

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


window.baixarModeloBaseInventarioClassificada=function(){const rows=[{endereco:'14.1520.1.5.1.1.1',pallete_ou_capa:'2907916',codigo_produto:'000123',descricao_produto:'PRODUTO EXEMPLO',gtin:'7890000000001',dun:'17890000000018',quantidade_esperada:100,total_unidades_sistema:1200,fator_caixa:12,tipo_produto:'PRODUTO DE VENDA',tipo_endereco:'FISICO',contabiliza_inventario:'SIM',permite_multiplos_operadores:'NAO',setor:'PRODUTO ACABADO',rua:'RUA 1',nivel:'1',lote_produto:'L001',validade:'31/12/2027',palete:'2907916'}];const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Base Inventario');XLSX.writeFile(wb,'modelo_base_inventario_classificada.xlsx')};
