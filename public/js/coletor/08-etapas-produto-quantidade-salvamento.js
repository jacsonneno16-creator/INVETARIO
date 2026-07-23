// ═══════════════════════════════════════════════════
//  ETAPA 2: CAPA/PALETE
// ═══════════════════════════════════════════════════
function _capaNumero(val) {
  if (!/^\d+$/.test(String(val || '').trim())) return NaN;
  return parseInt(String(val).trim(), 10);
}

function _capaExisteNaBase(val) {
  const alvo = String(val || '').trim().replace(/^0+(?=\d)/, '');
  if (!alvo) return false;
  return (APP.base || []).some(r => {
    const bruto = r.pallete_ou_capa ?? r.capa_palete ?? r.capa ?? r.palete_key ?? r.pallet ?? '';
    return String(bruto).trim().replace(/^0+(?=\d)/, '') === alvo;
  });
}

function _validarCapaInformada(val) {
  const n = _capaNumero(val);
  if (!val || isNaN(n) || n < 1) return { ok:false, msg:'Capa Palete inválida' };

  // Capa já existente na base do inventário: aceita normalmente, mesmo fora do range.
  if (_capaExisteNaBase(val)) return { ok:true, existente:true, n };

  // Capa não encontrada na base: só pode ser uma capa nova dentro do range reservado.
  const range = APP.capaRange;
  if (!range || !range.min || !range.max) return { ok:false, msg:'Range do operador ainda não foi reservado. Atualize a base e tente novamente.' };
  if (n < range.min || n > range.max) return { ok:false, msg:`Capa não encontrada no inventário e fora do seu range (${String(range.min).padStart(3,'0')}–${String(range.max).padStart(3,'0')})` };
  return { ok:true, existente:false, nova:true, n };
}

function onCapaInput() {
  const elCapa = document.getElementById('f-capa');
  elCapa.value = elCapa.value.replace(/\D/g, '').slice(0, 7);
  const val = elCapa.value.trim();
  const fb = document.getElementById('fb-capa');
  if (!val) { fb.innerHTML = ''; APP.atual.capaGerada = false; return; }

  const v = _validarCapaInformada(val);
  if (!v.ok) {
    fb.innerHTML = `<div class="fb err">✗ ${v.msg}</div>`;
    elCapa.className = 'field field-err';
    return;
  }
  fb.innerHTML = v.existente
    ? `<div class="fb ok">✓ Capa existente no inventário: ${val}</div>`
    : `<div class="fb info">⚡ Nova capa dentro do seu range: ${String(v.n).padStart(3,'0')}</div>`;
  elCapa.className = 'field field-ok';
}

function confirmarCapa() {
  const input = document.getElementById('f-capa');
  const val = input.value.trim();
  const v = _validarCapaInformada(val);
  if (!v.ok) { toast(v.msg, 'e'); beepErr(); return; }

  const capaFinal = v.existente ? val : String(v.n).padStart(3, '0');
  input.value = capaFinal;
  beepSuave();
  APP.atual.capa = capaFinal;
  APP.atual.capaGerada = !!v.nova;
  APP.atual.step = 3;

  if (APP.atual.somentesDun) {
    document.getElementById('gtin-label').textContent = '🔢 Etapa 3 — DUN (obrigatório)';
    document.getElementById('gtin-sublabel').textContent = 'Este endereço só aceita DUN';
    const _glt = document.getElementById('gtin-label-txt'); if (_glt) _glt.textContent = 'DUN (obrigatório)';
    document.getElementById('f-gtin').placeholder = 'DUN (14 dígitos)';
  } else {
    document.getElementById('gtin-label').textContent = '🔢 Etapa 3 — GTIN / DUN';
    document.getElementById('gtin-sublabel').textContent = 'Bipe ou digite o código';
    const _glt2 = document.getElementById('gtin-label-txt'); if (_glt2) _glt2.textContent = 'GTIN / DUN';
    document.getElementById('f-gtin').placeholder = 'GTIN (13) ou DUN (14)';
  }
  document.getElementById('f-gtin').value = '';
  document.getElementById('fb-gtin').innerHTML = '';
  document.getElementById('prod-found-box').style.display = 'none';
  updateSteps();
  setTimeout(() => document.getElementById('f-gtin').focus(), 100);
}

// ═══════════════════════════════════════════════════
//  ETAPA 3: GTIN / DUN  (melhoria 2: usa base normalizada)
// ═══════════════════════════════════════════════════
function onGtinInput() {
  const val  = document.getElementById('f-gtin').value.trim();
  const fb   = document.getElementById('fb-gtin');
  const pbox = document.getElementById('prod-found-box');
  if (!val) { fb.innerHTML = ''; pbox.style.display='none'; APP.atual.produtoAtual=null; return; }

  const isDun = val.length === 14;

  if (APP.atual.somentesDun && !isDun) {
    fb.innerHTML = `<div class="fb err">✗ Este endereço só aceita DUN (14 dígitos). Digitado: ${val.length}</div>`;
    document.getElementById('f-gtin').className = 'field icon-r field-err';
    APP.atual.produtoAtual = null; pbox.style.display='none'; return;
  }

  if (APP.base.length) {
    // Busca com normalização forte — elimina diferenças de case/espaços do scanner
    const valNorm = normProd(val);
    const _match = r =>
      normProd(r.gtin)           === valNorm ||
      normProd(r.dun)            === valNorm ||
      normProd(r.codigo_produto) === valNorm;
    const reg = APP.base.find(_match);
    if (reg) {
      APP.atual.produtoAtual = reg;

      // Verificar divergência de endereço usando _end
      const endNorm = APP.atual._endNorm || _normStr(APP.atual.endereco);
      const pertenceAoEnd = APP.base.some(r => r._end === endNorm && _match(r));
      APP.atual.produtoDivergenteEnd = endNorm && !pertenceAoEnd;

      if (APP.atual.produtoDivergenteEnd) {
        fb.innerHTML = `<div class="fb warn">⚠ Produto fora deste endereço — será avaliado pelo analista</div>`;
        document.getElementById('f-gtin').className = 'field icon-r field-warn';
        // ► SEM SOM AQUI — o som forte toca em confirmarGtin() quando Enter chega
      } else {
        fb.innerHTML = `<div class="fb ok">✓ Produto encontrado na base</div>`;
        document.getElementById('f-gtin').className = 'field icon-r field-ok';
        // ► SEM SOM AQUI — o som suave toca em confirmarGtin() quando Enter chega
      }

      pbox.style.display = '';
      pbox.innerHTML = `
        <div class="prod-card">
          <div class="prod-icon">📦</div>
          <div>
            <div class="prod-name">${reg.descricao_produto||'—'}</div>
            <div class="prod-code">${reg.codigo_produto||''} · ${isDun?'DUN':'GTIN'}: ${val}</div>
          </div>
        </div>`;
    } else {
      APP.atual.produtoAtual = null;
      APP.atual.produtoDivergenteEnd = false;
      fb.innerHTML = `<div class="fb err">✗ Código não encontrado na base</div>`;
      document.getElementById('f-gtin').className = 'field icon-r field-err';
      pbox.style.display = 'none';
      // ► SEM SOM AQUI — o som toca em confirmarGtin() quando Enter chega
    }
  } else {
    fb.innerHTML = `<div class="fb warn" style="flex-direction:column;align-items:flex-start;gap:6px">
      <b>⚠ Base não carregada</b>
      <span style="font-size:.72rem">Volte e selecione o inventário para baixar a base.</span>
      <button onclick="voltarInventarios()" style="padding:5px 12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;margin-top:2px">↩ Recarregar</button>
    </div>`;
    APP.atual.produtoAtual = { descricao_produto: 'Código sem cadastro', codigo_produto: val, gtin: val };
    APP.atual.produtoDivergenteEnd = false;
    pbox.style.display = 'none';
  }
}

function confirmarGtin() {
  const val = document.getElementById('f-gtin').value.trim();
  if (!val) { toast('Informe o código', 'e'); beepErr(); return; }
  if (APP.atual.somentesDun && val.length !== 14) {
    toast('Este endereço só aceita DUN (14 dígitos)', 'e'); beepErr(); return;
  }

  // Se produto não encontrado na base, avisa mas DEIXA PROSSEGUIR
  if (!APP.atual.produtoAtual && APP.base.length) {
    // Registrar como produto não identificado — não bloqueia
    APP.atual.produtoAtual = {
      descricao_produto: 'Código sem cadastro',
      codigo_produto: normProd(val),
      gtin:           normProd(val),
      _nao_encontrado: true
    };
    APP.atual.produtoDivergenteEnd = false;
    toast('⚠ Código não está na base — registrando assim mesmo', 'w');
    // sem beep — não é erro, é aviso; o beep correto vem abaixo
  }

  // ── Som: depende se o produto pertence ou não ao endereço ──────────────
  // APP.atual.produtoDivergenteEnd já foi calculado por onGtinInput()
  if (APP.atual.produtoDivergenteEnd) {
    beepErroForte(); // ✗ produto bipado não pertence ao endereço informado
  } else if (APP.atual.produtoAtual && !APP.atual.produtoAtual._nao_encontrado) {
    beepSuave();     // ✓ produto correto para este endereço
  }
  // ────────────────────────────────────────────────────────────────────────

  APP.atual.gtin = normProd(val);
  APP.atual.step = 4;

  document.getElementById('f-validade').value = '';
  document.getElementById('fb-validade').innerHTML = '';

  updateSteps();
  setTimeout(() => document.getElementById('f-validade').focus(), 100);
}

// ═══════════════════════════════════════════════════
//  ETAPA 4: VALIDADE  (DD/MM/AAAA)
// ═══════════════════════════════════════════════════
function onValidadeInput() {
  let raw = document.getElementById('f-validade').value.replace(/\D/g,'');
  // Formatar como DD/MM/AAAA
  let fmt = '';
  if (raw.length > 0) fmt  = raw.slice(0,2);
  if (raw.length > 2) fmt += '/' + raw.slice(2,4);
  if (raw.length > 4) fmt += '/' + raw.slice(4,8);
  document.getElementById('f-validade').value = fmt;

  const fb = document.getElementById('fb-validade');
  if (fmt.length < 10) { fb.innerHTML = ''; return; }

  const [dd, mm, aaaa] = fmt.split('/').map(Number);
  const dataVal = new Date(aaaa, mm - 1, dd);
  const hoje    = new Date(); hoje.setHours(0,0,0,0);

  if (!dd || dd < 1 || dd > 31 || !mm || mm < 1 || mm > 12 || !aaaa || aaaa < 2000
      || isNaN(dataVal.getTime()) || dataVal.getDate() !== dd) {
    fb.innerHTML = `<div class="fb err">✗ Data inválida — use DD/MM/AAAA</div>`;
    document.getElementById('f-validade').className = 'field field-err'; return;
  }

  if (dataVal < hoje) {
    fb.innerHTML = `<div class="fb err">✗ Validade no passado — produto vencido!</div>`;
    document.getElementById('f-validade').className = 'field field-err'; return;
  }

  const maxData = new Date(hoje.getFullYear() + 5, hoje.getMonth(), hoje.getDate());
  if (dataVal > maxData) {
    fb.innerHTML = `<div class="fb warn">⚠ Validade muito distante — confirme se está correta</div>`;
    document.getElementById('f-validade').className = 'field field-warn'; return;
  }

  const diasRestantes = Math.round((dataVal - hoje) / 86400000);
  const aviso = diasRestantes <= 90 ? ` · ⚠ Vence em ${diasRestantes} dia(s)` : '';
  fb.innerHTML = `<div class="fb ok">✓ Válido até ${fmt}${aviso}</div>`;
  document.getElementById('f-validade').className = 'field field-ok';

  // Auto-avança se digitou os 10 chars (DD/MM/AAAA) e data é válida
  if (fmt.length === 10 && !aviso.includes('⚠')) {
    setTimeout(() => confirmarValidade(), 300);
  }
}

function confirmarValidade() {
  const val = document.getElementById('f-validade').value;
  if (val.length < 10) { toast('Informe a validade completa (DD/MM/AAAA)', 'e'); beepErr(); return; }
  const [dd, mm, aaaa] = val.split('/').map(Number);
  const dataVal = new Date(aaaa, mm - 1, dd);
  const hoje    = new Date(); hoje.setHours(0,0,0,0);
  if (!dd || dd < 1 || dd > 31 || !mm || mm < 1 || mm > 12 || !aaaa || aaaa < 2000
      || isNaN(dataVal.getTime()) || dataVal.getDate() !== dd) {
    toast('Data inválida (DD/MM/AAAA)', 'e'); beepErr(); return;
  }
  if (dataVal < hoje) { toast('Produto vencido!', 'e'); beepErr(); return; }
  APP.atual.validade = val;
  APP.atual.step = 5;
  beepOk();
  _calcExpr = '';
  _calcResultado = null;
  _calcMode = false;
  document.getElementById('f-qty').value = '';   // vazio — operador deve digitar
  // Esconder calculadora ao entrar na etapa
  const cw = document.getElementById('calc-wrap');
  if (cw) cw.style.display = 'none';
  updateSteps();
  setTimeout(() => document.getElementById('f-qty').focus(), 100);
}

// ═══════════════════════════════════════════════════
//  ETAPA 5: QUANTIDADE + CALCULADORA
// ═══════════════════════════════════════════════════
function _onQtyInput() {
  // Sincroniza digitação manual no campo f-qty com _calcExpr e _calcResultado
  const val = (document.getElementById('f-qty')?.value || '').trim();
  if (val === '') {
    _calcExpr = '';
    _calcResultado = null;
    return;
  }
  // Se não tem operador, é um número puro — atualizar resultado
  if (/^\d+$/.test(val)) {
    _calcExpr = val;
    _calcResultado = parseInt(val);
  } else {
    // Tem expressão — guardar como expr mas não calcular ainda
    _calcExpr = val;
  }
}

function changeQty(d) {
  // Se calculadora estiver ativa, não interfere
  if (_calcMode) return;
  const f = document.getElementById('f-qty');
  const cur = parseInt(f.value || '0');
  const novo = Math.max(0, cur + d);
  f.value = String(novo);
  _calcExpr = String(novo);
  _calcResultado = novo;
}

function mostrarCalculadora() {
  const cw = document.getElementById('calc-wrap');
  if (cw) cw.style.display = '';
}

function toggleCalculadora() {
  const cw = document.getElementById('calc-wrap');
  if (!cw) return;
  const aberta = cw.style.display !== 'none';
  if (aberta) {
    // Fechar: se tem resultado, confirma no campo; desativa modo calc
    cw.style.display = 'none';
    _calcMode = false;
    // Se campo tem expressão incompleta, limpar
    if (_calcExpr && /[+\-*/]/.test(_calcExpr.slice(-1))) {
      _calcExpr = '';
      if (_calcResultado !== null) _qtyDisplay(String(_calcResultado));
      else _qtyDisplay('');
    }
  } else {
    // Abrir: ativar modo calc
    cw.style.display = '';
    _calcMode = true;
    // Se campo já tem número, usa como ponto de partida
    const cur = document.getElementById('f-qty').value;
    if (cur && !isNaN(parseInt(cur))) {
      _calcExpr = cur;
      _calcResultado = parseInt(cur);
    } else {
      _calcExpr = '';
      _calcResultado = null;
      _qtyDisplay('');
    }
  }
}

// ═══════════════════════════════════════════════════
//  ETAPA 5: CALCULADORA  (usa f-qty como display)
// ═══════════════════════════════════════════════════
let _calcExpr = '';          // expressão em construção
let _calcResultado = null;   // último resultado confirmado
let _calcMode = false;       // true enquanto calculadora estiver aberta

function _qtyDisplay(val) {
  const el = document.getElementById('f-qty');
  if (el) el.value = val;
}

function calcNum(n) {
  // Se acabou de calcular um resultado e digita número novo, recomeça
  if (_calcResultado !== null && _calcExpr === '') {
    _calcResultado = null;
  }
  _calcExpr += n;
  _qtyDisplay(_calcExpr);
}

function calcOp(op) {
  // Se expressão vazia mas tem resultado anterior, continua a partir dele
  if (!_calcExpr && _calcResultado !== null) {
    _calcExpr = String(_calcResultado);
  }
  _calcExpr += op;
  _qtyDisplay(_calcExpr);
}

function calcAc() {
  _calcExpr = '';
  _calcResultado = null;
  APP.calc = { expr: '', resultado: null };
  _qtyDisplay('');
  document.getElementById('f-qty').placeholder = '0';
}

function calcEq() {
  if (!_calcExpr) return;
  try {
    const safe = _calcExpr.replace(/[^0-9+\-*/().]/g, '');
    const res = Function('"use strict"; return (' + safe + ')')();
    const arredondado = Math.round(res * 100) / 100;
    _calcResultado = arredondado;
    APP.calc.resultado = arredondado;
    _calcExpr = '';  // limpa expressão, mantém resultado para continuar operando
    _qtyDisplay(String(arredondado));
  } catch {
    _qtyDisplay('ERRO');
    setTimeout(() => {
      _calcExpr = '';
      _qtyDisplay('');
    }, 800);
  }
}

function calcUsar() { /* não usado mais — o resultado já está no campo */ }

function atualizarCalcDisplay() { /* compatibilidade */ }


// ═══════════════════════════════════════════════════
//  SALVAR CONTAGEM
// ═══════════════════════════════════════════════════
// ── Anti-duplo disparo (Enter repetido / scanner duplo / clique duplo) ──────
let _salvandoContagem      = false;
let _ultimaAssinaturaContagem = null;
let _ultimoSalvamentoTs    = 0;

function _assinaturaContagem(atual, qty) {
  return [
    String(atual._endNorm || atual.endereco || '').trim().toUpperCase(),
    String(atual.capa     || '').trim().toUpperCase(),
    String(atual.gtin     || '').trim().toUpperCase(),
    String(atual.validade || '').trim(),
    Number(qty),
    String(APP.operador?.name || '').trim().toUpperCase(),
  ].join('|');
}

function salvarContagem() {
  // Trava: não abrir modal se já existe um em progresso
  if (_salvandoContagem) return;

  // Pegar valor do campo — pode ser resultado de cálculo ou digitação direta
  const rawVal = document.getElementById('f-qty').value.trim();
  if (!rawVal || rawVal === 'ERRO') { toast('Informe a quantidade', 'e'); return; }

  // Se a expressão tiver operadores pendentes, calcular antes de salvar
  let qty;
  if (_calcExpr && /[+\-*/]/.test(_calcExpr)) {
    try {
      const safe = _calcExpr.replace(/[^0-9+\-*/().]/g, '');
      const res = Function('"use strict"; return (' + safe + ')')();
      qty = Math.round(res);
      _qtyDisplay(String(qty));
      _calcResultado = qty;
      _calcExpr = '';
    } catch { toast('Expressão inválida — use = antes de salvar', 'e'); return; }
  } else {
    qty = parseInt(rawVal);
  }

  if (isNaN(qty) || qty < 0) { toast('Quantidade inválida', 'e'); return; }

  const a = APP.atual;

  // ── Modal de confirmação com resumo ──────────────────────────
  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;
  modal.innerHTML = `
    <div style="
      background:var(--surface);border:1px solid var(--border);border-radius:18px;
      padding:24px 20px;max-width:340px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);
    ">
      <div style="font-size:1.3rem;text-align:center;margin-bottom:10px">✅</div>
      <div style="font-weight:800;font-size:.95rem;text-align:center;margin-bottom:16px;color:var(--text)">Confirmar contagem?</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px;font-size:.78rem">
        <div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px">
          <span style="color:var(--muted)">📍 Endereço</span>
          <span style="font-family:var(--mono);font-weight:700;color:var(--text)">${a.endereco}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px">
          <span style="color:var(--muted)">🏷️ Capa Palete</span>
          <span style="font-family:var(--mono);font-weight:700;color:var(--text)">${a.capa}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px;gap:8px">
          <span style="color:var(--muted);flex-shrink:0">📦 Produto</span>
          <span style="font-weight:600;color:var(--text);text-align:right;font-size:.72rem">${a.produtoAtual?.descricao_produto || a.gtin}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px">
          <span style="color:var(--muted)">📅 Validade</span>
          <span style="font-family:var(--mono);font-weight:700;color:var(--text)">${a.validade}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 12px;background:rgba(232,117,26,.08);border:1px solid rgba(232,117,26,.2);border-radius:8px">
          <span style="color:var(--muted);font-weight:700">🔢 Quantidade</span>
          <span style="font-family:var(--mono);font-weight:800;font-size:1.2rem;color:var(--accent)">${(() => {
            const _gBip = normProd(a.gtin || '');
            if (_gBip.length === 14) {
              return '<b>' + qty + '</b> CX';
            }
            return '<b>' + qty + '</b> und';
          })()}</span>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button id="btn-conf-cancelar" style="
          flex:1;padding:12px;border-radius:10px;border:1px solid var(--border);
          background:transparent;color:var(--muted);font-size:.88rem;font-family:var(--sans);cursor:pointer
        ">✗ Corrigir</button>
        <button id="btn-conf-ok" style="
          flex:1;padding:12px;border-radius:10px;border:none;
          background:linear-gradient(135deg,var(--success),#00a86b);
          color:#060d1a;font-size:.88rem;font-weight:800;font-family:var(--sans);cursor:pointer
        ">✓ Confirmar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById('btn-conf-ok').onclick = () => {
    const btnOk = document.getElementById('btn-conf-ok');
    if (btnOk) { btnOk.disabled = true; btnOk.textContent = 'Salvando…'; }
    modal.remove();
    _executarSalvar(qty);
  };
  document.getElementById('btn-conf-cancelar').onclick = () => { modal.remove(); };
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _executarSalvar(qty) {
  // ── Trava anti-duplo: bloquear re-execução dentro de 1500ms com mesma assinatura ──
  if (_salvandoContagem) return;
  const _assin = _assinaturaContagem(APP.atual, qty);
  const _agora = Date.now();
  if (_ultimaAssinaturaContagem === _assin && (_agora - _ultimoSalvamentoTs) < 1500) {
    console.warn('[DT] Contagem duplicada bloqueada:', _assin);
    return;
  }
  _salvandoContagem = true;
  _ultimaAssinaturaContagem = _assin;
  _ultimoSalvamentoTs = _agora;
  setTimeout(() => { _salvandoContagem = false; }, 800);

  // ── Verificar se o inventário ainda está ativo antes de salvar ──
  if (!APP.inventario) {
    toast('⚠ Nenhum inventário ativo — selecione um inventário antes de contar.', 'e');
    _salvandoContagem = false;
    return;
  }
  if (APP.inventario.status && APP.inventario.status !== 'ATIVO') {
    toast(`⚠ Inventário "${APP.inventario.nome}" está ${APP.inventario.status}. Contagem bloqueada.`, 'e');
    _salvandoContagem = false;
    voltarInventarios();
    return;
  }
  if (!APP.inventario.id || APP.inventario.id === 'local') {
    toast('⚠ Inventário sem ID válido — sincronize e tente novamente.', 'e');
    _salvandoContagem = false;
    return;
  }

  const a = APP.atual;
  const qtdEsp = a.produtoAtual?.quantidade_esperada;

  // Divergência real é decidida pelo analista ao processar — o coletor apenas registra.
  // Manter divergente=false para não contaminar o cálculo de divergências com
  // avaliação local de quantidade. O alerta abaixo é apenas visual/informativo.
  const divergente = false;
  const _alertaQtd = (
    qtdEsp !== '' &&
    qtdEsp !== undefined &&
    qty !== parseInt(qtdEsp)
  );

  // Salvar sempre a quantidade como informada pelo operador (caixas ou unidades)
  // A conversão para unidades ocorre APENAS na Análise por Produto do analista
  const _gtinBipado  = normProd(a.gtin);
  const _isDunBipado = _gtinBipado.length === 14;
  const _fatorCx     = Math.max(1, parseFloat(a.produtoAtual?.fator_caixa) || 1);

  const _produtoGlobal = window.DTProdutos?.buscarSync(_gtinBipado) || { encontrado:false };
  const _nomeProdutoLido = _produtoGlobal.encontrado
    ? _produtoGlobal.nomeProduto
    : (a.produtoAtual?.descricao_produto || 'Produto não identificado');

  const contagem = {
    id:   Date.now(),
    uuid: gerarUUID(),
    inventario_id:     APP.inventario?.id     || '',
    inventario_nome:   APP.inventario?.nome   || '',
    inventario_codigo: APP.inventario?.codigo || '',
    endereco: a.endereco,
    capa: a.capa,
    gtin:           _gtinBipado,
    codigo_produto: normProd(a.produtoAtual?.codigo_produto || a.gtin),
    produto_codigo: normProd(a.produtoAtual?.codigo_produto || a.gtin),
    codigoLido:       _gtinBipado,
    dunLido:          _gtinBipado.length === 14 ? _gtinBipado : '',
    gtinLido:         _gtinBipado.length !== 14 ? _gtinBipado : (_produtoGlobal.gtin || ''),
    produtoLidoId:    _produtoGlobal.encontrado ? _produtoGlobal.produtoId : '',
    produtoLidoNome:  _nomeProdutoLido,
    descricao:         _nomeProdutoLido,
    descricao_produto: _nomeProdutoLido,
    validade: a.validade,
    quantidade: qty,                               // sempre em caixas (ou unidades, se GTIN)
    qtd_caixas:  _isDunBipado ? qty : null,        // quantas caixas o operador informou
    fator_caixa: _isDunBipado ? _fatorCx : null,   // fator de conversão cx→und
    tipo_bipagem: _isDunBipado ? 'DUN' : 'GTIN',   // qual código foi bipado
    quantidade_esperada: qtdEsp || '',
    divergente,
    operador:       APP.operador?.name  || '',
    operador_email: APP.operador?.email || '',
    coletor_id:     localStorage.getItem('dt_device_id') || '',
    origem:         'COLETOR',
    tipo_contagem:    APP.modoRecontagem ? 'RECONTAGEM' : 'PRIMEIRA',
    recontagem_id:    APP.modoRecontagem?.id          || null,
    divergencia_id:   APP.modoRecontagem?.divergencia_id || null,
    dataHora:   new Date(),
    criado_em:  new Date().toISOString(),
    numero: APP.contagens.filter(c => c.endereco === a.endereco && c.gtin === a.gtin).length + 1,
  };

  contagem.bateu_auditoria = false;
  _marcarAuditoriaBatidaSeHouver(contagem).then(ok => {
    if (ok) {
      contagem.bateu_auditoria = true;
      renderHistorico();
      toast('✅ Bateu com auditoria', 's');
    }
  });
  APP.contagens.unshift(contagem);
  const n = parseInt(a.capa);
  if (!isNaN(n) && n >= APP.proximoCapa) APP.proximoCapa = n + 1;

  enfileirarContagem({ ...contagem, dataHora: contagem.dataHora.toISOString() });
  renderHistorico();
  updateStats();

  // Toast de confirmação (sempre positivo — divergência real é processada no analista)
  toast('✓ Salvo: ' + contagem.descricao + ' × ' + qty, 's');
  beepOk();

  // Alerta informativo de quantidade — puramente visual, não influencia o fluxo
  if (_alertaQtd) {
    setTimeout(() => {
      toast(`⚠ Atenção: esperado ${qtdEsp} · contado ${qty}. Validação final no analista.`, 'w');
    }, 600);
  }

  // Em recontagem: concluir e voltar para aba de recontagens
  if (APP.modoRecontagem) {
    resetContagem();
    _concluirRecontagem();
    return;
  }

  // ── Verificar capacidade após salvar ─────────────────────────────────
  // Re-ler capacidade diretamente do mapa (mais confiável que APP.atual.capacidadeEnd)
  const _capMapa = APP.endCapacidade?.[a._endNorm] ?? a.capacidadeEnd ?? 0;
  const _cap     = _capMapa;
  const _usados  = _palletsNoEnderecoAtual(a._endNorm);

  // Regra explícita: capacidade 1 → encerrar após o primeiro pallet
  if (_cap === 1 && _usados >= 1) {
    toast('✅ Endereço encerrado (capacidade 1) — próximo endereço', 's');
    beepOk();
    finalizarEnderecoAtual();
    return;
  }

  // Regra geral: qualquer capacidade atingida → encerrar
  if (_cap > 0 && _usados >= _cap) {
    toast(`✅ Capacidade do endereço atingida (${_usados}/${_cap}) — próximo endereço`, 's');
    beepOk();
    finalizarEnderecoAtual();
    return;
  }

  // Ainda há vaga → manter endereço ativo para próximo pallet
  _manterEnderecoAtivo(a.endereco, a._endNorm, _cap || a.capacidadeEnd, a.somentesDun);
}

/**
 * Após salvar um pallet, mantém o endereço ativo e volta para a etapa 2 (Capa/Palete).
 * O botão END. VAZIO fica sempre disponível para o operador encerrar quando quiser.
 */
/**
 * Encerra completamente o endereço atual e volta para leitura de novo endereço.
 * Chamado quando: capacidade atingida, operador escolhe vazio com pallets já contados,
 * ou qualquer outra finalização sem entrar no modo rebipar.
 */
function finalizarEnderecoAtual() {
  _loteReset();
  APP.atual = {
    step: 1,
    endereco: '',
    _endNorm: '',
    enderecoValido: false,
    capacidadeEnd: 0,
    capa: '',
    gtin: '',
    produtoAtual: null,
    produtoDivergenteEnd: false,
    validade: '',
    quantidade: 0,
    somentesDun: false,
  };
  _endVerif = null;

  // Garantir bloco travado oculto e step-endereco visível
  const blocoTravado = document.getElementById('bloco-endereco-travado');
  if (blocoTravado) blocoTravado.style.display = 'none';
  const stepEnd = document.getElementById('step-endereco');
  if (stepEnd) stepEnd.style.display = '';

  // Limpar inputs
  ['f-endereco','f-capa','f-gtin','f-validade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.className = el.className.replace(/field-(ok|err|warn)/g,'').trim(); el.disabled = false; }
  });
  const fqty = document.getElementById('f-qty');
  if (fqty) fqty.value = '';
  _calcExpr = ''; _calcResultado = null; _calcMode = false;
  const cw = document.getElementById('calc-wrap');
  if (cw) cw.style.display = 'none';
  calcAc?.();

  // Limpar feedbacks
  ['fb-endereco','fb-capa','fb-gtin','fb-validade','fb-rebipar'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = '';
  });
  const pb = document.getElementById('prod-found-box');
  if (pb) pb.style.display = 'none';

  // Ocultar botão vazio (nada confirmado ainda no próximo endereço)
  const vaziow = document.getElementById('btn-vazio-wrap');
  if (vaziow) vaziow.style.display = 'none';

  updateSteps();
  setTimeout(() => { try { document.getElementById('f-endereco').focus(); } catch(e){} }, 100);
}


function _manterEnderecoAtivo(endereco, endNorm, cap, somentesDun) {
  const palletsContados = _palletsNoEnderecoAtual(endNorm);

  // Guarda estado de "aguardando rebipar" — endereço travado
  APP.atual = {
    step: 1,
    endereco: '',
    _endNorm: '',
    enderecoValido: true,      // libera botão VAZIO
    capacidadeEnd: cap,
    capa: '',
    gtin: '',
    produtoAtual: null,
    produtoDivergenteEnd: false,
    validade: '',
    quantidade: 0,
    somentesDun: somentesDun || false,
    _pendingEndereco: endNorm,  // sinaliza modo travado
    _pendingPallets: palletsContados,
  };

  // Limpar campos das etapas 2-5
  ['f-capa','f-gtin','f-validade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.className = el.className.replace(/\bfield-(ok|err|warn)\b/g,'').trim(); el.disabled = false; }
  });
  const fqty = document.getElementById('f-qty');
  if (fqty) fqty.value = '';
  _calcExpr = ''; _calcResultado = null; _calcMode = false;
  const cw = document.getElementById('calc-wrap');
  if (cw) cw.style.display = 'none';
  calcAc();
  ['fb-capa','fb-gtin','fb-validade'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = '';
  });
  const pb = document.getElementById('prod-found-box');
  if (pb) pb.style.display = 'none';

  // Limpar sf-val de todas as etapas
  ['sf-val-endereco','sf-val-capa','sf-val-gtin','sf-val-validade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
    const stepMap = { 'sf-val-endereco':'step-endereco', 'sf-val-capa':'step-capa', 'sf-val-gtin':'step-gtin', 'sf-val-validade':'step-validade' };
    const stepEl = document.getElementById(stepMap[id]);
    if (stepEl) { const inp = stepEl.querySelector('.sf-input-wrap .field'); if (inp) inp.style.display = ''; }
  });

  // Esconder o step-endereco normal e mostrar o bloco travado
  const stepEnd = document.getElementById('step-endereco');
  if (stepEnd) stepEnd.style.display = 'none';

  const blocoTravado = document.getElementById('bloco-endereco-travado');
  if (blocoTravado) blocoTravado.style.display = '';

  // Preencher info no bloco travado
  const txtEnd = document.getElementById('txt-endereco-travado');
  if (txtEnd) txtEnd.textContent = endereco.toUpperCase();

  const txtCap = document.getElementById('txt-cap-travado');
  if (txtCap) {
    if (cap > 0) {
      const restantes = Math.max(0, cap - palletsContados);
      txtCap.innerHTML = `✅ Pallet <b>${palletsContados}</b> salvo &nbsp;·&nbsp; Capacidade: <b>${cap}</b> &nbsp;·&nbsp; Restantes: <b>${restantes}</b>`;
    } else {
      txtCap.innerHTML = `✅ Pallet <b>${palletsContados}</b> salvo`;
    }
  }

  // Limpar campo de rebipar e feedback
  const fReb = document.getElementById('f-rebipar-endereco');
  if (fReb) { fReb.value = ''; fReb.className = 'field'; }
  const fbReb = document.getElementById('fb-rebipar');
  if (fbReb) fbReb.innerHTML = '';

  // Mostrar botão VAZIO
  const vaziow = document.getElementById('btn-vazio-wrap');
  if (vaziow) vaziow.style.display = '';

  // Esconder botão 🔄 reset (operador não pode sair livremente)
  const btnReset = document.getElementById('btn-reset-endereco');
  if (btnReset) btnReset.style.display = 'none';

  updateSteps();
  setTimeout(() => { try { document.getElementById('f-rebipar-endereco').focus(); } catch(e){} }, 100);
}

/** Confirma o rebipar do endereço no estado travado */
function confirmarRebipar() {
  const fReb = document.getElementById('f-rebipar-endereco');
  const fbReb = document.getElementById('fb-rebipar');
  if (!fReb || !fbReb) return;

  const val = _normStr(fReb.value);
  const esperado = _normStr(APP.atual._pendingEndereco || '');

  if (!val) {
    fbReb.innerHTML = `<div class="fb err">🚫 Bipe o endereço primeiro</div>`;
    beepErr(); return;
  }

  if (val !== esperado) {
    fbReb.innerHTML = `<div class="fb err">🚫 Endereço incorreto — esperado: <b>${(APP.atual._pendingEndereco||'').toUpperCase()}</b></div>`;
    fReb.className = 'field field-err';
    beepErr(); return;
  }

  // Endereço correto — sair do modo travado
  const endNorm = APP.atual._pendingEndereco;
  const capRebipar = APP.atual.capacidadeEnd || 0;
  APP.atual._pendingEndereco = null;
  APP.atual._pendingPallets  = null;

  // Re-ler capacidade do mapa (mais confiável)
  const capRebiparMapa = APP.endCapacidade?.[endNorm] ?? capRebipar ?? 0;
  // Verificar capacidade ANTES de prosseguir — pode já estar cheia
  const usadosRebipar = _palletsNoEnderecoAtual(endNorm);
  if (capRebiparMapa === 1 && usadosRebipar >= 1) {
    toast('✅ Endereço encerrado (capacidade 1) — próximo endereço', 's');
    finalizarEnderecoAtual();
    return;
  }
  if (capRebiparMapa > 0 && usadosRebipar >= capRebiparMapa) {
    // Capacidade já atingida — não deixar adicionar mais
    toast(`✅ Capacidade atingida (${usadosRebipar}/${capRebipar}) — próximo endereço`, 's');
    finalizarEnderecoAtual();
    return;
  }

  // Restaurar step-endereco normal e esconder bloco travado
  const stepEnd = document.getElementById('step-endereco');
  if (stepEnd) stepEnd.style.display = '';
  const blocoTravado = document.getElementById('bloco-endereco-travado');
  if (blocoTravado) blocoTravado.style.display = 'none';

  _prosseguirComEndereco(endNorm);
}

function resetContagem() {
  APP.atual = { step:1, endereco:'', _endNorm:'', enderecoValido:false, capa:'', gtin:'', produtoAtual:null, produtoDivergenteEnd:false, validade:'', quantidade:0, somentesDun:false, capacidadeEnd:0 };
  _endVerif = null; // invalidar cache de verificação
  _loteReset();     // limpar estado de lançamento rápido

  // Garantir que o bloco travado esteja oculto e o step-endereco visível
  const blocoTravado = document.getElementById('bloco-endereco-travado');
  if (blocoTravado) blocoTravado.style.display = 'none';
  const stepEnd = document.getElementById('step-endereco');
  if (stepEnd) stepEnd.style.display = '';

  // Limpar inputs e classes de validação
  ['f-endereco','f-capa','f-gtin','f-validade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.className = el.className.replace(/\bfield-(ok|err|warn)\b/g,'').trim(); el.disabled = false; }
  });

  // Limpar qty e calculadora
  const fqty = document.getElementById('f-qty');
  if (fqty) fqty.value = '';
  _calcExpr = ''; _calcResultado = null; _calcMode = false;
  const cw = document.getElementById('calc-wrap');
  if (cw) cw.style.display = 'none';
  calcAc();

  // Limpar feedbacks
  ['fb-endereco','fb-capa','fb-gtin','fb-validade'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = '';
  });
  const pb = document.getElementById('prod-found-box');
  if (pb) pb.style.display = 'none';

  // Limpar sf-val (valor inline)
  ['sf-val-endereco','sf-val-capa','sf-val-gtin','sf-val-validade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
    // Restaurar input visível na linha
    const stepMap = { 'sf-val-endereco':'step-endereco', 'sf-val-capa':'step-capa', 'sf-val-gtin':'step-gtin', 'sf-val-validade':'step-validade' };
    const stepEl = document.getElementById(stepMap[id]);
    if (stepEl) {
      const inp = stepEl.querySelector('.sf-input-wrap .field');
      if (inp) inp.style.display = '';
    }
  });

  // Ocultar botão vazio
  const vaziow = document.getElementById('btn-vazio-wrap');
  if (vaziow) vaziow.style.display = 'none';

  // Limpar classes dos step-fields
  ['step-endereco','step-capa','step-gtin','step-validade','step-quantidade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('done','ativo');
  });

  updateSteps();
  setTimeout(() => { const el = document.getElementById('f-endereco'); if (el) el.focus(); }, 80);
}

