// ═══════════════════════════════════════════════════
//  NUMERAÇÃO CAPA/PALETE
// ═══════════════════════════════════════════════════
function calcularProximoCapa() {
  // Pegar todos os números já usados: na sessão atual + na base (campo pallete_ou_capa)
  const numsContagens = APP.contagens
    .filter(c => !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA')
    .map(c => parseInt(c.capa))
    .filter(n => !isNaN(n));

  const numsBase = APP.base
    .map(r => parseInt(r.pallete_ou_capa || r.capa || 0))
    .filter(n => !isNaN(n) && n > 0);

  const todosUsados = new Set([...numsContagens, ...numsBase]);

  // Se o operador tem range definido, começar do início do range
  const range = APP.capaRange;
  if (range && range.min && range.max) {
    // Encontrar o próximo número disponível dentro do range
    for (let n = range.min; n <= range.max; n++) {
      if (!todosUsados.has(n)) return n;
    }
    // Range esgotado
    return range.max + 1;
  }

  // Sem range: pegar o maior usado + 1, respeitando início configurado (padrão = 1)
  const inicioBase = Math.max(1, parseInt(APP.inventario?.capa_inicio_base ?? APP.inventario?.capa_inicio ?? 1) || 1);
  const todos = [...numsContagens, ...numsBase];
  const maximo = todos.length ? Math.max(...todos) : (inicioBase - 1);
  return Math.max(inicioBase, maximo + 1);
}

function gerarNumeroCapa() {
  const n = APP.proximoCapa;
  document.getElementById('f-capa').value = String(n).padStart(3, '0');
  APP.atual.capaGerada = true;

  _atualizarHintCapa();
  document.getElementById('fb-capa').innerHTML = `<div class="fb info">⚡ Número ${n} gerado automaticamente</div>`;
  onCapaInput();
}

// ═══════════════════════════════════════════════════
//  FLUXO DE ETAPAS
// ═══════════════════════════════════════════════════
function updateSteps() {
  const s = APP.atual.step;

  // ── Indicador de progresso (dots) ──
  for (let i = 1; i <= 5; i++) {
    const dot  = document.getElementById('sd-' + i);
    const line = document.getElementById('sl-' + i);
    if (!dot) continue;
    if (i < s)        { dot.className = 'step-dot done';   dot.textContent = '✓'; }
    else if (i === s) { dot.className = 'step-dot active'; dot.textContent = i; }
    else              { dot.className = 'step-dot';        dot.textContent = i; }
    if (line) line.className = 'step-line' + (i < s ? ' done' : '');
  }

  // ── Mostrar / ocultar step-fields ──
  const ordem = ['step-endereco','step-capa','step-gtin','step-validade','step-quantidade'];
  ordem.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    const num = idx + 1; // etapa 1-based
    el.style.display = (s >= num) ? '' : 'none';

    // Classe ativo/done
    el.classList.remove('ativo', 'done');
    if (s === num) el.classList.add('ativo');
    else if (s > num) el.classList.add('done');
  });

  // ── Desabilitar inputs de etapas já concluídas ──
  const inputs = ['f-endereco','f-capa','f-gtin','f-validade'];
  inputs.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (el) el.disabled = (s > idx + 1);
  });

  // ── sf-val: mostrar valor confirmado inline na linha ──
  const a = APP.atual;
  _sfVal('step-endereco',  'sf-val-endereco',  a.step > 1, a.endereco);
  _sfVal('step-capa',      'sf-val-capa',      a.step > 2, a.capa);
  _sfVal('step-gtin',      'sf-val-gtin',      a.step > 3,
    a.produtoAtual?.descricao_produto ? a.produtoAtual.descricao_produto.slice(0,26) : a.gtin);
  _sfVal('step-validade',  'sf-val-validade',  a.step > 4, a.validade);

  // ── Botão END. VAZIO: aparece sempre que o endereço estiver confirmado,
  //    exceto quando o painel lote estiver ativo (tem seu próprio botão de encerrar)
  const vaziow = document.getElementById('btn-vazio-wrap');
  if (vaziow) {
    const loteAtivo = !!APP.lote; // painel lote assume o controle quando ativo
    vaziow.style.display = (!loteAtivo && (s >= 2 || (s === 1 && a.enderecoValido))) ? '' : 'none';
  }

  // ── Botão 🔄 reset: só aparece no primeiro pallet (sem pallets contados ainda) ──
  const btnReset = document.getElementById('btn-reset-endereco');
  if (btnReset && s > 1) {
    const endNorm = a._endNorm || a._pendingEndereco;
    const temPallets = endNorm && APP.contagens.some(c =>
      c.endereco === endNorm &&
      c.tipo_contagem !== 'VAZIO' &&
      !c._excluida &&
      c.status !== 'ESTORNADA' &&
      c.status !== 'EXCLUIDA'
    );
    btnReset.style.display = temPallets ? 'none' : '';
  }

  // resumo-atual não usado no novo layout
  const r = document.getElementById('resumo-atual');
  if (r) r.style.display = 'none';
}

/** Mostra o valor confirmado no sf-val e esconde o input na linha */
function _sfVal(stepId, valId, show, texto) {
  const stepEl = document.getElementById(stepId);
  const valEl  = document.getElementById(valId);
  if (!stepEl || !valEl) return;
  if (show && texto) {
    valEl.textContent = texto;
    valEl.style.display = '';
    const inp = stepEl.querySelector('.sf-input-wrap .field');
    if (inp) inp.style.display = 'none';
  } else {
    valEl.style.display = 'none';
    const inp = stepEl.querySelector('.sf-input-wrap .field');
    if (inp) inp.style.display = '';
  }
}

function atualizarResumo() {
  // Compatibilidade — toda a lógica foi absorvida por updateSteps()
  updateSteps();
}

