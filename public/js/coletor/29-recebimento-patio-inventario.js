// Coletor > Recebimento > Inventário Inicial do Pátio
// PEDIDO AO VIVO (2026-09-10): ferramenta de implantação/conciliação —
// "fotografa" as notas que já estão fisicamente paradas no pátio (Recusa/
// Reentrega) mas que nunca passaram pelo fluxo normal de Entrada. Mesmo
// padrão de tela e mesma lógica de consulta de
// 24-recebimento-recusas.js/adicionarChave() (bundle separado do
// Coletor, duplicado de propósito). Não classifica Recusa/Reentrega aqui
// — igual toda nota nova hoje, quem classifica é o Analista depois
// (97-recebimento-recusas.js/alterarTratamento).
// IMPORTANTE (ver 25-recebimento-paletes.js): NUNCA usar ?./?? neste
// arquivo — coletores industriais antigos (Memor K, WebView Chromium
// 66/2018) travam com SyntaxError nessa sintaxe e derrubam o arquivo
// inteiro (nenhuma função dele fica definida — o botão de menu que chama
// abrirInventarioPatio() simplesmente não responde ao toque). Sempre
// `x && x.y` / ternário em vez disso.
(function (global) {
  'use strict';

  const COL_RECUSAS = 'recebimento_recusas';
  const COL_NOTAS = 'recebimento_recusas_notas';

  let S = {
    etapa: 'bipar', // bipar | confirmar
    chave: '',
    numeroNota: '',
    destinatario: '',
    box: '',
    pendenteChaveManual: '',
    pendenteNumeroManual: '',
    jaNoPatio: null, // { box } quando a nota já está registrada — bloqueia
    avisoJaRecebida: null, // { box } quando já foi recebida antes mas já saiu — SÓ avisa, não bloqueia
    carregando: false,
    ultimaConfirmada: '',
  };

  function fs() {
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }
  function toast(m, t) { if (typeof global.toast === 'function') global.toast(m, t); else alert(m); }
  function usuario() {
    const authObj = global.getDTAuth && global.getDTAuth();
    const u = authObj && authObj.currentUser;
    return u ? { uid: u.uid || '', email: u.email || '' } : { uid: '', email: '' };
  }
  // PEDIDO AO VIVO (2026-09-11): "por que não tá trazendo a pessoa na
  // coluna de conferente? Na hora de criar o login já coloco o nome" —
  // mesmo raciocínio aplicado em 24-recebimento-recusas.js: usa direto o
  // nome já gravado no login (APP.operador.name), sem exigir nenhum
  // cadastro extra.
  function _nomeLoginAtual() {
    return (typeof APP !== 'undefined' && APP.operador && APP.operador.name) || '';
  }
  // Mesma validação de dígito verificador de 24-recebimento-recusas.js
  // (duplicada de propósito, bundle separado).
  function chaveValida(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return false;
    let soma = 0, p = 2;
    for (let i = 42; i >= 0; i--) { soma += Number(c[i]) * p; p = p === 9 ? 2 : p + 1; }
    const r = soma % 11, d = r === 0 || r === 1 ? 0 : 11 - r;
    return d === Number(c[43]);
  }
  function numeroNotaDaChave(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return '';
    return String(Number(c.slice(25, 34)) || '').trim();
  }
  // MESMA regra de "está no pátio" de 105-recebimento-patio-tempo-real.js/
  // 97/99/24-recebimento-recusas.js — os 4 lugares que decidem isso
  // precisam concordar sempre.
  function estaNoPatio(doc, nota) {
    if (doc.origem !== 'COLETOR' && doc.origem !== 'INVENTARIO_INICIAL') return false;
    const tratamento = nota.tratamento != null ? nota.tratamento : (doc.tratamento || '');
    if (tratamento === 'REENTREGA') {
      const saida = nota.dataSaidaEm != null ? nota.dataSaidaEm : doc.dataSaidaEm;
      return !saida;
    }
    if (tratamento === 'RECUSA') {
      const status = nota.statusRetorno != null ? nota.statusRetorno : (doc.statusRetorno || '');
      return status !== 'FINALIZADO';
    }
    return true;
  }

  function reset() {
    S = { etapa: 'bipar', chave: '', numeroNota: '', destinatario: '', box: '', pendenteChaveManual: '', pendenteNumeroManual: '', jaNoPatio: null, avisoJaRecebida: null, carregando: false, ultimaConfirmada: S.ultimaConfirmada };
  }

  async function abrirInventarioPatio() {
    reset();
    if (global.goScreen) global.goScreen('recebimento-patio-inventario');
    render();
    focarChave();
  }
  function focarChave() {
    setTimeout(() => { const el = document.getElementById('patio-chave-input'); if (el) el.focus(); }, 80);
  }

  // Mesmo padrão de consulta de adicionarChave() (24-recebimento-
  // recusas.js): 1 leitura por `chaves array-contains` pra achar registro
  // físico já existente (bloqueia se ainda está no pátio) e um 2º lookup
  // em recebimento_recusas_notas pra completar mercado/número — nunca a
  // coleção inteira.
  async function consultarChave() {
    const input = document.getElementById('patio-chave-input');
    const chave = String((input && input.value) || '').replace(/\D/g, '');
    if (chave.length !== 44 || !chaveValida(chave)) {
      toast('Chave de acesso inválida. Bipe os 44 dígitos da NF-e.', 'error');
      if (input) input.select();
      return;
    }
    S.carregando = true; render();
    try {
      const hist = await fs().collection(COL_RECUSAS).where('chaves', 'array-contains', chave).get();
      const achados = hist.docs.map(d => ({ data: d.data() || {} }));
      const comEstaNoPatio = achados.find(a => {
        const nota = (a.data.notas || []).find(n => n.chave === chave) || {};
        return estaNoPatio(a.data, nota);
      });
      if (comEstaNoPatio) {
        const nota = (comEstaNoPatio.data.notas || []).find(n => n.chave === chave) || {};
        S.jaNoPatio = { box: nota.box || comEstaNoPatio.data.box || '—' };
        S.chave = chave;
        S.etapa = 'confirmar';
        render();
        return;
      }
      // PEDIDO AO VIVO (2026-09-11): "na hora de fazer o inventário inicial
      // e já ter recebido, ele vai falar que já foi recebida" — chave que
      // JÁ passou pelo sistema antes, mas já saiu do pátio (Recusa
      // finalizada ou Reentrega concluída), NÃO bloqueia — ela pode ter
      // voltado fisicamente de novo, de verdade (cenário real já coberto
      // antes) — só AVISA, deixando o operador seguir com o lançamento
      // normal se confirmar que é isso mesmo.
      let avisoJaRecebida = null;
      if (achados.length) {
        const maisRecente = achados.slice().sort((a, b) => String((b.data.criadoEm || '')).localeCompare(String(a.data.criadoEm || '')))[0];
        const nota = (maisRecente.data.notas || []).find(n => n.chave === chave) || {};
        avisoJaRecebida = { box: nota.box || maisRecente.data.box || '—' };
      }
      const doc = await fs().collection(COL_NOTAS).doc(chave).get();
      S.chave = chave;
      S.jaNoPatio = null;
      S.avisoJaRecebida = avisoJaRecebida;
      if (doc.exists) {
        const d = doc.data() || {};
        S.numeroNota = d.numeroNota || '';
        S.destinatario = d.destinatario || '';
        S.pendenteChaveManual = '';
        S.etapa = 'confirmar';
      } else {
        // PEDIDO AO VIVO (mesmo padrão de adicionarChave() em 24): banco
        // pode estar desatualizado — pede confirmação/correção do número,
        // pré-preenchido a partir da própria chave, nunca trava o operador.
        S.pendenteChaveManual = chave;
        S.pendenteNumeroManual = numeroNotaDaChave(chave);
        S.numeroNota = S.pendenteNumeroManual;
        S.destinatario = '';
        S.etapa = 'confirmar';
      }
      render();
    } catch (e) {
      toast('Erro ao consultar a nota: ' + (e.message || e), 'error');
      render();
    } finally {
      S.carregando = false;
    }
  }

  async function confirmarLancamento() {
    const boxInput = document.getElementById('patio-box-input');
    const box = String((boxInput && boxInput.value) || '').trim().toUpperCase();
    if (!box) { toast('Informe o Box onde a nota está.', 'error'); if (boxInput) boxInput.focus(); return; }
    const numeroInput = document.getElementById('patio-numero-input');
    const numero = String((numeroInput && numeroInput.value) || S.numeroNota || '').trim();
    if (!numero) { toast('Informe o número da nota.', 'error'); if (numeroInput) numeroInput.focus(); return; }
    const u = usuario();
    const agora = new Date().toISOString();
    const payload = {
      chaves: [S.chave],
      numerosNotas: [numero],
      notas: [{ chave: S.chave, numeroNota: numero, destinatario: S.destinatario || '', volumeEsperado: 0, box }],
      box,
      conferenteNome: _nomeLoginAtual(),
      origem: 'INVENTARIO_INICIAL',
      statusFisico: 'NO_PATIO',
      criadoEm: agora,
      criadoPorUid: u.uid,
      criadoPorEmail: u.email,
    };
    const btn = document.getElementById('patio-confirmar-btn');
    if (btn) btn.disabled = true;
    try {
      await fs().collection(COL_RECUSAS).add(payload);
      S.ultimaConfirmada = numero + ' — Box ' + box;
      toast('Nota lançada no inventário do pátio.', 'success');
      reset();
      S.etapa = 'sucesso';
      render();
    } catch (e) {
      toast('Erro ao lançar no inventário: ' + (e.message || e), 'error');
      if (btn) btn.disabled = false;
    }
  }

  function etapaBipar() {
    return `
    <div><div class="screen-title">📦 Inventário Inicial do Pátio</div><div class="screen-sub">Bipe ou digite a chave de acesso da nota que já está parada no pátio, fora do fluxo normal de Entrada.</div></div>
    <input id="patio-chave-input" class="field" inputmode="numeric" autocomplete="off" placeholder="Bipe a chave de acesso (44 dígitos)" style="font-size:1rem;padding:15px;text-align:center">
    <button class="btn btn-primary" id="patio-consultar-btn" ${S.carregando ? 'disabled' : ''} style="padding:14px">${S.carregando ? '⏳ Consultando...' : 'Consultar'}</button>
    <button class="btn btn-ghost" data-patio-voltar="1" style="padding:12px">← Voltar</button>`;
  }
  function etapaConfirmar() {
    if (S.jaNoPatio) {
      return `
      <div><div class="screen-title">📦 Inventário Inicial do Pátio</div></div>
      <div class="card" style="padding:14px;border:1px solid #7a4a1f;background:#2a1c0c">
        <div style="font-size:.85rem;color:#ffd18a">⚠️ Esta nota já está registrada no pátio — Box ${esc(S.jaNoPatio.box)}.</div>
      </div>
      <button class="btn btn-primary" data-patio-nova="1" style="padding:14px">Bipar outra nota</button>
      <button class="btn btn-ghost" data-patio-voltar="1" style="padding:12px">Concluir</button>`;
    }
    return `
    <div><div class="screen-title">📦 Confirmar lançamento</div><div class="screen-sub">Confira os dados e informe o Box onde a nota está fisicamente.</div></div>
    ${S.pendenteChaveManual ? '<div class="card" style="padding:12px;border:1px solid #7a4a1f;background:#2a1c0c"><div style="font-size:.74rem;color:#ffd18a">⚠️ Nota ainda não está no sistema — confirme ou corrija o número abaixo.</div></div>' : ''}
    ${S.avisoJaRecebida ? `<div class="card" style="padding:12px;border:1px solid #1e6f4e;background:#132a1d"><div style="font-size:.74rem;color:#8fd9a8">✅ Esta nota já foi recebida antes (último Box: ${esc(S.avisoJaRecebida.box)}) e já saiu do pátio. Se ela voltou fisicamente de novo, pode lançar normalmente abaixo.</div></div>` : ''}
    <div class="card" style="padding:13px">
      <div style="font-size:.72rem;color:#6f89a6">NÚMERO DA NOTA</div>
      <input id="patio-numero-input" class="field" inputmode="numeric" autocomplete="off" value="${esc(S.numeroNota)}" style="font-size:1.05rem;padding:12px;text-align:center;font-weight:850;margin-bottom:8px">
      <div style="font-size:.72rem;color:#6f89a6">DESTINATÁRIO</div>
      <div style="font-weight:800;margin-bottom:4px">${esc(S.destinatario || '—')}</div>
    </div>
    <input id="patio-box-input" class="field" autocomplete="off" placeholder="Ex.: BOX 12" style="font-size:1.1rem;padding:17px;text-align:center;font-weight:850;text-transform:uppercase">
    <button class="btn btn-primary" id="patio-confirmar-btn" style="padding:15px">Confirmar lançamento →</button>
    <button class="btn btn-ghost" data-patio-cancelar="1" style="padding:12px">← Cancelar</button>`;
  }
  function etapaSucesso() {
    return `<div style="text-align:center;font-size:3rem">✅</div><div class="screen-title" style="text-align:center">Nota lançada no pátio</div><div class="card" style="padding:16px;text-align:center">${esc(S.ultimaConfirmada)}</div><button class="btn btn-primary" id="patio-nova-btn" style="padding:16px">Lançar outra nota</button><button class="btn btn-ghost" data-patio-voltar="1" style="padding:14px">Voltar ao Recebimento</button>`;
  }
  const ETAPAS = { bipar: etapaBipar, confirmar: etapaConfirmar, sucesso: etapaSucesso };

  function render() {
    const host = document.getElementById('patio-inventario-host');
    if (!host) return;
    host.innerHTML = (ETAPAS[S.etapa] || etapaBipar)();
    ligar();
  }
  function ligar() {
    const chaveInput = document.getElementById('patio-chave-input');
    if (chaveInput) chaveInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); consultarChave(); } });
    const btnConsultar = document.getElementById('patio-consultar-btn');
    if (btnConsultar) btnConsultar.addEventListener('click', consultarChave);
    const btnConfirmar = document.getElementById('patio-confirmar-btn');
    if (btnConfirmar) btnConfirmar.addEventListener('click', confirmarLancamento);
    const btnNova = document.getElementById('patio-nova-btn');
    if (btnNova) btnNova.addEventListener('click', () => { reset(); render(); focarChave(); });
    document.querySelectorAll('[data-patio-nova]').forEach(b => b.addEventListener('click', () => { reset(); render(); focarChave(); }));
    document.querySelectorAll('[data-patio-cancelar]').forEach(b => b.addEventListener('click', () => { reset(); render(); focarChave(); }));
    document.querySelectorAll('[data-patio-voltar]').forEach(b => b.addEventListener('click', () => { if (global.goScreen) global.goScreen('recebimento-modo'); }));
  }

  global.abrirInventarioPatio = abrirInventarioPatio;
  global._patioInventarioInternals = { estaNoPatio, consultarChave, confirmarLancamento, getEstado: () => S };
})(window);
