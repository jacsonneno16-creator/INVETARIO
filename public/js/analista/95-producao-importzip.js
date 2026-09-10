// Produção — Importar ZIP (Configurações). PEDIDO AO VIVO (pendência #2,
// rodada de correção): o item ficava em SEM_TELA mostrando "ainda não
// implementado" — a ausência de uma lib de terceiros pra ler .zip não
// autoriza isso. Implementado um leitor de ZIP PRÓPRIO (sem dependência
// externa nenhuma pra vendorizar): usa só APIs nativas do navegador
// (DataView pra ler o formato binário do ZIP — cabeçalho local, diretório
// central, EOCD — e DecompressionStream('deflate-raw') pra descomprimir,
// a mesma API que qualquer navegador moderno já tem embutida, sem
// precisar baixar nada de lugar nenhum). O original TAMBÉM tem essa tela
// incompleta (handleImportZip, app.js:7638-7675 — lê o ZIP, acha o JSON,
// lista as coleções, e o próprio texto que mostra na tela admite
// "Funcionalidade de restauração completa requer integração com o
// Firestore" — nunca restaura nada de verdade). Aqui restaura de
// verdade, com validação de segurança, lote controlado, modo só-validar,
// histórico e permissão.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ═══════════════════════════════════════════════════════════════════
  // 1) LEITOR DE ZIP — formato binário puro, zero dependências externas
  // ═══════════════════════════════════════════════════════════════════
  const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50MB
  const MAX_ENTRADAS = 500;
  const EXT_PERIGOSAS = /\.(exe|bat|cmd|com|scr|msi|dll|sh|ps1|vbs|jar|app|jse|wsf|apk)$/i;

  class ZipErro extends Error {}

  function _caminhoSeguro(nome) {
    if (!nome) return false;
    if (nome.includes('..')) return false;              // path traversal
    if (nome.startsWith('/') || nome.startsWith('\\')) return false; // absoluto unix
    if (/^[a-zA-Z]:/.test(nome)) return false;           // absoluto windows (C:\...)
    if (EXT_PERIGOSAS.test(nome)) return false;          // executável
    return true;
  }

  // Lê o diretório central do ZIP (lista de arquivos + onde cada um está),
  // sem descomprimir nada ainda — rápido, dá pra listar o conteúdo do ZIP
  // antes de decidir extrair qualquer coisa.
  function lerDiretorioZip(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 22) throw new ZipErro('Arquivo vazio ou pequeno demais pra ser um ZIP.');
    if (arrayBuffer.byteLength > MAX_ZIP_BYTES) throw new ZipErro('Arquivo excede o tamanho máximo permitido (50MB).');
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const EOCD_SIG = 0x06054b50;
    let eocd = -1;
    const min = Math.max(0, bytes.length - 22 - 65536);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd === -1) throw new ZipErro('Arquivo não é um ZIP válido (fim de diretório central não encontrado).');
    const totalEntradas = view.getUint16(eocd + 10, true);
    const tamanhoCD = view.getUint32(eocd + 12, true);
    const offsetCD = view.getUint32(eocd + 16, true);
    if (totalEntradas > MAX_ENTRADAS) throw new ZipErro('ZIP contém mais arquivos do que o permitido (máx. ' + MAX_ENTRADAS + ').');
    if (offsetCD + tamanhoCD > bytes.length || offsetCD < 0) throw new ZipErro('ZIP corrompido — diretório central fora dos limites do arquivo.');

    const CD_SIG = 0x02014b50;
    const entradas = [];
    let ptr = offsetCD;
    for (let i = 0; i < totalEntradas; i++) {
      if (ptr + 46 > bytes.length) throw new ZipErro('ZIP corrompido — entrada de diretório central incompleta.');
      if (view.getUint32(ptr, true) !== CD_SIG) throw new ZipErro('ZIP corrompido — assinatura de diretório central inválida.');
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const uncompSize = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      if (ptr + 46 + nameLen > bytes.length) throw new ZipErro('ZIP corrompido — nome de arquivo incompleto.');
      const nome = new TextDecoder('utf-8').decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      const diretorio = nome.endsWith('/');
      if (!diretorio) {
        if (!_caminhoSeguro(nome)) throw new ZipErro('ZIP contém um caminho de arquivo não seguro ou tipo não permitido: ' + nome);
      }
      entradas.push({ nome, method, compSize, uncompSize, localOffset, diretorio });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return { entradas, bytes, view };
  }

  const LFH_SIG = 0x04034b50;
  async function extrairArquivoZip(zip, entrada) {
    const { bytes, view } = zip;
    const off = entrada.localOffset;
    if (off + 30 > bytes.length || view.getUint32(off, true) !== LFH_SIG) throw new ZipErro('Cabeçalho local inválido para ' + entrada.nome);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const dataStart = off + 30 + nameLen + extraLen;
    const dataEnd = dataStart + entrada.compSize;
    if (dataEnd > bytes.length) throw new ZipErro('Dados corrompidos para ' + entrada.nome);
    const comp = bytes.slice(dataStart, dataEnd);
    if (entrada.method === 0) return comp; // STORED, sem compressão
    if (entrada.method === 8) { // DEFLATE
      if (typeof DecompressionStream === 'undefined') throw new ZipErro('Este navegador não suporta descompressão de ZIP (DecompressionStream indisponível) — use um navegador atualizado.');
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([comp]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    }
    throw new ZipErro('Método de compressão não suportado (' + entrada.method + ') em ' + entrada.nome);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2) VALIDAÇÃO DO BACKUP — lista branca de coleções, formato, tipos
  // ═══════════════════════════════════════════════════════════════════
  // Só estas coleções podem ser restauradas — qualquer outra chave dentro
  // do JSON é ignorada e reportada como "desconhecida", nunca gravada.
  const COLECOES_PERMITIDAS = [
    'producao_maquinas', 'producao_produtos', 'producao_ficha_tecnica', 'producao_setup',
    'producao_registros', 'producao_apontamentos', 'producao_funcionarios',
    'producao_insumos_estoque', 'producao_projecao', 'producao_processos',
    'producao_processos_tipos', 'producao_categorias', 'producao_config',
  ];
  // Chave natural usada pra decidir "atualizar" (documento já existe) vs.
  // "criar" (documento novo) — coleções fora daqui sempre criam (não têm
  // uma chave natural confiável nesta base).
  const CHAVE_NATURAL = {
    producao_maquinas: 'nome',
    producao_produtos: 'cod',
    producao_ficha_tecnica: 'cod',
    producao_categorias: 'nome',
    producao_processos_tipos: 'nome',
  };

  function validarBackupJson(obj) {
    const erros = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { erros.push('O arquivo de backup não é um objeto JSON válido.'); return { ok: false, erros }; }
    if (obj.versao == null) erros.push('Backup sem campo "versao" — não é possível confirmar a compatibilidade do formato.');
    else if (typeof obj.versao !== 'number') erros.push('Campo "versao" precisa ser numérico.');
    if (!obj.colecoes || typeof obj.colecoes !== 'object' || Array.isArray(obj.colecoes)) { erros.push('Backup sem campo "colecoes" (objeto com uma lista de documentos por coleção).'); return { ok: erros.length === 0, erros }; }
    const colecoesDesconhecidas = [];
    const resumo = {};
    for (const nomeCol of Object.keys(obj.colecoes)) {
      const lista = obj.colecoes[nomeCol];
      if (!COLECOES_PERMITIDAS.includes(nomeCol)) { colecoesDesconhecidas.push(nomeCol); continue; }
      if (!Array.isArray(lista)) { erros.push('Coleção "' + nomeCol + '" deveria ser uma lista de registros.'); continue; }
      let malformados = 0;
      lista.forEach(doc => { if (!doc || typeof doc !== 'object' || Array.isArray(doc)) malformados++; });
      resumo[nomeCol] = { total: lista.length, malformados };
    }
    return { ok: erros.length === 0, erros, colecoesDesconhecidas, resumo, dataBackup: obj.exportadoEm || null, versaoBackup: obj.versao ?? null, lojaOrigem: obj.loja || null };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3) ESTADO DA TELA
  // ═══════════════════════════════════════════════════════════════════
  const COL_HIST = 'producao_import_historico';
  let _containerZip = 'page-producao-importzip';
  let _estado = 'idle'; // idle | carregando | erro | pronto | validando | restaurando | concluido
  let _arquivoAtual = null; // {name, size}
  let _backupObj = null;
  let _validacao = null;
  let _mensagemErro = '';
  let _resultadoRestauracao = null; // {criados, atualizados, ignorados, erros[]}
  let _progresso = 0; // 0..100
  let _processando = false; // trava contra duplo clique / dupla importação
  let _somenteValidar = false;

  function fs() { return global.getDTFirestore(); }
  function pode(acao) { return typeof global.temPermissao !== 'function' || global.temPermissao('producao-importacao', acao); }

  function _fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function _resetar() {
    _estado = 'idle'; _arquivoAtual = null; _backupObj = null; _validacao = null; _mensagemErro = ''; _resultadoRestauracao = null; _progresso = 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4) FLUXO: selecionar → ler ZIP → achar JSON → validar → (restaurar)
  // ═══════════════════════════════════════════════════════════════════
  async function processarArquivo(file) {
    if (_processando) return; // duplo clique / dupla importação
    _processando = true;
    try {
      _resetar();
      if (!file) { _processando = false; return; }
      _arquivoAtual = { name: file.name, size: file.size };
      if (!/\.zip$/i.test(file.name)) { _estado = 'erro'; _mensagemErro = 'Extensão inválida — selecione um arquivo .zip.'; _redesenhar(); _processando = false; return; }
      if (file.size > MAX_ZIP_BYTES) { _estado = 'erro'; _mensagemErro = 'Arquivo excede o tamanho máximo permitido (50MB).'; _redesenhar(); _processando = false; return; }
      _estado = 'carregando'; _redesenhar();

      const buffer = await file.arrayBuffer();
      let zip;
      try { zip = lerDiretorioZip(buffer); }
      catch (e) { _estado = 'erro'; _mensagemErro = e.message || 'ZIP corrompido ou inválido.'; _redesenhar(); _processando = false; return; }

      const arquivos = zip.entradas.filter(e => !e.diretorio);
      const jsonEntrada = arquivos.find(e => e.nome.toLowerCase().endsWith('.json'));
      if (!jsonEntrada) { _estado = 'erro'; _mensagemErro = 'Nenhum arquivo .json de backup encontrado dentro do ZIP.'; _arquivoAtual.arquivosZip = arquivos.map(e => e.nome); _redesenhar(); _processando = false; return; }

      let jsonBytes;
      try { jsonBytes = await extrairArquivoZip(zip, jsonEntrada); }
      catch (e) { _estado = 'erro'; _mensagemErro = 'Erro ao descomprimir o backup: ' + (e.message || e); _redesenhar(); _processando = false; return; }

      let obj;
      try { obj = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes)); }
      catch (e) { _estado = 'erro'; _mensagemErro = 'O arquivo .json dentro do ZIP não é um JSON válido: ' + (e.message || e); _redesenhar(); _processando = false; return; }

      const validacao = validarBackupJson(obj);
      _backupObj = obj;
      _validacao = validacao;
      _arquivoAtual.arquivosZip = arquivos.map(e => e.nome);
      _arquivoAtual.jsonNome = jsonEntrada.nome;
      if (!validacao.ok) { _estado = 'erro'; _mensagemErro = validacao.erros.join(' '); _redesenhar(); _processando = false; return; }
      _estado = 'pronto';
      _redesenhar();
    } finally {
      _processando = false;
    }
  }

  async function _gravarEmLotes(nomeCol, docs) {
    // PEDIDO AO VIVO (pendência #2): lotes de 400 (abaixo do limite de 500
    // operações por batch do Firestore) — grande o bastante pra ser
    // rápido, pequeno o bastante pra nunca estourar o limite da API.
    const TAMANHO_LOTE = 400;
    const col = fs().collection(nomeCol);
    const chaveCampo = CHAVE_NATURAL[nomeCol];
    let existentes = new Map();
    if (chaveCampo) {
      try {
        const snap = await col.get();
        snap.docs.forEach(d => { const v = (d.data() || {})[chaveCampo]; if (v != null) existentes.set(String(v), d.id); });
      } catch (e) { /* coleção pode não existir ainda — segue como tudo novo */ }
    }
    let criados = 0, atualizados = 0, ignorados = 0;
    const erros = [];
    for (let i = 0; i < docs.length; i += TAMANHO_LOTE) {
      const fatia = docs.slice(i, i + TAMANHO_LOTE);
      for (const doc of fatia) {
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { ignorados++; continue; }
        try {
          const payload = { ...doc };
          delete payload._firestoreId; delete payload._id;
          const chaveVal = chaveCampo ? doc[chaveCampo] : null;
          const idExistente = chaveVal != null ? existentes.get(String(chaveVal)) : null;
          if (idExistente) { await col.doc(idExistente).set(payload, { merge: true }); atualizados++; }
          else {
            const ref = await col.add(payload);
            if (chaveCampo && chaveVal != null) existentes.set(String(chaveVal), ref.id);
            criados++;
          }
        } catch (e) {
          erros.push({ colecao: nomeCol, mensagem: e.message || String(e) });
        }
      }
      _progresso = Math.round(((i + fatia.length) / docs.length) * 100);
      _redesenhar();
      await new Promise(r => setTimeout(r, 0)); // cede o loop de eventos entre lotes
    }
    return { criados, atualizados, ignorados, erros };
  }

  async function restaurar(somenteValidar) {
    if (_processando) return; // trava duplo clique
    if (!_backupObj || !_validacao || !_validacao.ok) return;
    if (!somenteValidar && !pode('editar')) { global.showToast?.('Sem permissão para restaurar backups da Produção.', 'error'); return; }
    _processando = true;
    _somenteValidar = !!somenteValidar;
    _estado = somenteValidar ? 'validando' : 'restaurando';
    _progresso = 0;
    _redesenhar();
    const agora = new Date().toISOString();
    const totalGeral = { criados: 0, atualizados: 0, ignorados: 0, erros: [] };
    try {
      for (const nomeCol of Object.keys(_backupObj.colecoes)) {
        if (!COLECOES_PERMITIDAS.includes(nomeCol)) continue; // nunca grava coleção fora da lista branca
        const docs = _backupObj.colecoes[nomeCol];
        if (!Array.isArray(docs) || !docs.length) continue;
        if (somenteValidar) {
          const validos = docs.filter(d => d && typeof d === 'object' && !Array.isArray(d)).length;
          totalGeral.ignorados += docs.length - validos;
          continue;
        }
        const r = await _gravarEmLotes(nomeCol, docs);
        totalGeral.criados += r.criados; totalGeral.atualizados += r.atualizados; totalGeral.ignorados += r.ignorados;
        totalGeral.erros.push(...r.erros);
      }
      _resultadoRestauracao = totalGeral;
      _estado = 'concluido';
      if (!somenteValidar) {
        try {
          await fs().collection(COL_HIST).add({
            arquivo: _arquivoAtual?.name || '', usuario: global._currentAnalistaUser?.email || '', loja: global.getDTLojaAtiva?.() || '',
            data: agora, criados: totalGeral.criados, atualizados: totalGeral.atualizados, ignorados: totalGeral.ignorados, erros: totalGeral.erros.length,
          });
        } catch (e) { /* histórico não pode travar a confirmação da restauração */ }
        global.showToast?.('Restauração concluída: ' + totalGeral.criados + ' criado(s), ' + totalGeral.atualizados + ' atualizado(s).', totalGeral.erros.length ? 'warning' : 'success');
      } else {
        global.showToast?.('Validação concluída — nada foi gravado.', 'success');
      }
    } catch (e) {
      _estado = 'erro'; _mensagemErro = 'Erro durante a restauração: ' + (e.message || e);
    } finally {
      _processando = false;
      _redesenhar();
    }
  }

  function cancelar() { _resetar(); _redesenhar(); }

  // ═══════════════════════════════════════════════════════════════════
  // 5) INTERFACE
  // ═══════════════════════════════════════════════════════════════════
  function render(containerId) {
    _containerZip = containerId || 'page-producao-importzip';
    _resetar();
    _redesenhar();
  }

  function _painelPreviaHtml() {
    const v = _validacao;
    const linhasColecoes = Object.entries(v.resumo).map(([nome, info]) => `<tr>
      <td class="mono">${esc(nome)}</td>
      <td style="text-align:right">${info.total.toLocaleString('pt-BR')}</td>
      <td style="text-align:right">${info.malformados ? `<span class="badge b-orange">${info.malformados}</span>` : '—'}</td>
    </tr>`).join('');
    return `
      <div class="tc" style="padding:14px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:8px">📋 Prévia do backup</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:.72rem;margin-bottom:12px">
          <div><span style="color:var(--muted)">Versão:</span> <b>${v.versaoBackup ?? '—'}</b></div>
          <div><span style="color:var(--muted)">Data do backup:</span> <b>${v.dataBackup ? new Date(v.dataBackup).toLocaleString('pt-BR') : '—'}</b></div>
          <div><span style="color:var(--muted)">Loja de origem:</span> <b>${esc(v.lojaOrigem || '—')}</b></div>
          <div><span style="color:var(--muted)">Arquivos no ZIP:</span> <b>${(_arquivoAtual.arquivosZip || []).length}</b></div>
        </div>
        <table class="dt-table"><thead><tr><th>Coleção</th><th style="text-align:right">Registros</th><th style="text-align:right">Malformados</th></tr></thead>
          <tbody>${linhasColecoes || '<tr><td colspan="3">Nenhuma coleção reconhecida no backup.</td></tr>'}</tbody>
        </table>
        ${v.colecoesDesconhecidas && v.colecoesDesconhecidas.length ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(184,144,48,.1);border-radius:6px;font-size:.7rem;color:var(--warn)">⚠️ ${v.colecoesDesconhecidas.length} coleção(ões) desconhecida(s) no backup — <b>serão ignoradas</b>, nunca gravadas: ${v.colecoesDesconhecidas.map(esc).join(', ')}</div>` : ''}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" data-pzip-cancelar>Cancelar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pzip-validar>🔍 Somente validar</button>
          <button type="button" class="btn btn-primary btn-sm" data-pzip-restaurar ${pode('editar') ? '' : 'disabled title="Sem permissão para restaurar"'}>♻️ Restaurar</button>
        </div>
      </div>`;
  }

  function _painelResultadoHtml() {
    const r = _resultadoRestauracao;
    return `<div class="tc" style="padding:14px;margin-top:14px">
      <div style="font-weight:700;margin-bottom:8px">${_somenteValidar ? '🔍 Resultado da validação (nada foi gravado)' : '✅ Resumo da restauração'}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;text-align:center">
        <div class="tc" style="padding:10px"><div style="font-size:1.3rem;font-weight:700;color:var(--success)">${r.criados}</div><div style="font-size:.66rem;color:var(--muted)">Criados</div></div>
        <div class="tc" style="padding:10px"><div style="font-size:1.3rem;font-weight:700;color:var(--orange)">${r.atualizados}</div><div style="font-size:.66rem;color:var(--muted)">Atualizados</div></div>
        <div class="tc" style="padding:10px"><div style="font-size:1.3rem;font-weight:700;color:var(--muted)">${r.ignorados}</div><div style="font-size:.66rem;color:var(--muted)">Ignorados</div></div>
        <div class="tc" style="padding:10px"><div style="font-size:1.3rem;font-weight:700;color:${r.erros.length ? 'var(--danger)' : 'var(--muted)'}">${r.erros.length}</div><div style="font-size:.66rem;color:var(--muted)">Erros</div></div>
      </div>
      ${r.erros.length ? `<div style="margin-top:10px;max-height:160px;overflow-y:auto;font-size:.68rem;color:var(--danger)">${r.erros.slice(0, 30).map(e => `<div>• ${esc(e.colecao)}: ${esc(e.mensagem)}</div>`).join('')}</div>` : ''}
      <div style="margin-top:12px"><button type="button" class="btn btn-ghost btn-sm" data-pzip-cancelar>Nova importação</button></div>
    </div>`;
  }

  function _redesenhar() {
    const pagina = document.getElementById(_containerZip);
    if (!pagina) return;
    const arquivoInfo = _arquivoAtual ? `<div style="font-size:.72rem;color:var(--muted);margin-top:6px">${esc(_arquivoAtual.name)} · ${_fmtBytes(_arquivoAtual.size)}</div>` : '';
    pagina.innerHTML = `
      <div class="tc" style="padding:14px">
        <div style="font-weight:700;margin-bottom:4px">🔄 Importar ZIP</div>
        <div style="font-size:.72rem;color:var(--muted);margin-bottom:12px">Restaura um backup completo da Produção (máquinas, produtos, ficha técnica, setup, programação, realizado, funcionários, estoque de insumos, projeção, processos e categorias) a partir de um arquivo .zip. Usa sempre a loja ativa — nunca altera outras lojas.</div>
        <div id="pzip-dropzone" data-pzip-dropzone style="border:2px dashed var(--border);border-radius:8px;padding:28px 16px;text-align:center;cursor:pointer;background:var(--surface-2)">
          <div style="font-size:1.6rem;margin-bottom:6px">📦</div>
          <div style="font-size:.8rem;font-weight:600">Clique ou arraste o arquivo ZIP aqui</div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:3px">Formato aceito: .zip · máximo 50MB</div>
          <input type="file" id="pzip-input" accept=".zip" style="display:none">
          ${arquivoInfo}
        </div>
        ${_estado === 'carregando' ? `<div style="margin-top:12px;display:flex;align-items:center;gap:8px;font-size:.76rem;color:var(--muted)"><span>⏳</span> Lendo o arquivo ZIP...</div>` : ''}
        ${_estado === 'erro' ? `<div class="tc" style="margin-top:12px;padding:12px;border-left:4px solid var(--danger)"><b style="color:var(--danger)">❌ ${esc(_mensagemErro)}</b>${_arquivoAtual?.arquivosZip ? `<div style="margin-top:6px;font-size:.68rem;color:var(--muted)">Arquivos encontrados no ZIP: ${_arquivoAtual.arquivosZip.map(esc).join(', ') || '(nenhum)'}</div>` : ''}<div style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-pzip-cancelar>Tentar novamente</button></div></div>` : ''}
        ${_estado === 'pronto' ? _painelPreviaHtml() : ''}
        ${(_estado === 'restaurando' || _estado === 'validando') ? `<div class="tc" style="margin-top:12px;padding:14px">
          <div style="font-size:.76rem;margin-bottom:8px">${_estado === 'validando' ? '🔍 Validando' : '♻️ Restaurando'}... ${_progresso}%</div>
          <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;width:${_progresso}%;background:var(--orange);transition:width .15s"></div></div>
        </div>` : ''}
        ${_estado === 'concluido' ? _painelResultadoHtml() : ''}
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6) EVENTOS
  // ═══════════════════════════════════════════════════════════════════
  document.addEventListener('click', e => {
    if (e.target.closest('[data-pzip-dropzone]') && !e.target.closest('input')) {
      const el = document.getElementById(_containerZip)?.querySelector('#pzip-input');
      el?.click();
      return;
    }
    if (e.target.closest('[data-pzip-cancelar]')) { cancelar(); return; }
    if (e.target.closest('[data-pzip-validar]')) { restaurar(true); return; }
    if (e.target.closest('[data-pzip-restaurar]')) {
      const msg = 'Restaurar este backup? Registros existentes (por nome/código) serão ATUALIZADOS; os demais serão criados. Nenhuma coleção fora da lista permitida é gravada, e outras lojas nunca são alteradas.';
      const executar = () => restaurar(false);
      if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Restaurar backup', icon: '♻️', okLabel: 'Restaurar' });
      else if (confirm(msg)) executar();
      return;
    }
  });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'pzip-input') {
      const file = e.target.files && e.target.files[0];
      processarArquivo(file);
      e.target.value = '';
    }
  });
  document.addEventListener('dragover', e => { if (e.target.closest('[data-pzip-dropzone]')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    const dz = e.target.closest('[data-pzip-dropzone]');
    if (!dz) return;
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) processarArquivo(file);
  });

  global.renderProducaoImportarZip = render;
  global._producaoImportZipInternals = { lerDiretorioZip, extrairArquivoZip, validarBackupJson, processarArquivo, restaurar, cancelar, COLECOES_PERMITIDAS };
  global.DTProducao?.registrarInvalidacao?.(() => { _resetar(); });
})(window);
