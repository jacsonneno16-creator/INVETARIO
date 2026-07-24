function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  7-B. IMPORTAÇÃO DE ENDEREÇOS (com capacidade_paletes)
// ───────────────────────────────────────────────────────────────────

const ALIAS_END = {
  endereco:           ['endereco','endereço','address','end','cod_end','codigo_end','endereço logístico'],
  loja:               ['loja','loja_id','store','filial','cod_loja'],
  local:              ['local','loc','localidade','pavilhao','pavilhão','galpao','galpão'],
  nome_local:         ['nome_local','nome_do_local','local_nome','descricao_local','local_descricao','nome_setor','setor_nome','area_nome','nome_area','local_estoque','estoque_local','deposito','depósito','armazem','armazém','descr_local','desc_local'],
  area:               ['area','área','area_id','zone','zona','sub_area'],
  rua:                ['rua','corredor','aisle','row','corredor_rua'],
  coluna:             ['coluna','col','column','col_id'],
  nivel:              ['nivel','nível','level','andar','lvl'],
  sequencia:          ['sequencia','sequência','seq','posicao','posição','pos'],
  observacao:         ['observacao','observação','obs','descricao','descrição','nota'],
  tipo:               ['tipo','type'],
  capacidade_paletes: ['capacidade_paletes','cap_paletes','capacidade','paletes','cap','capacidade_palete',
                       'qtd_paletes','qtd_palete','num_paletes','slots'],
  ativo:              ['ativo','active','status'],
};

// Definição dos campos para o mapeador de colunas
// pos: posição na montagem do endereço (1-7); null = campo extra não faz parte do código
const END_FIELDS = [
  { key:'loja',               label:'Loja',            pos:1, icon:'🏪', hint:'Código da loja/filial' },
  { key:'local',              label:'Local',           pos:2, icon:'🏭', hint:'Local / pavilhão' },
  { key:'area',               label:'Área',            pos:3, icon:'🗂', hint:'Área / setor' },
  { key:'rua',                label:'Rua',             pos:4, icon:'🛣', hint:'Corredor / rua' },
  { key:'coluna',             label:'Coluna',          pos:5, icon:'📏', hint:'Coluna' },
  { key:'nivel',              label:'Nível',           pos:6, icon:'📐', hint:'Nível / andar' },
  { key:'sequencia',          label:'Seq',             pos:7, icon:'🔢', hint:'Sequência' },
  { key:'endereco',           label:'Endereço pronto', pos:null, icon:'🔗', hint:'Coluna com endereço completo — sobrepõe os campos acima' },
  { key:'capacidade_paletes', label:'Cap. Paletes',    pos:null, icon:'🏗', hint:'Limite de paletes (0 = inativo)' },
  { key:'ativo',              label:'Ativo (0/1)',      pos:null, icon:'🟢', hint:'Sim/Não ou 1/0' },
  { key:'tipo',               label:'Tipo',            pos:null, icon:'🏷', hint:'ARMAZENAGEM, PISO, etc.' },
  { key:'observacao',         label:'Observação',      pos:null, icon:'📝', hint:'Notas livres' },
];

// Estado da importação em andamento
let _endImport = { headers: [], rows: [], filename: '' };

// Sequência interna de IDs dos endereços.
// A variável antiga `_idSeq` deixou de existir após a reestruturação e fazia a importação falhar.
let _enderecoIdSeq = null;
function _nextEnderecoId() {
  if (_enderecoIdSeq === null) {
    const ids = (state().enderecosLista || [])
      .map(e => parseInt(e && e.id, 10))
      .filter(n => Number.isFinite(n));
    _enderecoIdSeq = (ids.length ? Math.max.apply(null, ids) : 0) + 1;
  }
  return _enderecoIdSeq++;
}


// ── Helpers de drag/drop para endereços ──────────────────────────────────────
function endDover(e) { e.preventDefault(); document.getElementById('end-drop-zone').classList.add('drag'); }
function endDleave()  { document.getElementById('end-drop-zone').classList.remove('drag'); }
function endDdrop(e)  { e.preventDefault(); endDleave(); if (e.dataTransfer.files[0]) processFileEnd(e.dataTransfer.files[0]); }
function handleFileEnd(e) { if (e.target.files[0]) processFileEnd(e.target.files[0]); }

function resetEndImport() {
  _endImport = { headers: [], rows: [], filename: '' };
  document.getElementById('end-upload-zone').style.display = '';
  document.getElementById('end-mapper-zone').style.display = 'none';
  document.getElementById('end-import-fb').innerHTML = '';
  const btn = document.getElementById('btn-conf-end');
  if (btn) { btn.disabled = true; btn.textContent = '✓ Importar Endereços'; }
  const fi = document.getElementById('file-end');
  if (fi) fi.value = '';
}

function processFileEnd(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      let headers = [], rows = [];

      if (ext === 'csv') {
        // ── CSV — robusto (BOM + separador automático) ───────
        const parsed = parseCSVRobust(ev.target.result);
        if (!parsed.headers.length) { endFbErr('Arquivo CSV vazio.'); return; }
        headers = parsed.headers.map(h => String(h).trim());
        rows = parsed.rows.filter(r => r.some(c => String(c||'').trim()));
      } else {
        // ── XLSX / XLS ────────────────────────────────────────
        // Ler como array buffer (evita problema de encoding)
        let wb;
        try {
          wb = XLSX.read(ev.target.result, { type: 'array' });
        } catch(e1) {
          // fallback: tentar com Uint8Array
          wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        }
        const wsName = wb.SheetNames[0];
        if (!wsName) { endFbErr('Planilha sem abas detectadas.'); return; }
        const ws = wb.Sheets[wsName];
        // sheet_to_json com header:1 devolve array de arrays
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        if (!raw.length) { endFbErr('Planilha vazia.'); return; }
        // Primeira linha: headers
        headers = (raw[0] || []).map(h => String(h ?? '').trim());
        // Remover colunas completamente vazias
        const colsValidas = headers.map((h, i) => i).filter(i => {
          const header = headers[i];
          if (header) return true;
          // verificar se alguma linha tem valor nessa coluna
          return raw.slice(1).some(r => String(r[i] ?? '').trim() !== '');
        });
        headers = colsValidas.map(i => headers[i] || `Col${i+1}`);
        rows = raw.slice(1)
          .filter(r => r.some(c => String(c ?? '').trim() !== '')) // remover linhas vazias
          .map(r => colsValidas.map(i => String(r[i] ?? '').trim()));
      }

      if (!headers.length || !rows.length) { endFbErr('Nenhum dado encontrado no arquivo.'); return; }

      // Guardar estado e mostrar o mapeador
      _endImport = { headers, rows, filename: file.name };
      document.getElementById('end-upload-zone').style.display = 'none';
      document.getElementById('end-mapper-zone').style.display = '';
      renderColMapper();
      document.getElementById('end-import-fb').innerHTML = '';
      document.getElementById('btn-conf-end').disabled = false;
    } catch(err) {
      endFbErr('Erro ao ler arquivo: ' + err.message);
      console.error(err);
    }
  };
  if (ext === 'csv') reader.readAsText(file, 'UTF-8');
  else reader.readAsArrayBuffer(file);
}

function endFbErr(msg) {
  document.getElementById('end-import-fb').innerHTML =
    `<div class="status-box err"><div class="sb-icon">❌</div><div><div class="sb-text">Erro</div><div class="sb-sub">${msg}</div></div></div>`;
}

/** Detecta automaticamente qual coluna do arquivo mapeia para cada campo via ALIAS_END */
function autoDetectCols(headers) {
  const h = headers.map(x => x.toLowerCase().trim().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''));
  const mapping = {};
  Object.entries(ALIAS_END).forEach(([campo, aliases]) => {
    const idx = h.findIndex(hh => aliases.some(a => hh === a || hh.startsWith(a)));
    if (idx >= 0) mapping[campo] = idx;
  });
  return mapping;
}

/** Retorna o valor de um campo da linha raw conforme o select do mapper */
function _getMapVal(row, fieldKey) {
  const sel = document.getElementById(`map-sel-${fieldKey}`);
  if (!sel || sel.value === '') return '';
  const idx = parseInt(sel.value);
  if (isNaN(idx)) return '';
  return String(row[idx] ?? '').trim();
}

/** Monta o endereço a partir de uma linha raw usando os selects atuais do mapper */
function _buildAddrFromRow(row) {
  const end = _getMapVal(row, 'endereco');
  if (end) return { endereco: end, fromDirect: true, parts: (window.DTEnderecos?.partes(end).lista || []) };
  const parts = ['loja','local','area','rua','coluna','nivel','sequencia'].map(k => _getMapVal(row, k));
  const endereco = parts.filter(Boolean).join('.');
  return { endereco, fromDirect: false, parts };
}

function renderColMapper() {
  const { headers, rows, filename } = _endImport;
  const autoMap = autoDetectCols(headers);

  // Gerar opções para os selects (com exemplo da 1ª linha)
  const optsFor = (key) => {
    let detected = autoMap[key];
    return `<option value="">— não mapear —</option>` +
      headers.map((h, i) => {
        const ex = rows[0] ? String(rows[0][i] ?? '').trim().slice(0, 20) : '';
        const sel = (detected !== undefined && detected === i) ? ' selected' : '';
        return `<option value="${i}"${sel}>${h}${ex ? ` · ${ex}` : ''}</option>`;
      }).join('');
  };

  document.getElementById('end-mapper-content').innerHTML = `
    <div class="mapper-wrap">
      <div style="margin-bottom:10px">
        <div style="font-weight:700;font-size:.88rem">📄 ${filename}</div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:2px">${rows.length.toLocaleString('pt-BR')} linhas · ${headers.length} colunas detectadas</div>
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:.75rem;color:#1d4ed8">
        💡 O sistema extrai automaticamente as 7 partes do endereço separando pelo ponto <strong>(loja · local · área · rua · coluna · nível · seq)</strong>.<br>
        Você só precisa dizer <strong>qual coluna contém o endereço</strong> e <strong>qual contém a capacidade de paletes</strong>.
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text);margin-bottom:5px">
            🔗 Coluna do Endereço <span style="color:var(--danger)">*</span>
          </div>
          <select class="mapper-select" id="map-sel-endereco" onchange="updateMapperPreview()" style="width:100%">
            ${optsFor('endereco')}
          </select>
          <div id="map-ex-endereco" style="font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px">—</div>
        </div>
        <div>
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text);margin-bottom:5px">
            🏗 Capacidade de Paletes <span style="color:var(--danger)">*</span>
          </div>
          <select class="mapper-select" id="map-sel-capacidade_paletes" onchange="updateMapperPreview()" style="width:100%">
            ${optsFor('capacidade_paletes')}
          </select>
          <div id="map-ex-capacidade_paletes" style="font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px">—</div>
        </div>
        <div>
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:5px">
            🟢 Ativo (0/1) <span style="color:var(--muted);font-weight:400">opcional</span>
          </div>
          <select class="mapper-select" id="map-sel-ativo" onchange="updateMapperPreview()" style="width:100%">
            ${optsFor('ativo')}
          </select>
          <div id="map-ex-ativo" style="font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px">—</div>
        </div>
        <div>
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:5px">
            🏷 Tipo <span style="color:var(--muted);font-weight:400">opcional</span>
          </div>
          <select class="mapper-select" id="map-sel-tipo" onchange="updateMapperPreview()" style="width:100%">
            ${optsFor('tipo')}
          </select>
          <div id="map-ex-tipo" style="font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px">—</div>
        </div>
      </div>

      <div style="margin-bottom:12px;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#166534;margin-bottom:8px">
          🏭 Nome do Local de Estoque <span style="font-weight:400;color:#16a34a">— usado para agrupar e filtrar os endereços</span>
        </div>
        <select class="mapper-select" id="map-sel-nome_local" onchange="updateMapperPreview()" style="width:100%;border-color:#86efac">
          ${optsFor('nome_local')}
        </select>
        <div id="map-ex-nome_local" style="font-family:var(--mono);font-size:.7rem;color:#16a34a;margin-top:4px">—</div>
        <div style="font-size:.68rem;color:#4ade80;margin-top:3px">Se não selecionado, o sistema usará a parte numérica do endereço como agrupamento</div>
      </div>

      <div class="addr-preview-wrap" id="end-addr-preview">
        <div class="addr-preview-header">👁 Prévia — primeiros registros</div>
        <div style="padding:14px;text-align:center;color:var(--muted);font-size:.8rem">Selecione a coluna do endereço para ver a prévia</div>
      </div>
    </div>`;

  updateMapperPreview();
}

function updateMapperPreview() {
  const { rows } = _endImport;
  if (!rows.length) return;

  const SIMPLE_KEYS = ['endereco','capacidade_paletes','ativo','tipo','nome_local'];
  SIMPLE_KEYS.forEach(key => {
    const sel = document.getElementById(`map-sel-${key}`);
    const exEl = document.getElementById(`map-ex-${key}`);
    if (!sel || !exEl) return;
    if (sel.value === '') { exEl.textContent = '—'; return; }
    const idx = parseInt(sel.value);
    exEl.textContent = String(rows[0]?.[idx] ?? '').trim().slice(0, 30) || '(vazio)';
  });

  // Prévia com decomposição automática
  const PLABELS = ['Loja','Local','Área','Rua','Col','Nív','Seq'];
  const PCOLORS = ['#dbeafe','#dcfce7','#fef9c3','#fce7f3','#ede9fe','#ffedd5','#e0f2fe'];
  const PTXT    = ['#1d4ed8','#16a34a','#a16207','#be185d','#6d28d9','#c2410c','#0369a1'];

  const preview = rows.slice(0, 5);
  const rowsHtml = preview.map(row => {
    const { endereco } = _buildAddrFromRow(row);
    if (!endereco) return '';
    const parts = (window.DTEnderecos?.partes(endereco).lista || []);
    const capVal  = _getMapVal(row, 'capacidade_paletes');
    const ativoVal= _getMapVal(row, 'ativo');

    const partsHtml = parts.map((p, i) => p ? `
      <span class="addr-part" style="background:${PCOLORS[i]||'#f1f5f9'}">
        <span class="addr-part-lbl" style="color:${PTXT[i]||'#64748b'}">${PLABELS[i]||'P'+(i+1)}</span>
        <span class="addr-part-val" style="color:${PTXT[i]||'#1e293b'}">${p}</span>
      </span>` : '').join('');

    const nomeLocalVal = _getMapVal(row, 'nome_local');
    const extras = [];
    if (nomeLocalVal !== '') extras.push(`🏭 local: <strong>${nomeLocalVal}</strong>`);
    if (capVal !== '') extras.push(`🏗 cap: <strong>${capVal}</strong>`);
    if (ativoVal !== '') extras.push(`ativo: ${ativoVal}`);

    return `<div class="addr-preview-row">
      <div class="addr-code">${endereco}
        ${extras.length ? `<span style="font-size:.68rem;color:var(--muted);font-weight:400;margin-left:8px">${extras.join(' · ')}</span>` : ''}
      </div>
      <div class="addr-parts">${partsHtml || '<span style="font-size:.72rem;color:var(--warn)">⚠️ Endereço sem partes reconhecidas — verifique o separador "."</span>'}</div>
    </div>`;
  }).filter(Boolean).join('');

  document.getElementById('end-addr-preview').innerHTML = `
    <div class="addr-preview-header">👁 Prévia — primeiros ${preview.length} registros (decomposição automática por ".")</div>
    ${rowsHtml || '<div style="padding:14px;text-align:center;color:var(--muted);font-size:.8rem">Selecione a coluna do endereço para ver a prévia</div>'}`;
}

function confirmarImportEnderecos() {
  const { rows } = _endImport;
  if (!rows.length) { showToast('Nenhum arquivo carregado', 'e'); return; }

  // Validar campo obrigatório — endereço
  const selEnd = document.getElementById('map-sel-endereco');
  if (!selEnd || selEnd.value === '') {
    showToast('⚠️ Selecione a coluna do Endereço antes de importar', 'w'); return;
  }

  const PLABELS = ['loja','local','area','rua','coluna','nivel','sequencia'];
  const built = [];

  rows.forEach(row => {
    // Ler endereço diretamente da coluna mapeada
    const endIdx = parseInt(document.getElementById('map-sel-endereco').value);
    const endereco = String(row[endIdx] ?? '').trim();
    if (!endereco) return;

    // Decompor automaticamente pelo separador "."
    const ep = window.DTEnderecos?.partes(endereco) || {};
    const loja      = ep.loja || '';
    const local     = ep.local || '';
    const area      = ep.area || '';
    const rua       = ep.rua || '';
    const coluna    = ep.coluna || '';
    const nivel     = ep.nivel || '';
    const sequencia = ep.sequencia || '';

    // ── Capacidade de paletes ─────────────────────────────────────────
    // Ler diretamente do índice mapeado (não via _getMapVal que usa o select pelo id key)
    let cap = null;
    const selCap = document.getElementById('map-sel-capacidade_paletes');
    if (selCap && selCap.value !== '') {
      const capIdx = parseInt(selCap.value);
      const rawCap = String(row[capIdx] ?? '').trim().replace(',', '.').replace(/[^\d]/g, '');
      if (rawCap !== '') {
        const n = parseInt(rawCap, 10);
        if (!isNaN(n) && n >= 0) cap = n;
      }
    }

    // ── Status ativo ──────────────────────────────────────────────────
    let ativo = true;
    const selAtivo = document.getElementById('map-sel-ativo');
    if (selAtivo && selAtivo.value !== '') {
      const rawAtivo = String(row[parseInt(selAtivo.value)] ?? '').trim().toLowerCase();
      if (rawAtivo !== '') {
        ativo = !['0','false','não','nao','inativo','n','no'].includes(rawAtivo);
      }
    }
    if (cap === 0) ativo = false;

    // ── Tipo ──────────────────────────────────────────────────────────
    let tipo = 'ARMAZENAGEM';
    const selTipo = document.getElementById('map-sel-tipo');
    if (selTipo && selTipo.value !== '') {
      const rawTipo = String(row[parseInt(selTipo.value)] ?? '').trim().toUpperCase();
      if (rawTipo) tipo = rawTipo;
    }

    // ── Nome do Local de Estoque ──────────────────────────────────────
    let nomeLocal = '';
    const selNomeLocal = document.getElementById('map-sel-nome_local');
    if (selNomeLocal && selNomeLocal.value !== '') {
      nomeLocal = String(row[parseInt(selNomeLocal.value)] ?? '').trim();
    }

    built.push({
      id:                 _nextEnderecoId(),
      endereco,
      loja, local, area, rua, coluna, nivel, sequencia,
      local_area:         local || area || '',
      nome_local:         nomeLocal,
      tipo,
      observacao:         '',
      capacidade_paletes: cap,
      ativo,
      setor:              nomeLocal || local || area || 'SEM LOCAL',
    });
  });

  if (!built.length) { showToast('⚠️ Nenhum endereços válido encontrado', 'w'); return; }

  // Se há endereços existentes E nenhum nome_local foi selecionado, avisar
  const temNomeLocal = built.some(e => e.nome_local);
  const existentes = state().enderecosLista.length;
  if (existentes > 0 && !temNomeLocal) {
    showConfirm('Você não selecionou a coluna "Nome do Local de Estoque". Sem isso, os endereços serão agrupados pelo número do endereço (ex: 1520, 1540...). Deseja continuar assim mesmo?', () => _finalizarImportacaoEnderecos(built), { title: "⚠️ Sem Nome do Local", icon: "⚠️", okLabel: "Continuar assim mesmo", okClass: "btn-warn" }); return;
  }
  // Caminho normal: tudo certo, importar diretamente
  _finalizarImportacaoEnderecos(built);
}

async function _finalizarImportacaoEnderecos(built) {
  built.forEach(e => _addEndDB(e));

  const totalImport = built.length;
  const inativos = state().enderecosLista.filter(e => !e.ativo).length;
  const capZero  = state().enderecosLista.filter(e => e.capacidade_paletes === 0).length;
  const semCap   = state().enderecosLista.filter(e => e.capacidade_paletes === null).length;

  window.AnalistaState.set('enderecosTemp', [], { source: 'finalizarImportacaoEnderecos' });
  storageSave(KEYS.enderecos, state().enderecosLista);
  atualizarEnderecos();
  closeModal('modal-end-import');
  resetEndImport();

  const btn = document.getElementById('btn-conf-end');
  if (btn) btn.disabled = true;

  logSistema('ENDERECO', `${totalImport} endereços importados (${inativos} inativos, ${capZero} cap=0, ${semCap} sem cap)`, {});

  // Publicar imediatamente para o coletor. Antes, a importação ficava apenas no navegador
  // do analista e o coletor continuava enxergando a base vazia até uma sincronização manual.
  if (typeof window.fsPublicarEnderecos === 'function' && navigator.onLine) {
    try {
      showToast(`⏳ ${totalImport.toLocaleString('pt-BR')} endereços importados. Publicando para os coletores...`, 'w');
      await window.fsPublicarEnderecos();
      showToast(`✅ ${totalImport.toLocaleString('pt-BR')} endereços importados e publicados para os coletores`, 's');
    } catch (pubErr) {
      console.error('[Importação Endereços] Falha ao publicar:', pubErr);
      showToast(`⚠️ Endereços importados no analista, mas a publicação para o coletor falhou: ${pubErr.message || pubErr}`, 'w');
    }
  } else {
    showToast(`✅ ${totalImport.toLocaleString('pt-BR')} endereços importados${capZero ? ` · ${capZero} inativos (cap=0)` : ''}${semCap ? ` · ${semCap} sem cap` : ''}`, 's');
  }
}

/**
 * Adiciona um endereço ao ENDDB (memória).
 * Regra de negócio:
 *   - capacidade_paletes não informada → default null (sem limite definido)
 *   - capacidade_paletes = 0 → força ativo = false (endereço inativo para operação)
 *   - capacidade_paletes > 0 → mantém o valor; ativo não é alterado por aqui
 */
function _addEndDB(e) {
  // Suporte à estrutura de 7 partes: loja.local.area.rua.coluna.nivel.seq
  // setor = campo de agrupamento (local > area > local_area > setor)
  const setor = e.nome_local || e.setor || e.local || e.area || e.local_area || 'SEM LOCAL';

  // Auto-extrair rua do código do endereço se não vier explicitamente
  // Estrutura: loja.local.area.rua.col.niv.seq → rua = partes[3]
  const ep = window.DTEnderecos?.partes(e.endereco) || {};
  let ruaFinal = e.rua || ep.rua || '';

  // Auto-extrair nome_local do código se não vier explicitamente
  // local = partes[1] (posição 1: loja.LOCAL.area.rua...)
  let nomLocalFinal = e.nome_local || e.local_area || e.local || ep.local || '';

  // Normalizar capacidade_paletes
  let cap = e.capacidade_paletes;
  if (cap !== undefined && cap !== null && cap !== '') {
    cap = parseInt(cap, 10);
    if (isNaN(cap)) cap = null;
  } else {
    cap = null;
  }

  // Regra: cap === 0 → forçar inativo
  let ativo = e.ativo !== undefined ? Boolean(e.ativo) : true;
  if (cap === 0) ativo = false;

  const obj = {
    ...e,
    id:                 e.id || _nextEnderecoId(),
    setor,
    rua:                ruaFinal,
    nome_local:         nomLocalFinal,
    local_area:         e.local || e.area || e.local_area || nomLocalFinal,
    capacidade_paletes: cap,
    ativo,
  };

  // Upsert: se já existe, atualiza; senão, insere
  const existIdx = state().enderecosLista.findIndex(x => x.endereco === e.endereco);
  if (existIdx >= 0) {
    // Remover do porSetor antigo
    const setorAntigo = state().enderecosLista[existIdx].setor;
    if (state().enderecosPorSetor[setorAntigo]) {
      state().enderecosPorSetor[setorAntigo] = state().enderecosPorSetor[setorAntigo].filter(x => x.endereco !== e.endereco);
      if (!state().enderecosPorSetor[setorAntigo].length) delete state().enderecosPorSetor[setorAntigo];
    }
    obj.id = state().enderecosLista[existIdx].id; // Preservar id
    state().enderecosLista[existIdx] = obj;
  } else {
    window.AnalistaState.replaceSlice('enderecosLista', [...(state().enderecosLista || []), obj], { source: 'addEnderecoDB' });
  }
  // Inserir/atualizar no porSetor novo
  if (!state().enderecosPorSetor[setor]) state().enderecosPorSetor[setor] = [];
  const posSetor = state().enderecosPorSetor[setor].findIndex(x => x.endereco === e.endereco);
  if (posSetor >= 0) state().enderecosPorSetor[setor][posSetor] = obj;
  else state().enderecosPorSetor[setor].push(obj);
}

// Endereço manual
function previewNem() {
  const vals = ['nem-loja','nem-local','nem-area','nem-rua','nem-coluna','nem-nivel','nem-seq'].map(id => document.getElementById(id)?.value.trim() || '');
  document.getElementById('nem-preview').textContent = vals.filter(Boolean).join('.') || '—';
}

function salvarEnderecoManual() {
  const loja  = document.getElementById('nem-loja').value.trim();
  const local = document.getElementById('nem-local').value.trim();
  const area  = document.getElementById('nem-area').value.trim();
  const rua   = document.getElementById('nem-rua').value.trim();
  const col   = document.getElementById('nem-coluna').value.trim();
  const nivel = document.getElementById('nem-nivel').value.trim();
  const seq   = document.getElementById('nem-seq').value.trim();
  if (!loja || !local || !rua) { showToast('Preencha loja, local e rua', 'e'); return; }
  const endereco = [loja, local, area, rua, col, nivel, seq].filter(Boolean).join('.');
  if (state().enderecosLista.some(e => e.endereco === endereco)) { showToast('Endereço já cadastrado', 'w'); return; }

  // Capacidade de paletes
  let cap = null;
  const capRaw = document.getElementById('nem-cap')?.value?.trim();
  if (capRaw !== '' && capRaw !== undefined) {
    cap = parseInt(capRaw, 10);
    if (isNaN(cap) || cap < 0) { showToast('Capacidade inválida (use 0 ou número positivo)', 'e'); return; }
  }

  // cap = 0 → força inativo
  let ativo = document.getElementById('nem-ativo').value === '1';
  if (cap === 0) ativo = false;

  const nomeLocal = document.getElementById('nem-nome-local')?.value.trim() || '';
  const obj = {
    id: _nextEnderecoId(), endereco,
    loja, local, area,
    local_area: local || area || '',   // campo legado
    nome_local: nomeLocal,
    rua, coluna: col, nivel, sequencia: seq,
    tipo:               document.getElementById('nem-tipo').value,
    ativo,
    capacidade_paletes: cap,
    observacao:         document.getElementById('nem-obs').value.trim(),
    setor:              nomeLocal || local || area || 'SEM LOCAL',
  };
  _addEndDB(obj);
  storageSave(KEYS.enderecos, state().enderecosLista);
  atualizarEnderecos();
  closeModal('modal-end-manual');
  logSistema('ENDERECO', `Endereço ${endereco} cadastrado manualmente (cap=${cap ?? 'N/A'}, ativo=${ativo})`, {});
  showToast(`✅ Endereço ${endereco} salvo!${cap === 0 ? ' (inativo — capacidade 0)' : ''}`, 's');
}

// Seleção de endereços para inventário
function abrirSelecaoEnderecos() {
  window.AnalistaState.set('ui.selecionadosSetores', new Set(Object.keys(state().enderecosPorSetor)), { source: 'selecionarTodosSetores' });
  document.getElementById('sel-end-busca').value = '';
  renderSelEnd();
  openModal('modal-sel-end');
}

function renderSelEnd() {
  const busca = (document.getElementById('sel-end-busca')?.value || '').toLowerCase().trim();
  const lista = document.getElementById('sel-end-lista');
  const setores = Object.keys(state().enderecosPorSetor).sort();
  const filtrados = busca ? setores.filter(s => s.toLowerCase().includes(busca) || state().enderecosPorSetor[s].some(e => e.endereco.toLowerCase().includes(busca))) : setores;

  if (!filtrados.length) {
    lista.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-size:.82rem">Nenhum local encontrado</div>`;
    atualizarContSelEnd(); return;
  }
  lista.innerHTML = filtrados.map(setor => {
    const count = state().enderecosPorSetor[setor].length;
    const ativo = state().ui.selecionadosSetores.has(setor);
    return `<div onclick="toggleSelSetor('${setor.replace(/'/g,"\\'")}',this)"
      style="display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);cursor:pointer;background:${ativo?'#eff6ff':'#fff'};transition:background .12s">
      <div style="width:18px;height:18px;border-radius:4px;border:2px solid ${ativo?'var(--accent)':'#d1d5db'};background:${ativo?'var(--accent)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${ativo?'<span style="color:#fff;font-size:10px;font-weight:800">✓</span>':''}
      </div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:.83rem">${setor}</div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:1px">${count} endereços</div>
      </div>
      <span class="badge ${ativo?'b-blue':'b-gray'}">${count}</span>
    </div>`;
  }).join('');
  atualizarContSelEnd();
}

function toggleSelSetor(setor) {
  const nextSelecionados = new Set(Array.from(state().ui.selecionadosSetores || []));
  if (nextSelecionados.has(setor)) nextSelecionados.delete(setor);
  else nextSelecionados.add(setor);
  window.AnalistaState.set('ui.selecionadosSetores', nextSelecionados, { source: 'toggleSetor' });
  renderSelEnd();
}

function selecionarTodosEnd(v) {
  window.AnalistaState.set('ui.selecionadosSetores', v ? new Set(Object.keys(state().enderecosPorSetor)) : new Set(), { source: 'toggleTodosSetores' });
  renderSelEnd();
}

function atualizarContSelEnd() {
  const total = [...state().ui.selecionadosSetores].reduce((a, s) => a + (state().enderecosPorSetor[s]?.length || 0), 0);
  document.getElementById('sel-end-count').textContent = `${total.toLocaleString('pt-BR')} endereços selecionados de ${state().ui.selecionadosSetores.size} local(is)`;
}

function confirmarSelecaoEnderecos() {
  const ends = [];
  state().ui.selecionadosSetores.forEach(s => { if (state().enderecosPorSetor[s]) ends.push(...state().enderecosPorSetor[s]); });
  if (state().ui.inventarioImportCtx) {
    // Atualizar resumo no modal de novo inventário
    document.getElementById('inv-end-resumo-txt').textContent = `${ends.length} endereços de ${state().ui.selecionadosSetores.size} local(is) selecionados`;
  }
  closeModal('modal-sel-end');
  showToast(`✅ ${ends.length.toLocaleString('pt-BR')} endereços selecionados!`, 's');
}

// ───────────────────────────────────────────────────────────────────

// Exportação da Base Geral de Endereços.
// O botão já existia no HTML, mas a função não estava definida.
function exportarEnderecos() {
  const lista = (state().enderecosLista || []).slice();
  if (!lista.length) {
    showToast('Nenhum endereço para exportar', 'w');
    return;
  }

  const dados = lista.map(e => ({
    'Endereço': e.endereco || '',
    'Loja': e.loja || '',
    'Local': e.local || '',
    'Nome do Local': e.nome_local || '',
    'Área': e.area || '',
    'Rua': e.rua || '',
    'Coluna': e.coluna || '',
    'Nível': e.nivel || '',
    'Sequência': e.sequencia || '',
    'Tipo': e.tipo || '',
    'Capacidade Paletes': e.capacidade_paletes === null || e.capacidade_paletes === undefined ? '' : e.capacidade_paletes,
    'Ativo': e.ativo === false ? 'NÃO' : 'SIM',
    'Observação': e.observacao || ''
  }));

  try {
    if (window.XLSX && XLSX.utils && XLSX.writeFile) {
      const ws = XLSX.utils.json_to_sheet(dados);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Endereços');
      XLSX.writeFile(wb, 'base_geral_enderecos.xlsx');
    } else {
      const headers = Object.keys(dados[0]);
      const csv = [headers.join(';')].concat(dados.map(row => headers.map(h => {
        const v = String(row[h] ?? '').replace(/"/g, '""');
        return `"${v}"`;
      }).join(';'))).join('\r\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'base_geral_enderecos.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    }
    showToast(`⬇ ${lista.length.toLocaleString('pt-BR')} endereços exportados`, 's');
  } catch (err) {
    console.error('[exportarEnderecos]', err);
    showToast('Erro ao exportar endereços: ' + (err.message || err), 'e');
  }
}
