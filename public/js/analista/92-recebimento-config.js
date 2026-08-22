// Recebimento — Configurações (fase 15/FASE 2a): cadastro de Motoristas,
// Veículos e Docas. Mesmo padrão de cadastro simples já usado em
// 61-producao-maquinas.js (modal estático em analista.html, openModal/
// closeModal, data-* + addEventListener delegado), só sem a parte de
// turnos/ocupação — que aqui não existe.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_MOTORISTAS = 'recebimento_motoristas';
  const COL_VEICULOS = 'recebimento_veiculos';
  const COL_DOCAS = 'recebimento_docas';
  const COL_CONFIG_GERAL = 'recebimento_config_geral';
  const COL_ROTAS = 'recebimento_rotas_transbordo';
  const DOC_CONFIG_GERAL = 'padrao';

  let _motoristas = [];
  let _veiculos = [];
  let _docas = [];
  let _rotas = [];
  let _configGeral = {};
  let _lojasDisponiveis = [];
  let _carregado = false;

  function fs() { return global.getDTFirestore(); }

  // ── Migração pro cadastro global de motorista/veículo (fase 15/FASE 4d)
  // ─────────────────────────────────────────────────────────────────────
  // Motorista/veículo eram presos por loja (`lojas/{lojaId}/recebimento_
  // motoristas`) — bug ao vivo relatado: motorista cadastrado na Matriz
  // dava "código não encontrado" no bip feito na Filial, porque cada loja
  // tinha sua PRÓPRIA lista. `recebimento_motoristas`/`recebimento_veiculos`
  // viraram coleção global (ver firebase-shared.js getDTFirestore() e
  // firestore.rules) — o cadastro antigo por loja, porém, não desaparece
  // sozinho, então cada loja "varre" o que tinha antes UMA vez (marcado em
  // recebimento_config_geral, doc por loja) e copia pro cadastro global,
  // sem duplicar quando duas lojas cadastraram o mesmo código/placa.
  async function _migrarMotoristasVeiculosGlobal() {
    if (_configGeral.motoristasVeiculosMigrados) return false;
    const lojaId = global.getDTLojaAtiva ? global.getDTLojaAtiva() : '';
    const raw = global.getDTRawFirestore ? global.getDTRawFirestore() : null;
    if (!lojaId || !raw) return false;
    try {
      const [snapMotAntigo, snapVeicAntigo] = await Promise.all([
        raw.collection('lojas').doc(lojaId).collection(COL_MOTORISTAS).get(),
        raw.collection('lojas').doc(lojaId).collection(COL_VEICULOS).get(),
      ]);
      const motoristasAntigos = snapMotAntigo.docs.map(d => ({ _id: d.id, ...d.data() }));
      const veiculosAntigos = snapVeicAntigo.docs.map(d => ({ _id: d.id, ...d.data() }));
      const codigosGlobais = new Set(_motoristas.map(m => String(m.codigo || '').toUpperCase()).filter(Boolean));
      const placasGlobais = new Set(_veiculos.map(v => String(v.placa || '').toUpperCase()).filter(Boolean));
      let copiados = 0;
      for (const m of motoristasAntigos) {
        const cod = String(m.codigo || '').toUpperCase();
        if (cod && codigosGlobais.has(cod)) continue; // já existe no global (outra loja já migrou este motorista)
        const { _id, ...dados } = m;
        await fs().collection(COL_MOTORISTAS).add(dados);
        if (cod) codigosGlobais.add(cod);
        copiados++;
      }
      for (const v of veiculosAntigos) {
        const pl = String(v.placa || '').toUpperCase();
        if (pl && placasGlobais.has(pl)) continue;
        const { _id, ...dados } = v;
        await fs().collection(COL_VEICULOS).add(dados);
        if (pl) placasGlobais.add(pl);
        copiados++;
      }
      await fs().collection(COL_CONFIG_GERAL).doc(DOC_CONFIG_GERAL).set({ motoristasVeiculosMigrados: true, atualizadoEm: new Date().toISOString() }, { merge: true });
      _configGeral.motoristasVeiculosMigrados = true;
      return copiados > 0;
    } catch (e) {
      console.warn('[Recebimento] Falha na migração de motoristas/veículos pro cadastro global:', e?.message || e);
      return false;
    }
  }
  // Código fixo por motorista (fase 15/FASE 4b) — pedido ao vivo do
  // usuário: o QR não é mais um por viagem (gerado pelo Analista a cada
  // transbordo); passa a ser um por motorista, permanente, e é o próprio
  // bip desse código no Coletor que cria/continua o transbordo sozinho. O
  // prefixo "MOT-" (em vez de "TRB-", usado nos QR de viagem antigos)
  // ajuda a diferenciar os dois tipos de código na hora de debugar.
  function _gerarCodigoMotorista() {
    return 'MOT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  async function carregarRecebimentoConfig(forcar) {
    if (_carregado && !forcar) return;
    const [snapMot, snapVeic, snapDoca, snapGeral] = await Promise.all([
      fs().collection(COL_MOTORISTAS).get(),
      fs().collection(COL_VEICULOS).get(),
      fs().collection(COL_DOCAS).get(),
      fs().collection(COL_CONFIG_GERAL).doc(DOC_CONFIG_GERAL).get(),
    ]);
    _motoristas = snapMot.docs.map(d => ({ _id: d.id, ...d.data() }));
    _veiculos = snapVeic.docs.map(d => ({ _id: d.id, ...d.data() }));
    _docas = snapDoca.docs.map(d => ({ _id: d.id, ...d.data() }));
    _configGeral = snapGeral.exists ? (snapGeral.data() || {}) : {};
    _carregado = true;
    try { _lojasDisponiveis = (await global.DTLoja?.listar?.()) || []; } catch (e) { _lojasDisponiveis = []; }
    await _carregarRotas(true);

    if (await _migrarMotoristasVeiculosGlobal()) {
      const [snapMot2, snapVeic2] = await Promise.all([fs().collection(COL_MOTORISTAS).get(), fs().collection(COL_VEICULOS).get()]);
      _motoristas = snapMot2.docs.map(d => ({ _id: d.id, ...d.data() }));
      _veiculos = snapVeic2.docs.map(d => ({ _id: d.id, ...d.data() }));
    }
    if (await _migrarRotasTransbordoGlobal()) await _carregarRotas(true);
  }

  async function renderRecebimentoConfig() {
    const pagina = document.getElementById('page-recebimento-config');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarRecebimentoConfig(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharRecebimentoConfig();
  }

  function _linhaAtivo(ativo) { return ativo === false ? '<span class="badge b-gray" style="font-size:.6rem">inativo</span>' : '<span class="badge b-green" style="font-size:.6rem">ativo</span>'; }

  function _desenharRecebimentoConfig() {
    const pagina = document.getElementById('page-recebimento-config');
    if (!pagina) return;
    const motoristas = _motoristas.slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    const veiculos = _veiculos.slice().sort((a, b) => String(a.placa || '').localeCompare(String(b.placa || ''), 'pt-BR'));
    const docas = _docas.slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    const motoristaNome = id => _motoristas.find(m => m._id === id)?.nome || '—';

    pagina.innerHTML = `
      <div style="margin-bottom:16px">
        <div class="page-title" style="font-size:1.15rem">⚙️ Configurações — Recebimento</div>
        <div style="font-size:.74rem;color:var(--muted)">Cadastro de motoristas, veículos e docas usado no registro de chegada</div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:14px">
        <b>🎯 Rotas de Transbordo</b>
        <div style="font-size:.72rem;color:var(--muted);margin:2px 0 10px">Cadastro global, uma vez só — não precisa repetir em cada loja. Uma rota "Remetente → Destino" já habilita os dois lados: a remetente pode despachar transbordo pra destino (o Coletor cria sozinho ao bipar o motorista, perguntando o destino quando houver mais de uma rota saindo da mesma loja), e a destino passa a enxergar o que a remetente despachar pra ela.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
          <div class="form-group" style="flex:1;min-width:180px;margin:0">
            <label>Loja remetente</label>
            <select class="field" id="recconf-rota-remetente">
              <option value="">— Selecione —</option>
              ${_lojasDisponiveis.map(l => `<option value="${esc(l.id)}">${esc(l.nome || l.id)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:1;min-width:180px;margin:0">
            <label>Loja destino</label>
            <select class="field" id="recconf-rota-destino">
              <option value="">— Selecione —</option>
              ${_lojasDisponiveis.map(l => `<option value="${esc(l.id)}">${esc(l.nome || l.id)}</option>`).join('')}
            </select>
          </div>
          <button type="button" class="btn btn-primary btn-sm" data-recrota-adicionar="1">+ Adicionar rota</button>
        </div>
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Remetente</th><th></th><th>Destino</th><th></th></tr></thead>
            <tbody>
              ${_rotas.length ? _rotas.slice().sort((a, b) => String(a.origemNome || '').localeCompare(String(b.origemNome || ''), 'pt-BR')).map(r => `
                <tr>
                  <td><b>${esc(r.origemNome || r.origemLojaId)}</b></td>
                  <td style="text-align:center;color:var(--muted)">→</td>
                  <td>${esc(r.destinoNome || r.destinoLojaId)}</td>
                  <td style="text-align:right"><button type="button" class="acao-lapis" title="Remover rota" data-recrota-excluir="${esc(r._id)}">🗑️</button></td>
                </tr>`).join('') : '<tr><td colspan="4"><div class="empty"><div class="empty-icon">🎯</div><div class="empty-title">Nenhuma rota cadastrada ainda</div></div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b>👤 Motoristas</b>
          <button type="button" class="btn btn-primary btn-sm" data-recmot-novo="1">+ Novo motorista</button>
        </div>
        <div style="font-size:.72rem;color:var(--muted);margin:-4px 0 10px">Cada motorista tem um código de QR fixo — imprime uma vez e reaproveita em toda viagem dele. Bipar esse código no Coletor já cria/continua o transbordo, sem precisar cadastrar viagem por viagem aqui.</div>
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Nome</th><th>Documento</th><th>Telefone</th><th>Transportadora</th><th>Código</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${motoristas.length ? motoristas.map(m => `
                <tr>
                  <td><b>${esc(m.nome)}</b></td>
                  <td class="mono">${esc(m.documento || '—')}</td>
                  <td>${esc(m.telefone || '—')}</td>
                  <td>${esc(m.transportadora || '—')}</td>
                  <td class="mono">${m.codigo ? esc(m.codigo) : '<span style="color:var(--muted)">sem código</span>'}</td>
                  <td>${_linhaAtivo(m.ativo)}</td>
                  <td style="text-align:right;white-space:nowrap">
                    ${m.codigo ? `<button type="button" class="acao-lapis" title="Ver / imprimir QR" data-recmot-ver-qr="${esc(m._id)}">🔳</button>` : `<button type="button" class="acao-lapis" title="Gerar código" data-recmot-gerar-codigo="${esc(m._id)}">➕</button>`}
                    <button type="button" class="acao-lapis" title="Editar" data-recmot-editar="${esc(m._id)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-recmot-excluir="${esc(m._id)}">🗑️</button>
                  </td>
                </tr>`).join('') : '<tr><td colspan="7"><div class="empty"><div class="empty-icon">👤</div><div class="empty-title">Nenhum motorista cadastrado</div></div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b>🚚 Veículos</b>
          <button type="button" class="btn btn-primary btn-sm" data-recveic-novo="1">+ Novo veículo</button>
        </div>
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Placa</th><th>Tipo</th><th>Modelo</th><th>Transportadora</th><th>Motorista habitual</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${veiculos.length ? veiculos.map(v => `
                <tr>
                  <td class="mono"><b>${esc(v.placa)}</b></td>
                  <td>${esc(v.tipo || '—')}</td>
                  <td>${esc(v.modelo || '—')}</td>
                  <td>${esc(v.transportadora || '—')}</td>
                  <td>${esc(motoristaNome(v.motoristaHabitualId))}</td>
                  <td>${_linhaAtivo(v.ativo)}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-recveic-editar="${esc(v._id)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-recveic-excluir="${esc(v._id)}">🗑️</button>
                  </td>
                </tr>`).join('') : '<tr><td colspan="7"><div class="empty"><div class="empty-icon">🚚</div><div class="empty-title">Nenhum veículo cadastrado</div></div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="tc" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b>🚪 Docas</b>
          <button type="button" class="btn btn-primary btn-sm" data-recdoca-novo="1">+ Nova doca</button>
        </div>
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Nome</th><th>Observação</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${docas.length ? docas.map(d => `
                <tr>
                  <td><b>${esc(d.nome)}</b></td>
                  <td>${esc(d.observacao || '—')}</td>
                  <td>${_linhaAtivo(d.ativo)}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-recdoca-editar="${esc(d._id)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-recdoca-excluir="${esc(d._id)}">🗑️</button>
                  </td>
                </tr>`).join('') : '<tr><td colspan="4"><div class="empty"><div class="empty-icon">🚪</div><div class="empty-title">Nenhuma doca cadastrada</div></div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
    global.aplicarPermissoesAnalista?.();
  }

  // ── Motoristas ────────────────────────────────────────────────────────
  // Código gerado já na criação (não só quando alguém lembra de clicar em
  // "gerar") — assim todo motorista novo já sai com QR pronto pra imprimir.
  function recmotNovo() { _abrirModalRecmot({ _novo: true, nome: '', documento: '', telefone: '', transportadora: '', ativo: true, codigo: _gerarCodigoMotorista() }); }
  function recmotEditar(id) { const item = _motoristas.find(m => m._id === id); if (item) _abrirModalRecmot(item); }
  function _abrirModalRecmot(item) {
    document.getElementById('recmot-title').textContent = item._novo ? 'Novo motorista' : 'Editar motorista';
    document.getElementById('recmot-doc-id').value = item._id || '';
    // Código nunca é editado pelo formulário — só carregado aqui e devolvido
    // do mesmo jeito no salvar, pra não trocar o QR já impresso na mão do
    // motorista por engano.
    document.getElementById('recmot-codigo').value = item.codigo || '';
    document.getElementById('recmot-nome').value = item.nome || '';
    document.getElementById('recmot-documento').value = item.documento || '';
    document.getElementById('recmot-telefone').value = item.telefone || '';
    document.getElementById('recmot-transportadora').value = item.transportadora || '';
    document.getElementById('recmot-ativo').value = item.ativo === false ? 'false' : 'true';
    global.openModal?.('modal-recmot');
  }
  async function recmotSalvar() {
    const nome = String(document.getElementById('recmot-nome').value || '').trim();
    if (!nome) { global.showToast?.('Informe o nome do motorista.', 'error'); return; }
    const codigo = document.getElementById('recmot-codigo').value || '';
    const payload = {
      nome, documento: String(document.getElementById('recmot-documento').value || '').trim(),
      telefone: String(document.getElementById('recmot-telefone').value || '').trim(),
      transportadora: String(document.getElementById('recmot-transportadora').value || '').trim(),
      ativo: document.getElementById('recmot-ativo').value !== 'false',
      atualizadoEm: new Date().toISOString(),
    };
    if (codigo) payload.codigo = codigo;
    const docId = document.getElementById('recmot-doc-id').value || '';
    try {
      if (docId) await fs().collection(COL_MOTORISTAS).doc(docId).set(payload, { merge: true });
      else { payload.criadoEm = payload.atualizadoEm; await fs().collection(COL_MOTORISTAS).add(payload); }
      global.closeModal?.('modal-recmot');
      global.showToast?.('Motorista salvo.', 'success');
      await carregarRecebimentoConfig(true);
      _desenharRecebimentoConfig();
    } catch (e) { global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error'); }
  }
  // Backfill pra motorista cadastrado antes desta funcionalidade existir
  // (sem código nenhum ainda) — gera e grava direto, sem abrir o modal.
  async function recmotGerarCodigo(id) {
    const item = _motoristas.find(m => m._id === id);
    if (!item || item.codigo) return;
    try {
      const codigo = _gerarCodigoMotorista();
      await fs().collection(COL_MOTORISTAS).doc(id).set({ codigo, atualizadoEm: new Date().toISOString() }, { merge: true });
      await carregarRecebimentoConfig(true);
      _desenharRecebimentoConfig();
      global.showToast?.('Código gerado.', 'success');
    } catch (e) { global.showToast?.('Erro ao gerar código: ' + (e.message || e), 'error'); }
  }
  function recmotVerQr(id) {
    const item = _motoristas.find(m => m._id === id);
    if (item && item.codigo) global.recbtMostrarQr?.(item.codigo, item.nome);
  }
  async function recmotExcluir(id) {
    const item = _motoristas.find(m => m._id === id);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_MOTORISTAS).doc(id).delete();
        global.showToast?.('Motorista excluído.', 'success');
        await carregarRecebimentoConfig(true);
        _desenharRecebimentoConfig();
      } catch (e) { global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error'); }
    };
    if (global.showConfirm) global.showConfirm('Excluir o motorista "' + item.nome + '"?', executar, { title: 'Excluir motorista', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir o motorista "' + item.nome + '"?')) await executar();
  }

  // ── Veículos ──────────────────────────────────────────────────────────
  function recveicNovo() { _abrirModalRecveic({ _novo: true, placa: '', tipo: '', modelo: '', transportadora: '', motoristaHabitualId: '', ativo: true }); }
  function recveicEditar(id) { const item = _veiculos.find(v => v._id === id); if (item) _abrirModalRecveic(item); }
  function _abrirModalRecveic(item) {
    document.getElementById('recveic-title').textContent = item._novo ? 'Novo veículo' : 'Editar veículo';
    document.getElementById('recveic-doc-id').value = item._id || '';
    document.getElementById('recveic-placa').value = item.placa || '';
    document.getElementById('recveic-tipo').value = item.tipo || '';
    document.getElementById('recveic-modelo').value = item.modelo || '';
    document.getElementById('recveic-transportadora').value = item.transportadora || '';
    const selMotorista = document.getElementById('recveic-motorista');
    if (selMotorista) selMotorista.innerHTML = '<option value="">— Nenhum —</option>' + _motoristas.map(m => `<option value="${esc(m._id)}" ${item.motoristaHabitualId === m._id ? 'selected' : ''}>${esc(m.nome)}</option>`).join('');
    document.getElementById('recveic-ativo').value = item.ativo === false ? 'false' : 'true';
    global.openModal?.('modal-recveic');
  }
  async function recveicSalvar() {
    const placa = String(document.getElementById('recveic-placa').value || '').trim().toUpperCase();
    if (!placa) { global.showToast?.('Informe a placa do veículo.', 'error'); return; }
    const payload = {
      placa, tipo: String(document.getElementById('recveic-tipo').value || '').trim(),
      modelo: String(document.getElementById('recveic-modelo').value || '').trim(),
      transportadora: String(document.getElementById('recveic-transportadora').value || '').trim(),
      motoristaHabitualId: document.getElementById('recveic-motorista').value || '',
      ativo: document.getElementById('recveic-ativo').value !== 'false',
      atualizadoEm: new Date().toISOString(),
    };
    const docId = document.getElementById('recveic-doc-id').value || '';
    try {
      if (docId) await fs().collection(COL_VEICULOS).doc(docId).set(payload, { merge: true });
      else { payload.criadoEm = payload.atualizadoEm; await fs().collection(COL_VEICULOS).add(payload); }
      global.closeModal?.('modal-recveic');
      global.showToast?.('Veículo salvo.', 'success');
      await carregarRecebimentoConfig(true);
      _desenharRecebimentoConfig();
    } catch (e) { global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error'); }
  }
  async function recveicExcluir(id) {
    const item = _veiculos.find(v => v._id === id);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_VEICULOS).doc(id).delete();
        global.showToast?.('Veículo excluído.', 'success');
        await carregarRecebimentoConfig(true);
        _desenharRecebimentoConfig();
      } catch (e) { global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error'); }
    };
    if (global.showConfirm) global.showConfirm('Excluir o veículo "' + item.placa + '"?', executar, { title: 'Excluir veículo', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir o veículo "' + item.placa + '"?')) await executar();
  }

  // ── Docas ─────────────────────────────────────────────────────────────
  function recdocaNovo() { _abrirModalRecdoca({ _novo: true, nome: '', observacao: '', ativo: true }); }
  function recdocaEditar(id) { const item = _docas.find(d => d._id === id); if (item) _abrirModalRecdoca(item); }
  function _abrirModalRecdoca(item) {
    document.getElementById('recdoca-title').textContent = item._novo ? 'Nova doca' : 'Editar doca';
    document.getElementById('recdoca-doc-id').value = item._id || '';
    document.getElementById('recdoca-nome').value = item.nome || '';
    document.getElementById('recdoca-observacao').value = item.observacao || '';
    document.getElementById('recdoca-ativo').value = item.ativo === false ? 'false' : 'true';
    global.openModal?.('modal-recdoca');
  }
  async function recdocaSalvar() {
    const nome = String(document.getElementById('recdoca-nome').value || '').trim();
    if (!nome) { global.showToast?.('Informe o nome/número da doca.', 'error'); return; }
    const payload = {
      nome, observacao: String(document.getElementById('recdoca-observacao').value || '').trim(),
      ativo: document.getElementById('recdoca-ativo').value !== 'false',
      atualizadoEm: new Date().toISOString(),
    };
    const docId = document.getElementById('recdoca-doc-id').value || '';
    try {
      if (docId) await fs().collection(COL_DOCAS).doc(docId).set(payload, { merge: true });
      else { payload.criadoEm = payload.atualizadoEm; await fs().collection(COL_DOCAS).add(payload); }
      global.closeModal?.('modal-recdoca');
      global.showToast?.('Doca salva.', 'success');
      await carregarRecebimentoConfig(true);
      _desenharRecebimentoConfig();
    } catch (e) { global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error'); }
  }
  async function recdocaExcluir(id) {
    const item = _docas.find(d => d._id === id);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_DOCAS).doc(id).delete();
        global.showToast?.('Doca excluída.', 'success');
        await carregarRecebimentoConfig(true);
        _desenharRecebimentoConfig();
      } catch (e) { global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error'); }
    };
    if (global.showConfirm) global.showConfirm('Excluir a doca "' + item.nome + '"?', executar, { title: 'Excluir doca', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir a doca "' + item.nome + '"?')) await executar();
  }

  // ── Rotas de Transbordo (origem→destino), fase 15/FASE 4h ───────────────
  // Pedido ao vivo do usuário: "duas caixinha uma do lado da outra, loja
  // remetente e loja destino" — troca a config antiga por loja (que exigia
  // marcar dos dois lados, e um bug ao vivo surgiu quando um lado
  // esquecia: "gerei de uma loja mas não apareceu para a outra") por uma
  // tabela GLOBAL de rotas, cadastrada uma vez só. Uma rota A→B já habilita
  // os dois sentidos automaticamente: A pode despachar pra B (Coletor usa
  // como destino possível) e B enxerga o que A despacha (Coletor cruza a
  // leitura), sem precisar de nada espelhado do outro lado.
  async function recrotaAdicionar() {
    const remetenteId = document.getElementById('recconf-rota-remetente')?.value || '';
    const destinoId = document.getElementById('recconf-rota-destino')?.value || '';
    if (!remetenteId || !destinoId) { global.showToast?.('Escolha a loja remetente e a loja destino.', 'error'); return; }
    if (remetenteId === destinoId) { global.showToast?.('Remetente e destino não podem ser a mesma loja.', 'error'); return; }
    if (_rotas.some(r => r.origemLojaId === remetenteId && r.destinoLojaId === destinoId)) { global.showToast?.('Essa rota já existe.', 'error'); return; }
    const origemNome = _lojasDisponiveis.find(l => l.id === remetenteId)?.nome || remetenteId;
    const destinoNome = _lojasDisponiveis.find(l => l.id === destinoId)?.nome || destinoId;
    try {
      await fs().collection(COL_ROTAS).add({ origemLojaId: remetenteId, origemNome, destinoLojaId: destinoId, destinoNome, criadoEm: new Date().toISOString() });
      await _carregarRotas(true);
      _desenharRecebimentoConfig();
      global.showToast?.('Rota adicionada.', 'success');
    } catch (e) { global.showToast?.('Erro ao adicionar rota: ' + (e.message || e), 'error'); }
  }
  async function recrotaExcluir(id) {
    const item = _rotas.find(r => r._id === id);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_ROTAS).doc(id).delete();
        await _carregarRotas(true);
        _desenharRecebimentoConfig();
        global.showToast?.('Rota removida.', 'success');
      } catch (e) { global.showToast?.('Erro ao remover rota: ' + (e.message || e), 'error'); }
    };
    if (global.showConfirm) global.showConfirm('Remover a rota "' + item.origemNome + ' → ' + item.destinoNome + '"?', executar, { title: 'Remover rota', icon: '🗑️', okLabel: 'Remover', okClass: 'btn-danger' });
    else if (confirm('Remover essa rota?')) await executar();
  }
  async function _carregarRotas(forcar) {
    if (_rotas.length && !forcar) return;
    const snap = await fs().collection(COL_ROTAS).get();
    _rotas = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  }
  // Migra a config antiga por loja (singular `lojaParceiraId` ou plural
  // `lojasParceiras`, de versões anteriores desta mesma tela) pra rota
  // global — roda uma vez por loja (marcado em recebimento_config_geral),
  // sem duplicar quando a rota já existe (ex.: a outra ponta já migrou a
  // mesma rota, na direção contrária, o que é normal e esperado).
  async function _migrarRotasTransbordoGlobal() {
    if (_configGeral.rotasTransbordoMigradas) return false;
    const lojaId = global.getDTLojaAtiva ? global.getDTLojaAtiva() : '';
    if (!lojaId) return false;
    const antigas = Array.isArray(_configGeral.lojasParceiras) ? _configGeral.lojasParceiras
      : (_configGeral.lojaParceiraId ? [{ id: _configGeral.lojaParceiraId, nome: _configGeral.lojaParceiraNome || _configGeral.lojaParceiraId }] : []);
    try {
      if (antigas.length) {
        const origemNome = _lojasDisponiveis.find(l => l.id === lojaId)?.nome || lojaId;
        for (const p of antigas) {
          if (!p || !p.id) continue;
          if (_rotas.some(r => r.origemLojaId === lojaId && r.destinoLojaId === p.id)) continue;
          await fs().collection(COL_ROTAS).add({ origemLojaId: lojaId, origemNome, destinoLojaId: p.id, destinoNome: p.nome || p.id, criadoEm: new Date().toISOString() });
        }
      }
      await fs().collection(COL_CONFIG_GERAL).doc(DOC_CONFIG_GERAL).set({ rotasTransbordoMigradas: true, atualizadoEm: new Date().toISOString() }, { merge: true });
      _configGeral.rotasTransbordoMigradas = true;
      return antigas.length > 0;
    } catch (e) {
      console.warn('[Recebimento] Falha na migração de rotas de transbordo:', e?.message || e);
      return false;
    }
  }

  global.renderRecebimentoConfig = renderRecebimentoConfig;
  global._recebimentoConfigInternals = { carregar: carregarRecebimentoConfig, motoristas: () => _motoristas, veiculos: () => _veiculos, docas: () => _docas, rotas: () => _rotas, configGeral: () => _configGeral, lojasDisponiveis: () => _lojasDisponiveis, migrarMotoristasVeiculosGlobal: _migrarMotoristasVeiculosGlobal, migrarRotasTransbordoGlobal: _migrarRotasTransbordoGlobal };
  global.recmotSalvar = recmotSalvar;
  global.recmotNovo = recmotNovo;
  global.recmotGerarCodigo = recmotGerarCodigo;
  global.recmotVerQr = recmotVerQr;
  global.recveicSalvar = recveicSalvar;
  global.recdocaSalvar = recdocaSalvar;
  global.recrotaAdicionar = recrotaAdicionar;
  global.recrotaExcluir = recrotaExcluir;

  document.addEventListener('click', function (event) {
    const novoMot = event.target.closest('[data-recmot-novo]'); if (novoMot) { recmotNovo(); return; }
    const editMot = event.target.closest('[data-recmot-editar]'); if (editMot) { recmotEditar(editMot.getAttribute('data-recmot-editar')); return; }
    const delMot = event.target.closest('[data-recmot-excluir]'); if (delMot) { recmotExcluir(delMot.getAttribute('data-recmot-excluir')); return; }
    const gerarCodMot = event.target.closest('[data-recmot-gerar-codigo]'); if (gerarCodMot) { recmotGerarCodigo(gerarCodMot.getAttribute('data-recmot-gerar-codigo')); return; }
    const verQrMot = event.target.closest('[data-recmot-ver-qr]'); if (verQrMot) { recmotVerQr(verQrMot.getAttribute('data-recmot-ver-qr')); return; }
    const addRota = event.target.closest('[data-recrota-adicionar]'); if (addRota) { recrotaAdicionar(); return; }
    const delRota = event.target.closest('[data-recrota-excluir]'); if (delRota) { recrotaExcluir(delRota.getAttribute('data-recrota-excluir')); return; }
    const novoVeic = event.target.closest('[data-recveic-novo]'); if (novoVeic) { recveicNovo(); return; }
    const editVeic = event.target.closest('[data-recveic-editar]'); if (editVeic) { recveicEditar(editVeic.getAttribute('data-recveic-editar')); return; }
    const delVeic = event.target.closest('[data-recveic-excluir]'); if (delVeic) { recveicExcluir(delVeic.getAttribute('data-recveic-excluir')); return; }
    const novoDoca = event.target.closest('[data-recdoca-novo]'); if (novoDoca) { recdocaNovo(); return; }
    const editDoca = event.target.closest('[data-recdoca-editar]'); if (editDoca) { recdocaEditar(editDoca.getAttribute('data-recdoca-editar')); return; }
    const delDoca = event.target.closest('[data-recdoca-excluir]'); if (delDoca) { recdocaExcluir(delDoca.getAttribute('data-recdoca-excluir')); return; }
  });
})(window);
