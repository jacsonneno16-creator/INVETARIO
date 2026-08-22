// Recebimento > Notas Retornadas
// Importa DANFE em PDF no navegador, cadastra motoristas/motivos e acompanha notas retornadas.
(function (global) {
  'use strict';

  const COL_NOTAS = 'recebimento_recusas_notas';
  const COL_RECUSAS = 'recebimento_recusas';
  const COL_MOTORISTAS = 'recebimento_recusas_motoristas';
  const COL_MOTIVOS = 'recebimento_recusas_motivos';
  // Pedido ao vivo do usuário (planilha real de controle): "Conferente" é a
  // pessoa da equipe que confere a carga na chegada — cadastro próprio,
  // mesmo molde de Motoristas/Motivos.
  const COL_CONFERENTES = 'recebimento_recusas_conferentes';
  const COL_TAREFAS = 'recebimento_recusas_tarefas_conferencia';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let _notas = [];
  let _recusas = [];
  let _motoristas = [];
  let _motivos = [];
  let _conferentes = [];
  let _tarefas = new Map(); // FASE 8 — recusaId -> tarefa de conferência delegada
  let _preview = [];
  let _pdfJsPromise = null;
  let _filtro = '';
  let _filtroTratamento = ''; // FASE 9
  let _filtroConferencia = ''; // FASE 9
  let _filtroPeriodoInicio = ''; // FASE 9 — data (yyyy-mm-dd), sobre criadoEm
  let _filtroPeriodoFim = ''; // FASE 9
  let _recusaAtribuindoId = '';
  let _recusaDetalheId = '';
  // Diagnóstico persistente da última sincronização de vendedores — o
  // toast some rápido demais pra dar tempo de anotar os números quando o
  // vendedor não aparece na nota; isso fica visível até a próxima
  // sincronização, pra facilitar diagnosticar sem precisar repetir o teste.
  let _ultimoDiagVendedores = '';
  let _ultimoDiagAutomatico = '';
  // Pedido ao vivo do usuário: importar Motoristas + Motivos (e placa) de
  // uma planilha (Veículo/Motorista, Placa, Motivo) de uma vez só, sem
  // repetir os que já existem. Preview antes de salvar — mesmo padrão já
  // usado pro import de PDF/Bluesoft nesta mesma tela.
  let _previewImportacaoCadastros = null;

  // FASE 9 — "Tratamento do retorno" é SEMPRE separado da "Natureza da NF"
  // (pedido explícito do usuário: nunca sobrescreve o dado da nota) e da
  // "Conferência de produtos" (statusConferenciaOperacional). Só o
  // Analista classifica — o Coletor nunca grava este campo.
  // Pedido ao vivo do usuário (validado contra a planilha real de controle
  // "CONTROLE DE REENTREGAS E RECUSAS"): o catálogo real de Ação tem
  // Substituição também, além de Recusa/Devolução/Reentrega.
  // PENDENTE (usuário, confirmado contra a planilha real: "TratamENTO novo,
  // mesmo fluxo" — 120 casos reais na planilha, carga com pendência tipo
  // canhoto faltando/produto não entregue, que precisa de acompanhamento
  // diário até resolver, mas usando os mesmos status/telas já prontos).
  const TRATAMENTO_LABELS = { '': '— Não classificado —', RECUSA: 'Recusa', DEVOLUCAO: 'Devolução', REENTREGA: 'Reentrega', SUBSTITUICAO: 'Substituição', PENDENTE: 'Pendente', OUTRO: 'Outro' };

  function fs() {
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    if (global.firebase && typeof global.firebase.firestore === 'function') return global.firebase.firestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function agoraIso() { return new Date().toISOString(); }
  // Comparação sem acento/maiúscula pra dedup na importação de planilha —
  // "José Antonio" e "JOSE ANTONIO" contam como o mesmo motorista.
  function normUpper(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
  function usuarioAtual() {
    const u = global.firebase?.auth?.().currentUser;
    return u ? { uid: u.uid || '', email: u.email || '' } : { uid: '', email: '' };
  }
  function numero(v) {
    const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  function intVol(v) {
    const n = numero(v);
    return Number.isFinite(n) ? Math.round(n) : NaN;
  }
  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return esc(v);
    return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function chaveNfeValida(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) {
      soma += Number(c[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dv = (resto === 0 || resto === 1) ? 0 : 11 - resto;
    return dv === Number(c[43]);
  }
  function extrairChave(texto) {
    const txt = String(texto || '');
    const idx = txt.search(/chave\s+de\s+acesso/i);
    const blocos = idx >= 0 ? [txt.slice(idx, idx + 650), txt] : [txt];
    for (const bloco of blocos) {
      const partes = bloco.match(/[0-9][0-9.\-\/\s]{42,180}/g) || [];
      for (const p of partes) {
        const dig = p.replace(/\D/g, '');
        for (let i = 0; i + 44 <= dig.length; i++) {
          const cand = dig.slice(i, i + 44);
          if (chaveNfeValida(cand)) return cand;
        }
      }
    }
    const exatos = txt.match(/\d{44}/g) || [];
    return exatos.find(chaveNfeValida) || exatos[0] || '';
  }
  function numeroNotaDaChave(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return '';
    return String(Number(c.slice(25, 34)) || '').trim();
  }
  function parseDanfeText(texto) {
    const txt = String(texto || '').replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ');
    const chave = extrairChave(txt);
    let numeroNota = '';
    const mNf = txt.match(/N\s*[º°o]?\s*([0-9][0-9.\s]{3,20})\s*-?\s*S[ÉE]RIE/i) || txt.match(/NF-e\s*N\s*[º°o]?\s*([0-9.\s]{3,20})/i);
    if (mNf) numeroNota = (mNf[1] || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!numeroNota) numeroNota = numeroNotaDaChave(chave);

    let volumes = NaN;
    const iTransp = txt.search(/Transportador\s*\/\s*Volumes\s+Transportados/i);
    const trechoTransp = iTransp >= 0 ? txt.slice(iTransp, iTransp + 1800) : txt;
    const mVol = trechoTransp.match(/Quantidade\s+Esp[ée]cie\s+([0-9][0-9.,]*)/i)
      || trechoTransp.match(/Quantidade\s+([0-9][0-9.,]*)\s+(?:Esp[ée]cie|VOLUMES|Marca)/i)
      || trechoTransp.match(/Quantidade\s+([0-9][0-9.,]*)/i);
    if (mVol) volumes = intVol(mVol[1]);

    let destinatario = '';
    const mCliente = txt.match(/Cliente:\s*\(?\d+\)?\s+(.{3,120}?)\s+Pedido:/i);
    const mDest = txt.match(/Destinat[áa]rio\s*\/\s*Remetente[\s\S]{0,300}?Nome\s*\/\s*Raz[ãa]o\s+Social\s+(?:CNPJ\s+Data\s+da\s+Emiss[ãa]o\s+)?(.{3,120}?)(?=\s+\d{2}\.\d{3}\.\d{3}\/|\s+CNPJ|\s+CPF|\s+Endere[cç]o)/i);
    if (mCliente) destinatario = mCliente[1].trim();
    else if (mDest) destinatario = mDest[1].trim();

    let dataEmissao = '';
    const mData = txt.match(/Data\s+da\s+Emiss[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (mData) dataEmissao = mData[1];

    let transportadora = '';
    const mTransp = trechoTransp.match(/Raz[ãa]o\s+Social\s+Frete\s+Por\s+Conta\s+(.{3,100}?)(?=\s+1-Emitente|\s+C[óo]digo\s+ANTT|\s+Placa\s+do\s+Ve[íi]culo|\s+CNPJ)/i)
      || trechoTransp.match(/Raz[ãa]o\s+Social\s+(.{3,100}?)(?=\s+C[óo]digo\s+ANTT|\s+Placa\s+do\s+Ve[íi]culo|\s+CNPJ)/i);
    if (mTransp) transportadora = mTransp[1].trim();

    // "Informações Complementares" — bloco de texto livre no rodapé do
    // DANFE (seção "Dados Adicionais"), onde o emitente costuma escrever o
    // motivo da devolução ("Devolução ref. NF 12345 - mercadoria
    // avariada", etc.). Não existe em nenhum endpoint da Bluesoft
    // (conferido campo a campo no schema oficial: nenhuma variação de
    // "informação complementar"/"dados adicionais" aparece em
    // NotasFiscaisConsultarResponse nem em NotaFiscalImportadaTerm) — só
    // dá pra pegar aqui, no PDF. Corta antes de "Reservado ao Fisco" (a
    // coluna vizinha no layout padrão do DANFE) quando presente.
    let informacoesComplementares = '';
    const iInfComp = txt.search(/Informa[çc][õo]es\s+Complementares/i);
    if (iInfComp >= 0) {
      let trecho = txt.slice(iInfComp, iInfComp + 700).replace(/^Informa[çc][õo]es\s+Complementares\s*/i, '');
      const iFisco = trecho.search(/Reservado\s+ao\s+Fisco/i);
      if (iFisco >= 0) trecho = trecho.slice(0, iFisco);
      informacoesComplementares = trecho.trim().replace(/\s{2,}/g, ' ').slice(0, 500);
    }

    return {
      chave,
      numeroNota,
      volumes: Number.isFinite(volumes) ? volumes : '',
      destinatario,
      dataEmissao,
      transportadora,
      informacoesComplementares,
      chaveValida: chaveNfeValida(chave)
    };
  }

  async function garantirPdfJs() {
    if (global.pdfjsLib) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return global.pdfjsLib;
    }
    if (_pdfJsPromise) return _pdfJsPromise;
    _pdfJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.async = true;
      const timer = setTimeout(() => reject(new Error('Tempo esgotado ao carregar o leitor de PDF. Verifique a internet desta máquina.')), 20000);
      s.onload = () => {
        clearTimeout(timer);
        if (!global.pdfjsLib) return reject(new Error('Biblioteca de PDF não iniciou.'));
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(global.pdfjsLib);
      };
      s.onerror = () => { clearTimeout(timer); reject(new Error('Não foi possível carregar o leitor de PDF. Verifique a internet desta máquina.')); };
      document.head.appendChild(s);
    });
    return _pdfJsPromise;
  }
  async function textoDoPdf(file) {
    const lib = await garantirPdfJs();
    const data = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data }).promise;
    let total = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      total += '\n' + tc.items.map(i => i.str || '').join(' ');
    }
    return total;
  }

  async function carregarDados() {
    const [n, r, m, mot, conf, tar] = await Promise.all([
      fs().collection(COL_NOTAS).get(),
      fs().collection(COL_RECUSAS).get(),
      fs().collection(COL_MOTORISTAS).get(),
      fs().collection(COL_MOTIVOS).get(),
      fs().collection(COL_CONFERENTES).get(),
      fs().collection(COL_TAREFAS).get(),
    ]);
    _notas = n.docs.map(d => ({ _id:d.id, ...d.data() }));
    _recusas = r.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
    _motoristas = m.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    _motivos = mot.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    _conferentes = conf.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    // FASE 8 — indexado por recusaId (o mesmo id do doc de tarefa, ver
    // confirmarAtribuicaoConferenciaRecusa) pra achar rápido se já existe
    // uma conferência delegada em andamento pra cada linha da tabela.
    _tarefas = new Map(tar.docs.map(d => [d.id, { _id:d.id, ...d.data() }]));
  }

  function resumoCards() {
    const hoje = new Date().toISOString().slice(0,10);
    const hojeQtd = _recusas.filter(r => String(r.criadoEm || '').slice(0,10) === hoje).length;
    const diverg = _recusas.filter(r => Number(r.diferencaVolumes || 0) !== 0).length;
    const vols = _recusas.reduce((s,r) => s + Number(r.volumeInformado || 0), 0);
    return `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px;margin:12px 0 16px">
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">NOTAS IMPORTADAS</div><div style="font-size:1.45rem;font-weight:850">${_notas.length}</div></div>
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">RETORNOS HOJE</div><div style="font-size:1.45rem;font-weight:850">${hojeQtd}</div></div>
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">VOLUMES RETORNADOS</div><div style="font-size:1.45rem;font-weight:850">${vols}</div></div>
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">COM DIVERGÊNCIA</div><div style="font-size:1.45rem;font-weight:850;color:${diverg ? '#dc2626':'inherit'}">${diverg}</div></div>
      </div>`;
  }

  // Motivo só faz sentido pra devolução (pedido ao vivo do usuário) —
  // volume é buscado pra qualquer nota. Usado tanto pra decidir se o botão
  // "Buscar no XML" ainda precisa aparecer quanto pra decidir quais notas
  // entram na busca automática — as duas precisam concordar, senão o botão
  // fica visível pra sempre numa nota de venda já sem motivo pra buscar.
  // Pedido ao vivo do usuário (2026-08-20): "não quero mais o motivo e nem
  // o volume das notas de devolução" — reverte a regra anterior. Devolução
  // NUNCA mais busca XML (nem motivo, nem volume); só venda busca, e só
  // volume (venda nunca teve motivo).
  function _precisaBuscarXml(p) {
    if (p.pareceDevolucao) return false;
    return p.volumes === '' || p.volumes == null;
  }
  // Conteúdo das células "Leitura" e "Status" isolado em função própria —
  // reusado tanto no render completo da tabela quanto na atualização
  // cirúrgica de UMA linha (_atualizarLinhaPreviewNoDom), sem duplicar a
  // regra de quando mostrar o botão/badge.
  function _celulaLeituraHtml(p, i) {
    return `${p.informacoesComplementares
      ? `<div title="${esc(p.informacoesComplementares)}">${esc(p.informacoesComplementares.slice(0,80))}${p.informacoesComplementares.length > 80 ? '…' : ''}</div>`
      : ''}${p.origemImportacao === 'BLUESOFT' && p.chave && _precisaBuscarXml(p)
          ? `<button class="btn btn-ghost btn-sm" data-recusa-buscar-xml="${i}" style="font-size:.68rem;padding:4px 8px;margin-top:4px">📄 Buscar volume no XML</button>`
          : (p.informacoesComplementares ? '' : '—')}`;
  }
  function _celulaStatusHtml(p) {
    const ok = p.chave && p.numeroNota && Number(p.volumes) >= 0;
    return ok ? '<span class="badge green">✓ pronta</span>' : '<span class="badge red">⚠ revisar</span>';
  }
  function renderPreview() {
    if (!_preview.length) return '<div class="empty" style="min-height:90px"><div class="empty-sub">Sincronize com a Bluesoft ou selecione PDFs de DANFE para visualizar antes de salvar.</div></div>';
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Origem</th><th>Chave de acesso</th><th>NF</th><th>Natureza (CFOP)</th><th>Volumes</th><th>Destinatário</th><th>Vendedor / Supervisor</th><th>Motivo (informações complementares)</th><th>Leitura</th></tr></thead><tbody>${_preview.map((p,i) => {
      return `<tr>
        <td>${esc(p.fileName)}${p.pareceDevolucao ? '<br><span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.65rem">↩️ parece devolução</span>' : ''}${p.pareceDevolucao && p.statusRecebimento !== 'Recebido' ? `<br><span class="badge" style="background:#4a1f1f;color:#ffb3b3;font-size:.65rem" title="Status na Bluesoft: ${esc(p.statusRecebimento || 'ainda não processada')}">⏳ ainda não recebida</span>` : ''}</td>
        <td class="mono" style="font-size:.68rem;max-width:250px;word-break:break-all">${esc(p.chave || 'não encontrada')}</td>
        <td><input class="field" style="min-width:110px;padding:7px" value="${esc(p.numeroNota)}" data-recprev-nf="${i}"></td>
        <td style="font-size:.74rem">${esc(p.naturezaLabel || '—')}${p.cfop ? '<br><span style="color:var(--muted);font-size:.66rem">CFOP ' + esc(p.cfop) + '</span>' : ''}</td>
        <td><input class="field" type="number" min="0" step="1" style="width:95px;padding:7px" value="${esc(p.volumes)}" data-recprev-vol="${i}" title="Preenchido automaticamente ao clicar em 'Buscar no XML' (tag <vol> da NF-e), quando disponível — senão digite o que foi contado."></td>
        <td>${esc(p.destinatario || '—')}</td>
        <td style="font-size:.72rem">${esc(p.vendedorNome || '—')}${p.vendedorNome
          // Pedido ao vivo do usuário: "verifica se tem supervisor pq ta
          // trazendo o gerente e ele é o chefe master, tem que saber os
          // que ficam responsáveis pelo vendedor" — supervisor é quem
          // responde pelo vendedor no dia a dia. Sempre mostra a linha
          // quando há vendedor (mesmo sem supervisor preenchido) —
          // "Sup.: —" deixa visível que a Bluesoft não devolveu supervisor
          // pra esse vendedor, em vez de sumir com a linha e parecer que
          // não foi nem buscado. Gerente foi removido (pedido ao vivo do
          // usuário: "o gerente pode tirar, que sempre será 1 pq de
          // gerente só tem ele" — um valor fixo pra conta inteira, sem
          // informação útil por nota).
          ? '<br><span style="color:var(--muted)">Sup.: ' + esc(p.supervisorNome || '—') + '</span>'
          : ''}</td>
        <td data-recprev-leitura="${i}" style="font-size:.72rem;max-width:220px">${_celulaLeituraHtml(p, i)}</td>
        <td data-recprev-status="${i}">${_celulaStatusHtml(p)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  // FASE 9 — filtros dedicados (período/tratamento/conferência), client-
  // side sobre o mesmo array já carregado em memória — mesmo padrão já
  // usado no resto do app (sem índice novo no Firestore). O texto livre
  // (_filtro) continua cobrindo NF/cliente/motorista/box, que já é o que
  // a maioria das buscas do dia a dia precisa.
  function filtrarRecusas() {
    const f = _filtro.trim().toLowerCase();
    return _recusas.filter(r => {
      if (f && !([r.motoristaNome,r.motivoNome,r.conferenteNome,r.box,(r.notas || []).map(n=>n.numeroNota).join(' '),(r.chaves || []).join(' ')].join(' ').toLowerCase().includes(f))) return false;
      if (_filtroTratamento && (r.tratamento || '') !== _filtroTratamento) return false;
      if (_filtroConferencia && (r.statusConferenciaOperacional || 'NAO_REALIZADA') !== _filtroConferencia) return false;
      const data = String(r.criadoEm || '').slice(0,10);
      if (_filtroPeriodoInicio && data && data < _filtroPeriodoInicio) return false;
      if (_filtroPeriodoFim && data && data > _filtroPeriodoFim) return false;
      return true;
    });
  }
  function filtrosHtml() {
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">DE</div><input class="field" id="recusas-filtro-periodo-ini" type="date" value="${esc(_filtroPeriodoInicio)}" style="padding:8px"></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input class="field" id="recusas-filtro-periodo-fim" type="date" value="${esc(_filtroPeriodoFim)}" style="padding:8px"></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">TRATAMENTO</div><select class="field" id="recusas-filtro-tratamento" style="padding:8px">${Object.keys(TRATAMENTO_LABELS).map(k=>`<option value="${k}" ${k===_filtroTratamento?'selected':''}>${esc(TRATAMENTO_LABELS[k])}</option>`).join('')}</select></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">CONFERÊNCIA</div><select class="field" id="recusas-filtro-conferencia" style="padding:8px"><option value="" ${!_filtroConferencia?'selected':''}>Todas</option><option value="NAO_REALIZADA" ${_filtroConferencia==='NAO_REALIZADA'?'selected':''}>Não realizada</option><option value="CONFERIDA" ${_filtroConferencia==='CONFERIDA'?'selected':''}>Conferida</option><option value="CONFERIDA_COM_DIVERGENCIA" ${_filtroConferencia==='CONFERIDA_COM_DIVERGENCIA'?'selected':''}>Conferida c/ divergência</option></select></div>
      <input class="field" id="recusas-filtro" value="${esc(_filtro)}" placeholder="Pesquisar NF, motorista, motivo, box..." style="max-width:280px;padding:8px">
    </div>`;
  }
  function renderRecusasTabela() {
    const lista = filtrarRecusas();
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Data/Hora</th><th>Notas</th><th>Motorista</th><th>Conferente</th><th>Motivo</th><th>Box</th><th>Esperado</th><th>Contado</th><th>Dif.</th><th>Status</th><th>Conferência de produtos</th><th>Tratamento</th><th></th></tr></thead><tbody>${lista.length ? lista.map(r => {
      const dif = Number(r.diferencaVolumes || 0);
      return `<tr><td>${fmtDataHora(r.criadoEm)}</td><td><b>${esc((r.notas || []).map(n => n.numeroNota).filter(Boolean).join(', ') || '—')}</b></td><td>${esc(r.motoristaNome || '—')}</td><td>${esc(r.conferenteNome || '—')}</td><td>${esc(r.motivoNome || '—')}</td><td><b>${esc(r.box || '—')}</b></td><td>${Number(r.volumeEsperado || 0)}</td><td>${Number(r.volumeInformado || 0)}</td><td style="font-weight:800;color:${dif ? '#dc2626':'#15803d'}">${dif > 0 ? '+' : ''}${dif}</td><td>${dif ? '<span class="badge red">Divergente</span>' : '<span class="badge green">Conferido</span>'}</td><td>${statusConferenciaHtml(r)}</td><td><select class="field" style="padding:6px;font-size:.75rem" data-recusa-tratamento="${esc(r._id)}">${Object.keys(TRATAMENTO_LABELS).map(k=>`<option value="${k}" ${k===(r.tratamento||'')?'selected':''}>${esc(TRATAMENTO_LABELS[k])}</option>`).join('')}</select></td><td><button class="btn btn-ghost btn-sm" data-recusa-detalhe="${esc(r._id)}">🔍</button> <button class="btn btn-ghost btn-sm" data-recusa-excluir="${esc(r._id)}" title="Excluir esta nota retornada registrada">🗑️</button></td></tr>`;
    }).join('') : '<tr><td colspan="13"><div class="empty"><div class="empty-icon">↩️</div><div class="empty-title">Nenhuma nota retornada com esses filtros</div></div></td></tr>'}</tbody></table></div>`;
  }

  // FASE 8 — "Conferência de produtos" é um status PRÓPRIO e separado
  // (statusConferenciaOperacional), nunca confundido com conferenciaStatus
  // (que é só a checagem de VOLUME, já existente). NAO_REALIZADA com uma
  // tarefa pendente vira "aguardando fulano"; sem tarefa vira o botão de
  // solicitar.
  function statusConferenciaHtml(r) {
    const status = r.statusConferenciaOperacional || 'NAO_REALIZADA';
    if (status === 'CONFERIDA') return '<span class="badge green">✓ Conferida</span>';
    if (status === 'CONFERIDA_COM_DIVERGENCIA') return '<span class="badge red">⚠ Conferida c/ divergência</span>';
    const tarefa = _tarefas.get(r._id);
    if (tarefa && tarefa.status === 'PENDENTE') return `<span class="badge" style="background:#15263f;color:#9eb4cb">Aguardando ${esc(tarefa.atribuidoPara)}</span>`;
    return `<button class="btn btn-ghost btn-sm" data-recusa-solicitar-conf="${esc(r._id)}">📋 Solicitar conferência</button>`;
  }

  // Pedido ao vivo do usuário (planilha real de controle): "Conferente" —
  // 3º cadastro no mesmo molde de Motorista/Motivo. Generalizado num
  // lugar só (arrCadastro/colCadastro), pra não repetir if/else motorista-
  // ou-outro em cada função que mexe em cadastro.
  function arrCadastro(tipo) { return tipo === 'motorista' ? _motoristas : tipo === 'conferente' ? _conferentes : _motivos; }
  function colCadastro(tipo) { return tipo === 'motorista' ? COL_MOTORISTAS : tipo === 'conferente' ? COL_CONFERENTES : COL_MOTIVOS; }
  function cadastroLista(tipo) {
    const arr = arrCadastro(tipo);
    const ic = tipo === 'motorista' ? '👤' : tipo === 'conferente' ? '🧑‍🔧' : '📝';
    const title = tipo === 'motorista' ? 'Motoristas de entrega' : tipo === 'conferente' ? 'Conferentes' : 'Motivos de devolução';
    const ph = tipo === 'motorista' ? 'Nome do motorista' : tipo === 'conferente' ? 'Nome do conferente' : 'Ex.: Cliente fechado';
    return `<div class="tc" style="padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px"><b>${ic} ${title}</b></div>
      <div style="display:flex;gap:7px;margin-bottom:10px"><input class="field" id="recusas-${tipo}-novo" placeholder="${ph}"><button class="btn btn-primary btn-sm" data-recusa-add="${tipo}">Adicionar</button></div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto">${arr.length ? arr.map(x => `<div style="display:flex;align-items:center;justify-content:space-between;border:1px solid var(--border);border-radius:8px;padding:8px 10px"><span>${esc(x.nome || '')}${tipo === 'motorista' && x.placa ? ' <small style="color:var(--muted)">(' + esc(x.placa) + ')</small>' : ''}${x.ativo === false ? ' <small style="color:var(--muted)">(inativo)</small>' : ''}</span><div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm" data-recusa-toggle="${tipo}:${esc(x._id)}">${x.ativo === false ? 'Ativar':'Inativar'}</button><button class="btn btn-ghost btn-sm" data-recusa-del="${tipo}:${esc(x._id)}">🗑️</button></div></div>`).join('') : '<div class="empty-sub">Nenhum cadastro ainda.</div>'}</div>
    </div>`;
  }

  // ── Importação em massa de Motoristas + Motivos (+ Placa) por planilha ──
  // Pedido ao vivo do usuário: subir um arquivo (colunas Veículo/Motorista,
  // Placa, Motivo) e cadastrar tudo de uma vez, sem duplicar quem já
  // existe. Mesmo XLSX (SheetJS) já vendorizado e usado em
  // 71-producao-excel.js; header:1 (array de arrays) porque a 1ª coluna às
  // vezes é "Veículo" (roteiro/frota) e às vezes é nome de motorista —
  // tratamos as duas como a mesma coisa (identidade de quem/o quê saiu
  // pra entrega), sem tentar adivinhar qual é qual.
  async function lerPlanilhaMotoristasMotivos(file) {
    if (!global.XLSX) throw new Error('Biblioteca do Excel não carregada.');
    const buf = await file.arrayBuffer();
    const wb = global.XLSX.read(buf, { type: 'array' });
    const aba = wb.SheetNames[0];
    if (!aba) return [];
    const linhas = global.XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' });
    // A 1ª linha costuma ser cabeçalho (Veículo/Placa/Motivo) — pula se
    // parecer texto de cabeçalho, mantém se já for dado de verdade.
    const semCabecalho = (linhas.length && /ve[ií]culo|motorista/i.test(String(linhas[0][0] || '')))
      ? linhas.slice(1) : linhas;
    return semCabecalho
      .map(l => ({ motorista: String(l[0] || '').trim(), placa: String(l[1] || '').trim(), motivo: String(l[2] || '').trim() }))
      .filter(l => l.motorista || l.motivo);
  }
  async function lerImportacaoCadastros() {
    const input = document.getElementById('recusas-import-cadastros-arquivo');
    const file = input?.files?.[0];
    if (!file) { global.showToast?.('Selecione uma planilha.', 'error'); return; }
    try {
      const linhas = await lerPlanilhaMotoristasMotivos(file);
      const motoristasExistentes = new Set(_motoristas.map(m => normUpper(m.nome)));
      const motivosExistentes = new Set(_motivos.map(m => normUpper(m.nome)));
      const placaPorMotorista = new Map();
      const motoristasNovos = new Map();
      const motivosNovos = new Map();
      linhas.forEach(l => {
        if (l.motorista) {
          const key = normUpper(l.motorista);
          if (l.placa) placaPorMotorista.set(key, l.placa);
          if (!motoristasExistentes.has(key) && !motoristasNovos.has(key)) motoristasNovos.set(key, { nome: l.motorista, placa: l.placa || '' });
        }
        if (l.motivo) {
          const key = normUpper(l.motivo);
          if (!motivosExistentes.has(key) && !motivosNovos.has(key)) motivosNovos.set(key, { nome: l.motivo });
        }
      });
      // Motorista já cadastrado, mas sem placa — a planilha completa o que faltava, nunca sobrescreve uma placa já preenchida à mão.
      const motoristasParaAtualizarPlaca = _motoristas
        .filter(m => !m.placa && placaPorMotorista.has(normUpper(m.nome)))
        .map(m => ({ _id: m._id, nome: m.nome, placaNova: placaPorMotorista.get(normUpper(m.nome)) }));
      _previewImportacaoCadastros = {
        totalLinhas: linhas.length,
        motoristasNovos: [...motoristasNovos.values()],
        motivosNovos: [...motivosNovos.values()],
        motoristasParaAtualizarPlaca,
      };
      desenharCadastros();
    } catch (e) {
      global.showToast?.('Erro ao ler a planilha: ' + (e.message || e), 'error');
    }
  }
  async function salvarImportacaoCadastros() {
    const p = _previewImportacaoCadastros;
    if (!p) return;
    const agora = agoraIso();
    try {
      for (const m of p.motoristasNovos) {
        await fs().collection(COL_MOTORISTAS).add({ nome: m.nome, placa: m.placa || '', ativo: true, criadoEm: agora, atualizadoEm: agora });
      }
      for (const m of p.motivosNovos) {
        await fs().collection(COL_MOTIVOS).add({ nome: m.nome, ativo: true, criadoEm: agora, atualizadoEm: agora });
      }
      for (const m of p.motoristasParaAtualizarPlaca) {
        await fs().collection(COL_MOTORISTAS).doc(m._id).set({ placa: m.placaNova, atualizadoEm: agora }, { merge: true });
      }
      const resumo = `Importação concluída: ${p.motoristasNovos.length} motorista(s) novo(s), ${p.motivosNovos.length} motivo(s) novo(s), ${p.motoristasParaAtualizarPlaca.length} placa(s) preenchida(s).`;
      _previewImportacaoCadastros = null;
      await carregarDados();
      desenharCadastros();
      global.showToast?.(resumo, 'success');
    } catch (e) {
      global.showToast?.('Erro ao salvar importação: ' + (e.message || e), 'error');
    }
  }
  function renderPreviewImportacaoCadastros() {
    const p = _previewImportacaoCadastros;
    if (!p) return '';
    if (!p.motoristasNovos.length && !p.motivosNovos.length && !p.motoristasParaAtualizarPlaca.length) {
      return '<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px;font-size:.78rem;color:var(--muted)">Nada novo pra importar — todos os motoristas e motivos dessa planilha já estão cadastrados.</div>';
    }
    return `<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
      <div style="font-size:.78rem;margin-bottom:8px">${p.totalLinhas} linha(s) lida(s) na planilha · <b>${p.motoristasNovos.length}</b> motorista(s) novo(s) · <b>${p.motivosNovos.length}</b> motivo(s) novo(s) · <b>${p.motoristasParaAtualizarPlaca.length}</b> placa(s) a completar em motorista já cadastrado</div>
      <button class="btn btn-primary" data-recusa-salvar-import-cadastros="1">Confirmar importação</button>
    </div>`;
  }

  // PEDIDO AO VIVO (usuário: "as partes de cadastro da parte de recebimento
  // fazer em um menu só... deixar bem separado e organizado") — Motorista/
  // Motivo/Conferente + a importação em massa por planilha viviam
  // MISTURADOS dentro da própria tela de Notas Retornadas (entre o bloco de
  // sincronização Bluesoft e a tabela principal). Viraram uma tela própria
  // (nav "Cadastros", dentro do grupo Notas Retornadas da sidebar) — mesmas
  // coleções/permissão de sempre, só a organização visual mudou.
  function desenharCadastros() {
    const pagina = document.getElementById('page-recebimento-recusas-cadastros');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">🗂️ Cadastros — Notas Retornadas</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Motoristas de entrega, motivos de devolução e conferentes usados ao registrar um retorno.</div></div>
        <button class="btn btn-ghost" data-recusa-cad-atualizar="1">↻ Atualizar</button>
      </div>
      <div class="tc" style="padding:14px;margin:14px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>📥 Importar Motoristas + Motivos (planilha)</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Colunas: Veículo/Motorista, Placa, Motivo. Cadastra o que ainda não existe — nunca duplica.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="recusas-import-cadastros-arquivo" type="file" accept=".xlsx,.xls,.csv" style="max-width:280px"><button class="btn btn-ghost" data-recusa-ler-import-cadastros="1">Ler planilha</button></div></div>
        ${renderPreviewImportacaoCadastros()}
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:14px">${cadastroLista('motorista')}${cadastroLista('motivo')}${cadastroLista('conferente')}</div>`;
    ligarEventosCadastros();
    global.aplicarPermissoesAnalista?.();
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-recusas');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">↩️ Notas Retornadas</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Importe DANFEs e acompanhe os retornos conferidos pelo coletor. Motorista/Motivo/Conferente ficam na aba <b>Cadastros</b>.</div></div>
        <button class="btn btn-ghost" data-recusa-atualizar="1">↻ Atualizar</button>
      </div>
      ${resumoCards()}
      <div class="tc" style="padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>🔄 Sincronizar notas com a Bluesoft</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Busca as notas de entrada dos últimos 30 dias direto na Bluesoft (e atualiza vendedor/supervisor e motivo/volume (via XML) de cada uma). Nada é gravado até você revisar e clicar em Salvar.</div></div><button class="btn btn-primary" data-recusa-sync-bluesoft="1">Buscar</button></div>
        ${_ultimoDiagVendedores ? `<div style="font-size:.72rem;color:var(--muted);margin:-4px 0 10px;padding:8px 10px;border-radius:8px;background:#f3f4f6">${_ultimoDiagVendedores}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0;padding:10px 12px;border-radius:8px;background:#eef7f0;border:1px solid #cfe8d6"><div style="font-size:.75rem;color:#1E6F4E"><b>⏱️ Automático:</b> o sistema já busca e salva sozinho, 3x ao dia (06h, 14h e 17h) — sem precisar clicar em nada. Esse quadro (${_preview.length ? 'Buscar' : 'acima'}) continua servindo pra revisar/importar por PDF quando quiser.</div><button class="btn btn-ghost btn-sm" data-recusa-sync-agora="1" style="white-space:nowrap">▶ Rodar automático agora</button></div>
        ${_ultimoDiagAutomatico ? `<div style="font-size:.72rem;color:var(--muted);margin:-4px 0 10px;padding:8px 10px;border-radius:8px;background:#f3f4f6">${_ultimoDiagAutomatico}</div>` : ''}
        <div style="border-top:1px solid var(--border);margin:14px 0;padding-top:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>📄 Importar DANFE em PDF (alternativa manual)</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Use quando a nota não aparecer na sincronização Bluesoft. Selecione vários PDFs; revise antes de salvar.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="recusas-pdfs" type="file" accept="application/pdf,.pdf" multiple style="max-width:320px"><button class="btn btn-ghost" data-recusa-ler-pdfs="1">Ler PDFs</button></div></div>
        </div>
        <div id="recusas-preview">${renderPreview()}</div>
        <div style="margin-top:10px"><button class="btn btn-primary" data-recusa-salvar-import="1" ${_preview.length ? '' : 'disabled'}>Salvar importação (${_preview.length})</button></div>
      </div>
      <div class="tc" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>📋 Notas retornadas registradas</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">O volume esperado fica visível somente aqui no Analista. Tratamento é sempre separado da Natureza da nota — nunca sobrescreve o dado importado.</div></div><button class="btn btn-ghost" data-recusa-exportar="1">⬇ Exportar Excel</button></div>
        ${filtrosHtml()}
        <div id="recusas-tabela">${renderRecusasTabela()}</div>
      </div>`;
    ligarEventos();
    global.aplicarPermissoesAnalista?.();
  }

  async function lerPdfs() {
    const input = document.getElementById('recusas-pdfs');
    const files = Array.from(input?.files || []);
    if (!files.length) { global.showToast?.('Selecione pelo menos um PDF.', 'error'); return; }
    _preview = [];
    const host = document.getElementById('recusas-preview');
    if (host) host.innerHTML = '<div class="empty"><div class="empty-title">Lendo PDFs...</div><div class="empty-sub">Aguarde enquanto as notas são identificadas.</div></div>';
    for (const file of files) {
      try {
        const text = await textoDoPdf(file);
        _preview.push({ fileName:file.name, ...parseDanfeText(text), erro:'' });
      } catch (e) {
        _preview.push({ fileName:file.name, chave:'', numeroNota:'', volumes:'', destinatario:'', dataEmissao:'', transportadora:'', informacoesComplementares:'', erro:e.message || String(e) });
      }
    }
    desenhar();
    global.showToast?.(`${_preview.length} PDF(s) processado(s). Revise e salve.`, 'success');
  }

  // Busca+normaliza direto da Bluesoft e cai na MESMA pré-visualização/
  // salvamento já usados pelo import de PDF (mesmo _preview, mesma
  // renderPreview(), mesma salvarImportacao()) — nada é gravado até o
  // Analista clicar em "Salvar importação".
  // dd/MM/yyyy — mesmo formato exigido pela Bluesoft, mesma janela de 30
  // dias que obterNotasRetornoBluesoft({}) usa por padrão internamente
  // (não exposta por ela, então recalculada aqui pra pedir a comissão do
  // MESMO período das notas).
  function _janela30DiasBR() {
    const fmt = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    const fim = new Date(); const inicio = new Date(); inicio.setDate(inicio.getDate() - 30);
    return { dataInicial: fmt(inicio), dataFinal: fmt(fim) };
  }
  // Pedido ao vivo do usuário: "essas atualizações via api tem como colocar
  // horarios programados para atualizar automaticamente" — escolheu rodar
  // sozinho (busca E salva, sem revisão manual) 3x ao dia. A lógica real
  // roda inteira no servidor (functions/index.js,
  // sincronizarNotasRetornadasAgendado/Agora) — este botão só CHAMA o
  // mesmo gatilho que o agendamento usa, pra testar sem esperar o próximo
  // horário (08h/13h/18h).
  async function rodarSincronizacaoAutomaticaAgora() {
    const btn = document.querySelector('[data-recusa-sync-agora]');
    if (btn) { btn.disabled = true; btn.textContent = 'Rodando...'; }
    try {
      const callable = firebase.app().functions('southamerica-east1').httpsCallable('sincronizarNotasRetornadasAgora');
      const resposta = await callable({});
      const resultados = resposta?.data?.resultados || [];
      const totalSalvas = resultados.reduce((s, r) => s + (r.salvas || 0), 0);
      const resumo = resultados.map(r => r.erro ? `${r.loja}: erro (${r.erro})` : r.pulou ? `${r.loja}: ${r.pulou}` : `${r.loja}: ${r.salvas}/${r.encontradas} salva(s)${r.reaproveitadas ? `, ${r.reaproveitadas} reaproveitada(s) sem buscar XML de novo` : ''}${r.removidas ? `, ${r.removidas} venda(s) já entregue(s) removida(s)` : ''}`).join(' · ');
      _ultimoDiagAutomatico = `Rodou agora: ${totalSalvas} nota(s) salva(s) no total. ${resumo}`;
      global.showToast?.(`Sincronização automática rodou: ${totalSalvas} nota(s) salva(s).`, 'success');
      await carregarDados();
      desenhar();
    } catch (e) {
      _ultimoDiagAutomatico = `Falha ao rodar agora: ${e.message || e}`;
      global.showToast?.('Erro ao rodar sincronização automática: ' + (e.message || e), 'error');
      desenhar();
    }
  }
  async function sincronizarBluesoft() {
    _preview = [];
    const host = document.getElementById('recusas-preview');
    if (host) host.innerHTML = '<div class="empty"><div class="empty-title">Buscando na Bluesoft...</div><div class="empty-sub">Notas de entrada e devolução dos últimos 30 dias, venda faturada ainda não entregue dos últimos 6 meses, e o vendedor de cada uma. Pode levar alguns segundos.</div></div>';
    try {
      const notas = await global.obterNotasRetornoBluesoft?.({});
      if (!notas) throw new Error('Integração com a Bluesoft não está disponível.');
      // Pedido ao vivo do usuário: "não quero que consulte todos os
      // clientes cadastrados... tem que trazer os que tem as notas...
      // a partir das notas trazer os vendedores" — busca comissões só do
      // MESMO período das notas (não o cadastro de clientes inteiro) e
      // casa por número de NF/CNPJ; melhor esforço, se falhar as notas
      // continuam aparecendo, só sem vendedor/gerente preenchidos.
      // Diagnóstico da 2ª fonte (devolução "em aberto", via comissões-
      // vendedores por data de emissão) — pedido ao vivo do usuário
      // relatado depois do primeiro deploy dessa correção: sem isso, se
      // essa busca falhar por trás (permissão da API, parâmetro rejeitado),
      // a tela mostrava exatamente o mesmo resultado de antes e não dava
      // pra saber se a correção rodou ou nem chegou a tentar.
      // Diagnóstico da fonte principal (notas de entrada) — pedido ao vivo
      // do usuário: "vou em outra aba ele para e tenho que começar de
      // novo". Antes, se essa fonte falhasse (timeout depois de um tempo
      // com a aba em segundo plano, por exemplo), TUDO era descartado —
      // agora ela também é melhor esforço, e mostra aqui se isso aconteceu
      // em vez de sumir com o resultado inteiro sem explicação.
      const diagFontePrincipal = notas.diagnosticoFontePrincipal;
      const diagFontePrincipalTxt = (diagFontePrincipal && !diagFontePrincipal.ok)
        ? ` ⚠️ A busca de notas de entrada falhou: ${diagFontePrincipal.erro} (as devoluções/vendas abaixo, se houver, continuam válidas — clique em "Buscar" de novo pra tentar essa parte).`
        : '';
      const diagSegundaFonte = notas.diagnosticoSegundaFonte;
      const diagSegundaFonteTxt = diagSegundaFonte
        ? (diagSegundaFonte.ok
            ? ` Devolução "em aberto" (via Recebimentos, já sincronizado): ${diagSegundaFonte.totalBruto} nota(s) de devolução no período, ${diagSegundaFonte.totalExtras} nova(s) adicionada(s) aqui (o resto já tinha vindo pela via principal).`
            : ` ⚠️ A busca de devolução "em aberto" falhou: ${diagSegundaFonte.erro} (a lista acima é só da via principal, sem essa parte).`)
        : '';
      // Pedido ao vivo do usuário: "é para ve notas faturadas ainda nao
      // entregues" — 3ª fonte (GET /api/venda/pedidovenda, status
      // FATURADO_POR_NOTA_FISCAL), com diagnóstico visível pelo mesmo
      // motivo da 2ª: uma falha silenciosa fica indistinguível de "não
      // tinha nenhuma faturada pendente".
      const diagTerceiraFonte = notas.diagnosticoTerceiraFonte;
      const diagTerceiraFonteTxt = diagTerceiraFonte
        ? (diagTerceiraFonte.ok
            ? ` Venda faturada ainda não entregue: ${diagTerceiraFonte.totalBruto} pedido(s) no período, ${diagTerceiraFonte.totalExtras} nova(s) adicionada(s) aqui.${diagTerceiraFonte.falhasVendedor ? ` ⚠️ ${diagTerceiraFonte.falhasVendedor} vendedor(es) não foram encontrados (pode ser limite de requisições da Bluesoft — clique em "Buscar" de novo pra tentar de novo, não necessariamente é que a nota não tem vendedor).` : ''}`
            : ` ⚠️ A busca de venda faturada ainda não entregue falhou: ${diagTerceiraFonte.erro}.`)
        : '';
      let enriquecidas = notas;
      try {
        enriquecidas = await global.enriquecerNotasComVendedorPorComissao?.(notas, { ..._janela30DiasBR(), tipoPedido: 'TODOS' }) || notas;
        const comVendedor = enriquecidas.filter(n => n.vendedorNome).length;
        _ultimoDiagVendedores = `Última busca: ${comVendedor} de ${notas.length} nota(s) com vendedor encontrado (via comissões do período — sem consultar o cadastro de clientes inteiro).${diagFontePrincipalTxt}${diagSegundaFonteTxt}${diagTerceiraFonteTxt}`;
      } catch (e) {
        _ultimoDiagVendedores = `Falha ao buscar vendedor das notas: ${e.message || e} (as notas foram buscadas mesmo assim, só sem vendedor/gerente preenchidos)${diagFontePrincipalTxt}${diagSegundaFonteTxt}${diagTerceiraFonteTxt}`;
        console.warn('[Notas Retornadas] Falha ao enriquecer com vendedor, seguindo sem isso:', e?.message || e);
      }
      // Pedido ao vivo do usuário: "se eu fizer outra busca... ela já tem
      // as notas salvas, e já com o XML gravado... não precisaria buscar
      // de novo". `_notas` (já carregado por carregarDados(), e sempre
      // recarregado logo após salvar) traz o que já está gravado — reusa o
      // volume já resolvido em vez de buscar o XML de novo pra nota que já
      // foi processada numa busca anterior. Só reaproveita valor > 0
      // (volume genuinamente confirmado) — um doc salvo com 0 pode só
      // significar "nunca chegou a carregar", então esse continua sendo
      // buscado normalmente.
      const notasSalvasPorChave = new Map(_notas.map(x => [x.chave, x]));
      _preview = enriquecidas.map(n => {
        const salva = notasSalvasPorChave.get(n.chave);
        const volumeJaSalvo = salva && Number(salva.volumes) > 0 ? String(salva.volumes) : '';
        return {
          fileName: 'Bluesoft', chave: n.chave, numeroNota: n.numeroNota, volumes: volumeJaSalvo, destinatario: n.destinatarioNome,
          // "Informações complementares" (motivo do rodapé do DANFE, XML
          // <infCpl>) não vem nesta busca — só o botão "Buscar no XML" ou o
          // import de PDF conseguem ler isso. Mas o registro de comissão
          // (usado pra achar o vendedor) às vezes já tem um motivo de
          // devolução PRÓPRIO — usa como ponto de partida quando existir,
          // sem impedir de trocar por "Buscar no XML" depois.
          dataEmissao: n.dataEmissao || '', transportadora: '', informacoesComplementares: n.motivoDevolucaoComissao || '', erro: '',
          valorTotal: Number(n.valorTotal) || 0,
          serie: n.serie || '', cfop: n.cfop || '', naturezaLabel: n.naturezaLabel || '', tipoOperacao: n.tipoOperacao || '', destinatarioCnpj: n.destinatarioCnpj || '',
          notaOriginalChave: n.notaOriginalChave || null, notaOriginalNumero: n.notaOriginalNumero || null,
          itens: n.itens || [], pareceDevolucao: !!n.pareceDevolucao, origemImportacao: 'BLUESOFT',
          statusRecebimento: n.statusRecebimento || '',
          vendedorNome: n.vendedorNome || '', vendedorEmail: n.vendedorEmail || '',
          supervisorNome: n.supervisorNome || '', supervisorEmail: n.supervisorEmail || '',
        };
      });
      desenhar();
      global.showToast?.(`${_preview.length} nota(s) encontrada(s) na Bluesoft. Buscando volume no XML só de quem ainda não tem...`, 'success');
      await _autoBuscarXmlTodasPreview();
    } catch (e) {
      desenhar();
      global.showToast?.('Erro ao sincronizar com a Bluesoft: ' + (e.message || e), 'error');
    }
  }

  // Busca em massa foi tentada, revertida, e reativada no mesmo dia: o
  // "erro 400" que apareceu ao vivo era a Bluesoft respondendo legitimamente
  // "XML não encontrado" pra notas específicas (confirmado testando direto
  // contra a API real) — não um bug sistêmico no código. Cada link S3 é
  // gerado na hora (válido só 1 minuto) e baixado imediatamente dentro do
  // próprio try da nota, então o tamanho do lote não afeta a validade do
  // link de ninguém. `_precisaBuscarXml` já filtra fora as notas de
  // devolução (pedido ao vivo do usuário) — só venda chega até aqui, e só
  // pra buscar volume.
  async function _autoBuscarXmlTodasPreview() {
    const alvos = _preview.map((p, i) => ({ p, i })).filter(({ p }) => p.origemImportacao === 'BLUESOFT' && p.chave && _precisaBuscarXml(p));
    if (!alvos.length) return;
    const TAMANHO_LOTE = 6;
    let sucessos = 0, falhas = 0;
    for (let i = 0; i < alvos.length; i += TAMANHO_LOTE) {
      const lote = alvos.slice(i, i + TAMANHO_LOTE);
      await Promise.all(lote.map(async ({ p, i: idx }) => {
        try {
          const dados = await global.obterDadosXmlNota?.(p.chave);
          if (!_preview[idx]) return; // pode ter sido removida/redesenhada nesse meio tempo
          // Lê o valor ATUAL do campo (não o _preview[idx].volumes em
          // memória) — a tela já fica visível e interativa antes desse
          // lote terminar, então o Analista pode ter digitado um volume
          // manualmente nesse meio tempo; nunca sobrescreve isso.
          const inputVolAtual = document.querySelector('[data-recprev-vol="' + idx + '"]');
          const volAtual = String(inputVolAtual ? inputVolAtual.value : (_preview[idx].volumes ?? '')).trim();
          if (dados?.volumes != null && volAtual === '') _preview[idx].volumes = dados.volumes;
          else _preview[idx].volumes = volAtual;
          sucessos++;
        } catch (e) { falhas++; /* melhor esforço — uma nota falhando não impede as outras (pode genuinamente não ter XML disponível) */ }
        _atualizarLinhaPreviewNoDom(idx);
      }));
    }
    global.showToast?.(`Volume lido do XML de ${sucessos} nota(s) de venda${falhas ? ` (${falhas} sem XML disponível — reviste no "Buscar no XML" da linha)` : ''}. Revise e salve.`, falhas ? 'info' : 'success');
  }

  // FASE 8 — modal injetado via JS (mesmo padrão defensivo já usado em
  // 95-recebimento-transbordo.js pra #modal-rebt-editar-completo): funciona
  // mesmo que o analista.html em cache ainda não tenha esse markup.
  function _ensureAtribuirConferenciaModal() {
    let modal = document.getElementById('modal-recusa-atribuir-conferencia');
    if (modal) return modal;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-bg" id="modal-recusa-atribuir-conferencia"><div class="modal" style="max-width:480px">
<div class="modal-title">📋 Solicitar conferência</div>
<div id="recusa-atrib-resumo" style="font-size:.78rem;color:var(--muted);padding:9px 11px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px"></div>
<div class="form-group"><label>Operador responsável</label><select class="field" id="recusa-atrib-operador"><option value="">Selecione...</option></select></div>
<div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="window.closeModal?.('modal-recusa-atribuir-conferencia')">Cancelar</button><button class="btn btn-primary" type="button" onclick="window.confirmarAtribuicaoConferenciaRecusa?.()">Solicitar</button></div>
</div></div>`);
    return document.getElementById('modal-recusa-atribuir-conferencia');
  }
  async function abrirAtribuirConferencia(recusaId) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    _recusaAtribuindoId = recusaId;
    _ensureAtribuirConferenciaModal();
    const resumo = document.getElementById('recusa-atrib-resumo');
    if (resumo) resumo.innerHTML = `<b>${esc((r.notas || []).map(n => 'NF ' + n.numeroNota).join(' • ') || '—')}</b><br>Box ${esc(r.box || '—')}`;
    global.openModal?.('modal-recusa-atribuir-conferencia');
    if (typeof global.divPopularSelectOperadores === 'function') await global.divPopularSelectOperadores('recusa-atrib-operador');
  }
  async function confirmarAtribuicaoConferenciaRecusa() {
    const operador = document.getElementById('recusa-atrib-operador')?.value?.trim();
    if (!operador) { global.showToast?.('Selecione um operador.', 'error'); return; }
    const r = _recusas.find(x => x._id === _recusaAtribuindoId);
    if (!r) return;
    const u = usuarioAtual();
    try {
      // doc(r._id) — id determinístico igual ao da recusa: garante no
      // máximo UMA tarefa por recusa (mesma ideia de _pendDocId em
      // dt_atribuicoes_contagem), sem precisar de índice/where extra pra
      // checar duplicidade.
      await fs().collection(COL_TAREFAS).doc(r._id).set({
        recusaId: r._id, box: r.box || '', notas: r.notas || [],
        atribuidoPara: operador, atribuidoPor: u.email || u.uid || '', atribuidoEm: agoraIso(), status: 'PENDENTE',
      }, { merge:true });
      global.closeModal?.('modal-recusa-atribuir-conferencia');
      await carregarDados();
      desenhar();
      global.showToast?.('Conferência solicitada para ' + operador + '.', 'success');
    } catch (e) { global.showToast?.('Erro ao solicitar conferência: ' + (e.message || e), 'error'); }
  }
  global.confirmarAtribuicaoConferenciaRecusa = confirmarAtribuicaoConferenciaRecusa;

  // FASE 9 — tela de detalhe: junta o que está na RECUSA (retorno/
  // transporte/conferência/tratamento/auditoria) com o que está na NOTA
  // original (recebimento_recusas_notas, por chave — natureza/CFOP/
  // itens/vendedor), sem nunca misturar os dois conceitos num campo só.
  function _ensureDetalheModal() {
    let modal = document.getElementById('modal-recusa-detalhe');
    if (modal) return modal;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-bg" id="modal-recusa-detalhe"><div class="modal" style="max-width:720px;max-height:85vh;overflow:auto">
<div class="modal-title">🔍 Detalhe da nota retornada</div>
<div id="recusa-detalhe-corpo"></div>
<div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="window.closeModal?.('modal-recusa-detalhe')">Fechar</button></div>
</div></div>`);
    return document.getElementById('modal-recusa-detalhe');
  }
  function detalheNotaHtml(r) {
    const notasCompletas = (r.notas || []).map(n => _notas.find(x => x.chave === n.chave) || n);
    return notasCompletas.map(n => `<div class="tc" style="padding:11px;margin-bottom:8px">
      <div style="font-weight:800">NF ${esc(n.numeroNota || '—')}${n.serie ? ' · Série ' + esc(n.serie) : ''}</div>
      <div style="font-size:.76rem;color:var(--muted);margin-top:3px">CFOP ${esc(n.cfop || '—')} · ${esc(n.naturezaLabel || n.tipoOperacao || 'Natureza não informada')}${n.pareceDevolucao ? ' · <span style="color:#b45309">↩️ parece devolução</span>' : ''}</div>
      <div style="font-size:.78rem;margin-top:5px">Destinatário: ${esc(n.destinatario || n.destinatarioNome || '—')}${n.destinatarioCnpj ? ' (' + esc(n.destinatarioCnpj) + ')' : ''}</div>
      ${n.vendedorNome ? `<div style="font-size:.78rem;margin-top:3px">Vendedor: ${esc(n.vendedorNome)}${n.vendedorEmail ? ' — ' + esc(n.vendedorEmail) : ''}</div>` : ''}
      ${n.supervisorNome ? `<div style="font-size:.78rem">Supervisor: ${esc(n.supervisorNome)}${n.supervisorEmail ? ' — ' + esc(n.supervisorEmail) : ''}</div>` : ''}
      ${n.informacoesComplementares ? `<div style="font-size:.78rem;margin-top:5px;padding:8px;border-radius:6px;background:#4a3114;color:#ffd18a"><b>Motivo (informações complementares):</b> ${esc(n.informacoesComplementares)}</div>` : ''}
    </div>`).join('') || '<div class="empty-sub">Sem dados de nota disponíveis.</div>';
  }
  function detalheConferenciaHtml(r) {
    const status = r.statusConferenciaOperacional || 'NAO_REALIZADA';
    if (status === 'NAO_REALIZADA') return '<div style="padding:9px 11px;border-radius:8px;background:#f3f4f6;color:var(--muted);font-size:.8rem">Conferência de produtos: NÃO REALIZADA (só volume foi conferido).</div>';
    const itens = r.itensConferidos || [];
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>GTIN</th><th>Previsto</th><th>Conferido</th></tr></thead><tbody>${itens.map(it => {
      const div = Number(it.qtdConferida) !== Number(it.qtdPrevista);
      return `<tr><td>${esc(it.descricao || '—')}</td><td class="mono">${esc(it.gtin || '—')}</td><td>${Number(it.qtdPrevista) || 0}</td><td style="font-weight:800;color:${div ? '#dc2626' : '#15803d'}">${Number(it.qtdConferida) || 0}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function abrirDetalheRecusa(recusaId) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    _recusaDetalheId = recusaId;
    _ensureDetalheModal();
    const corpo = document.getElementById('recusa-detalhe-corpo');
    if (corpo) corpo.innerHTML = `
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:6px 0">NOTA(S) FISCAL(IS)</div>
      ${detalheNotaHtml(r)}
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:14px 0 6px">RETORNO E TRANSPORTE</div>
      <div class="tc" style="padding:11px"><div>Motorista: ${esc(r.motoristaNome || '—')} · Motivo: ${esc(r.motivoNome || '—')}${r.conferenteNome ? ' · Conferente: ' + esc(r.conferenteNome) : ''}</div><div style="margin-top:4px">Box ${esc(r.box || '—')}${r.pallets != null ? ' · ' + esc(r.pallets) + ' pallet(s)' : ''}</div><div style="margin-top:4px">Volume esperado ${Number(r.volumeEsperado || 0)} · Contado ${Number(r.volumeInformado || 0)}</div></div>
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:14px 0 6px">CONFERÊNCIA DE PRODUTOS</div>
      ${detalheConferenciaHtml(r)}
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:14px 0 6px">AUDITORIA</div>
      <div class="tc" style="padding:11px;font-size:.78rem">
        <div>Criado por ${esc(r.criadoPorEmail || '—')} em ${fmtDataHora(r.criadoEm)}</div>
        ${r.conferenciaConcluidaPorEmail ? `<div style="margin-top:3px">Conferência concluída por ${esc(r.conferenciaConcluidaPorEmail)} em ${fmtDataHora(r.conferenciaConcluidaEm)}</div>` : ''}
        ${r.tratamentoDefinidoPor ? `<div style="margin-top:3px">Tratamento definido por ${esc(r.tratamentoDefinidoPor)} em ${fmtDataHora(r.tratamentoDefinidoEm)}: ${esc(TRATAMENTO_LABELS[r.tratamento || ''] || r.tratamento)}</div>` : ''}
      </div>`;
    global.openModal?.('modal-recusa-detalhe');
  }

  function sincronizarPreviewInputs() {
    document.querySelectorAll('[data-recprev-nf]').forEach(el => { const i=Number(el.dataset.recprevNf); if (_preview[i]) _preview[i].numeroNota=String(el.value || '').trim(); });
    document.querySelectorAll('[data-recprev-vol]').forEach(el => { const i=Number(el.dataset.recprevVol); if (_preview[i]) _preview[i].volumes=String(el.value || '').trim(); });
  }

  async function salvarImportacao() {
    sincronizarPreviewInputs();
    const invalidas = _preview.filter(p => !p.chave || !chaveNfeValida(p.chave) || !p.numeroNota || !Number.isFinite(intVol(p.volumes)) || intVol(p.volumes) < 0);
    if (invalidas.length) { global.showToast?.(`Revise ${invalidas.length} nota(s): chave, número da NF e volumes são obrigatórios.`, 'error'); return; }
    const u = usuarioAtual();
    try {
      for (const p of _preview) {
        await fs().collection(COL_NOTAS).doc(p.chave).set({
          chave:p.chave, numeroNota:String(p.numeroNota), volumes:intVol(p.volumes), destinatario:p.destinatario || '', dataEmissao:p.dataEmissao || '', transportadora:p.transportadora || '', arquivoOrigem:p.fileName || '',
          // Pedido ao vivo do usuário (2026-08-20): alimenta o KPI de Valor
          // dos Indicadores de Retornos — a Bluesoft já traz isso na busca,
          // só nunca tinha sido persistido. Notas salvas ANTES dessa
          // mudança ficam sem esse campo (0).
          valorTotal:Number(p.valorTotal) || 0,
          // Campos aditivos (FASE 3/4) — sempre presentes, com valor vazio/
          // nulo padrão pra quem veio do PDF (que não tem esses dados).
          serie:p.serie || '', cfop:p.cfop || '', naturezaLabel:p.naturezaLabel || '', tipoOperacao:p.tipoOperacao || '', destinatarioCnpj:p.destinatarioCnpj || '',
          notaOriginalChave:p.notaOriginalChave || null, notaOriginalNumero:p.notaOriginalNumero || null,
          // "Informações complementares" (motivo escrito no rodapé do
          // DANFE) — só existe quando a nota veio de PDF; vazio pra quem
          // veio da Bluesoft (a API não tem esse campo, ver comentário em
          // 90-bluesoft-service.js).
          informacoesComplementares:p.informacoesComplementares || '',
          itens:p.itens || [], pareceDevolucao:!!p.pareceDevolucao, origemImportacao:p.origemImportacao || 'PDF',
          // FASE 5 — vendedor/supervisor (nome+email, sem comissão nem
          // gerente, pedido explícito do usuário) vêm do cache já
          // sincronizado, não de uma chamada nova por nota.
          vendedorNome:p.vendedorNome || '', vendedorEmail:p.vendedorEmail || '',
          supervisorNome:p.supervisorNome || '', supervisorEmail:p.supervisorEmail || '',
          ativo:true, atualizadoEm:agoraIso(), atualizadoPor:u.email || u.uid || ''
        }, { merge:true });
      }
      _preview = [];
      await carregarDados();
      desenhar();
      global.showToast?.('Notas importadas com sucesso.', 'success');
    } catch (e) { global.showToast?.('Erro ao salvar importação: ' + (e.message || e), 'error'); }
  }

  async function adicionarCadastro(tipo) {
    const input = document.getElementById(`recusas-${tipo}-novo`);
    const nome = String(input?.value || '').trim();
    if (!nome) { global.showToast?.('Informe o nome.', 'error'); return; }
    const col = colCadastro(tipo);
    const ja = arrCadastro(tipo).some(x => String(x.nome || '').toLowerCase() === nome.toLowerCase());
    if (ja) { global.showToast?.('Esse cadastro já existe.', 'error'); return; }
    try {
      await fs().collection(col).add({ nome, ativo:true, criadoEm:agoraIso(), atualizadoEm:agoraIso() });
      await carregarDados(); desenharCadastros(); global.showToast?.('Cadastro salvo.', 'success');
    } catch(e) { global.showToast?.('Erro ao salvar cadastro: ' + (e.message || e), 'error'); }
  }
  async function toggleCadastro(tipo,id) {
    const item = arrCadastro(tipo).find(x => x._id === id); if (!item) return;
    const col = colCadastro(tipo);
    try { await fs().collection(col).doc(id).set({ ativo:item.ativo === false, atualizadoEm:agoraIso() }, {merge:true}); await carregarDados(); desenharCadastros(); } catch(e){ global.showToast?.('Erro: '+(e.message||e),'error'); }
  }
  async function deletarCadastro(tipo,id) {
    const col = colCadastro(tipo);
    if (!confirm('Excluir este cadastro? Registros antigos de recusa continuarão com o nome salvo no histórico.')) return;
    try { await fs().collection(col).doc(id).delete(); await carregarDados(); desenharCadastros(); } catch(e){ global.showToast?.('Erro: '+(e.message||e),'error'); }
  }

  // Separado de ligarEventos() porque a tabela de recusas é redesenhada
  // sozinha (innerHTML direto) pelos filtros, sem passar por
  // desenhar()/ligarEventos() de novo — os controles dela precisam de um
  // re-wiring próprio pra não ficar sem clique/troca depois de filtrar.
  function ligarBotoesTabela() {
    document.querySelectorAll('[data-recusa-solicitar-conf]').forEach(b => b.addEventListener('click', () => abrirAtribuirConferencia(b.dataset.recusaSolicitarConf)));
    document.querySelectorAll('[data-recusa-detalhe]').forEach(b => b.addEventListener('click', () => abrirDetalheRecusa(b.dataset.recusaDetalhe)));
    document.querySelectorAll('[data-recusa-excluir]').forEach(b => b.addEventListener('click', () => excluirRecusa(b.dataset.recusaExcluir)));
    document.querySelectorAll('[data-recusa-tratamento]').forEach(sel => sel.addEventListener('change', () => alterarTratamento(sel.dataset.recusaTratamento, sel.value)));
  }
  function redesenharTabela() {
    const host = document.getElementById('recusas-tabela');
    if (host) host.innerHTML = renderRecusasTabela();
    ligarBotoesTabela();
  }

  // Mesmo padrão de re-wiring acima, só que pra pré-visualização — o botão
  // "Buscar no XML" precisa continuar clicável depois que uma busca
  // individual redesenha só a prévia (sem passar por desenhar() inteiro,
  // que perderia o estado dos <input> de NF/volume já digitados).
  function ligarBotoesPreview() {
    document.querySelectorAll('[data-recusa-buscar-xml]').forEach(b => b.addEventListener('click', () => buscarMotivoXml(Number(b.dataset.recusaBuscarXml))));
  }
  function redesenharPreview() {
    const host = document.getElementById('recusas-preview');
    if (host) host.innerHTML = renderPreview();
    ligarBotoesPreview();
  }
  // Atualização CIRÚRGICA de UMA linha (só o <input> de volume + as 2
  // células que dependem dele) — usada pela busca automática em lote.
  // Pedido ao vivo do usuário: "a tela fica recarregando, se eu clicar em
  // buscar se a página recarregar ele para". Antes, cada lote de 6 notas
  // chamava redesenharPreview() (substitui o <tbody> inteiro) — com
  // dezenas de notas isso reconstruía a tabela inteira várias vezes
  // seguidas, piscando a tela inteira e perdendo qualquer digitação em
  // andamento numa linha ainda não processada. Nunca chama
  // ligarBotoesPreview() aqui (que re-liga TODO botão da tabela, sem
  // guarda de idempotência) — só liga o botão da própria célula trocada,
  // pra nunca duplicar listener num botão de outra linha que sobreviveu
  // intacto ao lote.
  function _atualizarLinhaPreviewNoDom(idx) {
    const p = _preview[idx];
    if (!p) return;
    const input = document.querySelector('[data-recprev-vol="' + idx + '"]');
    if (input && document.activeElement !== input) input.value = p.volumes;
    const celulaLeitura = document.querySelector('[data-recprev-leitura="' + idx + '"]');
    if (celulaLeitura) {
      celulaLeitura.innerHTML = _celulaLeituraHtml(p, idx);
      const btn = celulaLeitura.querySelector('[data-recusa-buscar-xml]');
      if (btn) btn.addEventListener('click', () => buscarMotivoXml(Number(btn.dataset.recusaBuscarXml)));
    }
    const celulaStatus = document.querySelector('[data-recprev-status="' + idx + '"]');
    if (celulaStatus) celulaStatus.innerHTML = _celulaStatusHtml(p);
  }
  // Ler o XML da nota pra pegar o volume da carga (<vol><qVol>). Só
  // aparece pra nota de VENDA — devolução não busca XML nenhum (pedido ao
  // vivo do usuário, 2026-08-20: "não quero mais o motivo e nem o volume
  // das notas de devolução"), ver `_precisaBuscarXml`. Busca SOB DEMANDA,
  // uma nota por vez — o link S3 expira em 1 minuto, então nunca é
  // buscado em lote pra todo o preview de uma vez.
  async function buscarMotivoXml(i) {
    const p = _preview[i];
    if (!p || !p.chave) return;
    const btn = document.querySelector('[data-recusa-buscar-xml="' + i + '"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }
    // Lê o valor ATUAL do campo na tela (não o _preview[i].volumes em
    // memória, que só é sincronizado no clique de Salvar) — senão um
    // volume que o Analista acabou de digitar, mas ainda não salvou, seria
    // sobrescrito aqui por engano.
    const inputVolAtual = document.querySelector('[data-recprev-vol="' + i + '"]');
    const volAtual = String(inputVolAtual ? inputVolAtual.value : (p.volumes ?? '')).trim();
    try {
      const dados = await global.obterDadosXmlNota?.(p.chave);
      // Só preenche se o Analista ainda não digitou nada — nunca sobrescreve
      // uma contagem manual já feita.
      if (dados?.volumes != null && volAtual === '') _preview[i].volumes = dados.volumes;
      else _preview[i].volumes = volAtual;
      _atualizarLinhaPreviewNoDom(i); // só essa linha — nunca redesenha a tabela inteira (perderia digitação em outras linhas)
      if (dados?.volumes == null) global.showToast?.('O XML dessa nota não tem volumes preenchidos.', 'info');
    } catch (e) {
      global.showToast?.('Não foi possível buscar no XML: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📄 Buscar volume no XML'; }
    }
  }
  // FASE 9 — Tratamento é gravado direto (update pontual), sem passar por
  // carregarDados()+desenhar() inteiro — evita perder a posição de
  // scroll/filtro do Analista só por causa de uma troca de select.
  // Pedido ao vivo do usuário: "ter a opção de excluir notas retornadas
  // registradas" — ação destrutiva (confirm(), mesmo padrão já usado em
  // deletarCadastro), só remove o registro de recebimento_recusas em si;
  // nunca mexe em recebimento_recusas_notas (a nota fiscal continua
  // disponível pra ser importada de novo depois, se for o caso).
  async function excluirRecusa(recusaId) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const notasTxt = (r.notas || []).map(n => n.numeroNota).filter(Boolean).join(', ') || recusaId;
    if (!confirm(`Excluir a nota retornada registrada (NF ${notasTxt})? Essa ação não pode ser desfeita.`)) return;
    try {
      await fs().collection(COL_RECUSAS).doc(recusaId).delete();
      _recusas = _recusas.filter(x => x._id !== recusaId);
      desenhar();
      global.showToast?.('Nota retornada excluída.', 'success');
    } catch (e) { global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error'); }
  }
  async function alterarTratamento(recusaId, valor) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const u = usuarioAtual();
    try {
      await fs().collection(COL_RECUSAS).doc(recusaId).update({ tratamento: valor, tratamentoDefinidoEm: agoraIso(), tratamentoDefinidoPor: u.email || u.uid || '' });
      r.tratamento = valor;
      global.showToast?.('Tratamento atualizado.', 'success');
    } catch (e) { global.showToast?.('Erro ao salvar tratamento: ' + (e.message || e), 'error'); }
  }

  // FASE 10 — Excel: uma linha por ITEM (cabeçalho da nota/retorno
  // repetido em cada linha), mesmo padrão de 71-producao-excel.js
  // (XLSX.utils.json_to_sheet + book_append_sheet + writeFile). Exporta a
  // lista JÁ FILTRADA (mesmo princípio de "exporta o que você está
  // vendo"). Recusa sem itensConferidos (conferência não realizada, ou
  // realizada por volume só) ainda gera uma linha — só com as colunas de
  // produto em branco, nunca desaparece do relatório.
  function linhasExportacao() {
    const linhas = [];
    filtrarRecusas().forEach(r => {
      const notasCompletas = (r.notas || []).map(n => ({ ...(_notas.find(x => x.chave === n.chave) || {}), ...n }));
      const itensPorNota = new Map();
      (r.itensConferidos || []).forEach(it => { const l = itensPorNota.get(it.notaChave) || []; l.push(it); itensPorNota.set(it.notaChave, l); });
      (notasCompletas.length ? notasCompletas : [{}]).forEach(n => {
        const itens = itensPorNota.get(n.chave) || [];
        (itens.length ? itens : [null]).forEach(it => {
          linhas.push({
            'Data/Hora': fmtDataHora(r.criadoEm), 'NF': n.numeroNota || '', 'Série': n.serie || '', 'CFOP': n.cfop || '',
            'Natureza (NF)': n.naturezaLabel || n.tipoOperacao || '', 'Motivo (informações complementares)': n.informacoesComplementares || '', 'Chave': n.chave || '',
            'Destinatário': n.destinatario || n.destinatarioNome || '', 'CNPJ Destinatário': n.destinatarioCnpj || '',
            'Vendedor': n.vendedorNome || '', 'E-mail Vendedor': n.vendedorEmail || '',
            'Supervisor': n.supervisorNome || '', 'E-mail Supervisor': n.supervisorEmail || '',
            'Motorista': r.motoristaNome || '', 'Conferente': r.conferenteNome || '', 'Motivo': r.motivoNome || '',
            'Box': r.box || '', 'Pallets': r.pallets ?? '',
            'Volume Esperado': Number(r.volumeEsperado || 0), 'Volume Contado': Number(r.volumeInformado || 0),
            'Diferença Volume': Number(r.diferencaVolumes || 0), 'Conferência de Volume': r.conferenciaStatus || '',
            'Tratamento (Analista)': TRATAMENTO_LABELS[r.tratamento || ''] || r.tratamento || '',
            'Status Conferência de Produtos': r.statusConferenciaOperacional || 'NAO_REALIZADA',
            'Produto': it?.descricao || '', 'GTIN': it?.gtin || '',
            'Qtd Prevista': it ? (Number(it.qtdPrevista) || 0) : '', 'Qtd Conferida': it ? (Number(it.qtdConferida) || 0) : '',
            'Criado Por': r.criadoPorEmail || '', 'Conferência Concluída Por': r.conferenciaConcluidaPorEmail || '',
          });
        });
      });
    });
    return linhas;
  }
  function exportarNotasRetornadas() {
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    const linhas = linhasExportacao();
    if (!linhas.length) { global.showToast?.('Nenhuma nota retornada pra exportar (confira os filtros).', 'error'); return; }
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(linhas), 'Notas_Retornadas');
    global.XLSX.writeFile(wb, 'notas_retornadas_' + new Date().toISOString().slice(0,10) + '.xlsx');
  }

  function ligarEventos() {
    document.querySelector('[data-recusa-atualizar]')?.addEventListener('click', async()=>{ await carregarDados(); desenhar(); });
    document.querySelector('[data-recusa-exportar]')?.addEventListener('click', exportarNotasRetornadas);
    document.querySelector('[data-recusa-sync-bluesoft]')?.addEventListener('click', sincronizarBluesoft);
    document.querySelector('[data-recusa-sync-agora]')?.addEventListener('click', rodarSincronizacaoAutomaticaAgora);
    document.querySelector('[data-recusa-ler-pdfs]')?.addEventListener('click', lerPdfs);
    document.querySelector('[data-recusa-salvar-import]')?.addEventListener('click', salvarImportacao);
    ligarBotoesTabela();
    ligarBotoesPreview();
    document.getElementById('recusas-filtro')?.addEventListener('input', e => { _filtro=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-periodo-ini')?.addEventListener('change', e => { _filtroPeriodoInicio=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-periodo-fim')?.addEventListener('change', e => { _filtroPeriodoFim=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-tratamento')?.addEventListener('change', e => { _filtroTratamento=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-conferencia')?.addEventListener('change', e => { _filtroConferencia=e.target.value || ''; redesenharTabela(); });
  }

  // Ligação de eventos da tela de Cadastros — separada de ligarEventos()
  // (tela de Notas Retornadas) porque as duas são páginas/renders
  // diferentes agora, cada uma com seu próprio ciclo de re-render.
  function ligarEventosCadastros() {
    document.querySelector('[data-recusa-cad-atualizar]')?.addEventListener('click', async()=>{ await carregarDados(); desenharCadastros(); });
    document.querySelector('[data-recusa-ler-import-cadastros]')?.addEventListener('click', lerImportacaoCadastros);
    document.querySelector('[data-recusa-salvar-import-cadastros]')?.addEventListener('click', salvarImportacaoCadastros);
    document.querySelectorAll('[data-recusa-add]').forEach(b => b.addEventListener('click', () => adicionarCadastro(b.dataset.recusaAdd)));
    document.querySelectorAll('[data-recusa-toggle]').forEach(b => b.addEventListener('click', () => { const [t,id]=b.dataset.recusaToggle.split(':'); toggleCadastro(t,id); }));
    document.querySelectorAll('[data-recusa-del]').forEach(b => b.addEventListener('click', () => { const [t,id]=b.dataset.recusaDel.split(':'); deletarCadastro(t,id); }));
  }

  async function renderRecebimentoRecusas() {
    const pagina = document.getElementById('page-recebimento-recusas');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-title">Carregando Notas Retornadas...</div></div>';
    try { await carregarDados(); desenhar(); } catch(e) { pagina.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar Notas Retornadas</div><div class="empty-sub">${esc(e.message || e)}</div></div>`; }
  }
  async function renderRecebimentoRecusasCadastros() {
    const pagina = document.getElementById('page-recebimento-recusas-cadastros');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-title">Carregando Cadastros...</div></div>';
    try { await carregarDados(); desenharCadastros(); } catch(e) { pagina.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar Cadastros</div><div class="empty-sub">${esc(e.message || e)}</div></div>`; }
  }

  global.renderRecebimentoRecusas = renderRecebimentoRecusas;
  global.renderRecebimentoRecusasCadastros = renderRecebimentoRecusasCadastros;
  global.DTRecusasParser = { parseDanfeText, extrairChave, chaveNfeValida, numeroNotaDaChave };
  // Reaproveitado por 98-recebimento-retornos-indicadores.js pro gráfico
  // "Notas por Ação (Tratamento)" — mesmo rótulo em toda a tela, sem
  // duplicar o mapa em dois arquivos.
  global.TRATAMENTO_LABELS = TRATAMENTO_LABELS;
})(window);
