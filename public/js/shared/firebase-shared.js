// Configuração e bootstrap compartilhados do Firebase
window.DT_FIREBASE_CFG = {
  apiKey: "AIzaSyCpeTNeJUGgn5yEmIIM8aGos9VIN0VqcgA",
  authDomain: "daterrinha-inventario.firebaseapp.com",
  projectId: "daterrinha-inventario",
  storageBucket: "daterrinha-inventario.firebasestorage.app",
  messagingSenderId: "310264955486",
  appId: "1:310264955486:web:16f22d7b5db6f8f2b8a9b4"
};
window.DT_FCOL = {
  inventarios: 'dt_inventarios',
  contagens: 'dt_contagens',
  vazios: 'dt_vazios',
  recontagens: 'dt_recontagens',
  divergencias: 'dt_divergencias',
  coletores: 'dt_coletores',
  locais: 'dt_locais',
  auditorias: 'dt_auditorias',
  auditoriaMeta: 'dt_auditoria_meta',
  auditoriaImp: 'dt_auditoria_imports',
  operadores: 'dt_operadores',
  produtos: 'dt_produtos',
  analistas: 'dt_analistas'
};
// BUG AO VIVO REAL (2026-09-06): "sai do login toda hora" — confirmado que
// analista.html e coletor.html (mesma origem, mesmo Firebase, mesmo nome de
// app "[DEFAULT]") compartilham a MESMA sessão salva do navegador. Com as
// duas abas abertas ao mesmo tempo (uso real: analista acompanhando o
// Dashboard enquanto testa/opera o Coletor), o Firebase Auth sincroniza a
// sessão entre abas via storage (_onStorageEvent/_updateCurrentUser) — logar
// numa aba troca/derruba a sessão da outra na hora, sem passar por nenhum
// catch do app (por isso nada aparecia no Diagnóstico). window.DT_FIREBASE_
// APP_NOME (setado só em coletor.html, ANTES deste arquivo carregar) isola
// o Coletor num app Firebase com nome próprio — chave de persistência
// diferente da do Analista — sem exigir nenhuma mudança nos outros pontos
// que já chamam getDTFirebaseApp()/getDTAuth()/getDTFirestore() sem args.
// REVERTIDO (2026-09-11): o `enablePersistence()` abaixo (ativado em
// 2026-09-10 pra tentar acelerar reabertura de tela) quebrou produção AO
// VIVO — canal "Listen" do Firestore voltando 400/404 em loop, derrubando
// leitura simples (não só tempo real) em várias telas ao mesmo tempo
// (Produtos, BI, Pátio em Tempo Real, Cargas). Mesma classe de instabilidade
// que onSnapshot já causou 2x antes neste projeto (ver histórico de
// 93/95-recebimento-*.js e o revert de 97 no mesmo dia) — revertido na hora
// em vez de investigar em produção, mesmo padrão já estabelecido aqui.
// Não reativar sem investigação cuidadosa, longe de horário de uso ao vivo.
window.getDTFirebaseApp = function () {
  if (!window.firebase) throw new Error('Firebase SDK não carregado.');
  var nome = window.DT_FIREBASE_APP_NOME || '[DEFAULT]';
  try {
    return firebase.app(nome);
  } catch (e) {
    return nome === '[DEFAULT]' ?
      firebase.initializeApp(window.DT_FIREBASE_CFG) :
      firebase.initializeApp(window.DT_FIREBASE_CFG, nome);
  }
};
window.getDTRawFirestore = function () {
  return getDTFirebaseApp().firestore();
};

// Correção estrutural (Prioridade 11 do pedido): "Missing or insufficient
// permissions"/`permission-denied` cru não diz NADA útil pro operador — só
// confunde (é a mesma mensagem genérica pra "não tem permissão", "conta sem
// canal liberado" e "esta carga não é mais sua loja"). Firestore não manda
// detalhe nenhum sobre POR QUE negou, então a mensagem específica só pode
// vir do CONTEXTO que quem chamou já sabia (qual ação, em qual módulo) — daí
// o parâmetro `contexto`, não uma tentativa de adivinhar a partir do erro
// cru. Compartilhado entre Coletor e Analista (os dois carregam este
// arquivo) pra não duplicar o mapa de mensagens nos dois bundles. O erro
// ORIGINAL nunca é escondido — quem chama continua responsável por logar
// (console.error/window.dtAddDiag) pro diagnóstico técnico; esta função só
// decide o texto que o OPERADOR vê.
function traduzirErroPermissao(erro, contexto) {
  if (!erro || erro.code !== 'permission-denied') return null; // não é esse tipo de erro — quem chamou trata como sempre
  contexto = contexto || {};
  if (contexto.mensagem) return contexto.mensagem;
  const acesso = window.DT_USUARIO_ACESSO_ATUAL;
  if (acesso && contexto.canalNecessario && acesso.canais_acesso && acesso.canais_acesso[contexto.canalNecessario] !== true) {
    return 'Seu usuário possui acesso a este aplicativo, mas não ao canal necessário pra esta ação. Peça pro Analista liberar em Usuários e Permissões.';
  }
  if (contexto.acao) return 'Você não possui permissão para ' + contexto.acao + '. Peça pro Analista conferir em Usuários e Permissões.';
  return 'Você não tem permissão para fazer isso (ou esta ação não pertence mais à sua loja). Peça pro Analista conferir em Usuários e Permissões.';
}
window.traduzirErroPermissao = traduzirErroPermissao;
window.isDTAdminMestre = function (user, acesso) {
  return !!(user && acesso && acesso.uid === user.uid && (acesso.admin_mestre === true || acesso.administrador_mestre === true || acesso.perfil === 'administrador'));
};

// ── MULTILOJA ───────────────────────────────────────────────────────────────
// Coleções operacionais são automaticamente direcionadas para
// lojas/{lojaAtiva}/{colecao}. A coleção raiz "lojas" permanece global.
window.DT_LOJA_KEY = 'dt_loja_ativa_v1';
window.getDTLojaAtiva = function () {
  return localStorage.getItem(window.DT_LOJA_KEY) || '';
};
window.setDTLojaAtiva = function (id) {
  const lojaId = String(id || '').trim();
  // Sem o try/catch, um localStorage cheio (QuotaExceededError) quebrava
  // esta função no meio — o evento abaixo nunca disparava, e o clique de
  // login/seleção de loja morria em silêncio sem terminar. Selecionar a
  // loja não deveria depender de conseguir PERSISTIR a preferência.
  try {
    if (lojaId) localStorage.setItem(window.DT_LOJA_KEY, lojaId);else localStorage.removeItem(window.DT_LOJA_KEY);
  } catch (e) {
    console.warn('[DTLoja] Não foi possível salvar a loja ativa (armazenamento cheio?):', e.message);
  }
  window.dispatchEvent(new CustomEvent('dt-loja-alterada', {
    detail: {
      lojaId
    }
  }));
  return lojaId;
};
window.getDTFirestore = function () {
  const raw = window.getDTRawFirestore();
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'collection') {
        return function (nome) {
          const path = String(nome || '');
          // Coleções globais: cadastro de lojas, permissões de usuários e
          // aprovação física dos dispositivos. A aprovação de um coletor é do
          // navegador/aparelho, não da loja selecionada. Motorista/veículo de
          // transbordo também são globais (pedido ao vivo do usuário: "o
          // motorista cadastrado tem que ficar cadastrado para todas as
          // lojas") — um motorista cadastrado na Matriz precisa ser
          // reconhecido pelo código fixo também na Filial. As rotas de
          // transbordo (origem→destino) também são globais e cadastradas UMA
          // vez só — um bug ao vivo apareceu quando cada loja precisava
          // configurar a "loja parceira" separadamente dos dois lados
          // (esquecer um lado deixava o cruzamento funcionando só num
          // sentido); uma rota global elimina essa duplicação.
          // PEDIDO AO VIVO (2026-08-31): "as observações têm que ficar
          // disponíveis para todas as lojas" — cadastro feito com a Matriz
          // selecionada só existia na subcoleção da Matriz; a Filial (ou o
          // Coletor atuando nela) via a lista vazia, e o campo de
          // motivo/observação da carga saía em branco. Mesmo raciocínio já
          // usado abaixo pra motorista/veículo/rota de transbordo.
          if (path === 'lojas' || path.startsWith('lojas/') || path === 'usuarios_acessos' || path === 'dt_coletores' || path === 'recebimento_motoristas' || path === 'recebimento_veiculos' || path === 'recebimento_rotas_transbordo' || path === 'recebimento_observacoes_transbordo') return raw.collection(path);
          const lojaId = window.getDTLojaAtiva();
          if (!lojaId) throw new Error('Nenhuma loja selecionada. Selecione uma loja para continuar.');
          return raw.collection('lojas').doc(lojaId).collection(path);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
};
window.getDTAuth = function () {
  return getDTFirebaseApp().auth();
};
window.DTLoja = {
  async bootstrapAdministrador(user, acessoExistente) {
    if (!user || !acessoExistente || acessoExistente.uid !== user.uid) return null;
    return acessoExistente;
  },
  async listar(apenasAtivas = true) {
    const raw = window.getDTRawFirestore();
    const acesso = window.DT_USUARIO_ACESSO_ATUAL || null;
    let docs = [];
    if (acesso && acesso.acesso_todas_lojas !== true && Array.isArray(acesso.lojas_permitidas)) {
      const permitidas = [...new Set(acesso.lojas_permitidas.map(String).filter(Boolean))];
      const snaps = await Promise.all(permitidas.map(id => raw.collection('lojas').doc(id).get()));
      docs = snaps.filter(d => d.exists);
    } else {
      docs = (await raw.collection('lojas').get()).docs;
    }
    return docs.map(d => ({
      id: d.id,
      ...d.data()
    })).filter(x => !apenasAtivas || x.ativa !== false).filter(x => !acesso || acesso.acesso_todas_lojas === true || Array.isArray(acesso.lojas_permitidas) && acesso.lojas_permitidas.includes(x.id)).sort((a, b) => String(a.nome || a.id).localeCompare(String(b.nome || b.id), 'pt-BR'));
  },
  slug(nome) {
    return String(nome || 'loja').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'loja_' + Date.now();
  },
  async garantirLojaInicial() {
    const lojas = await this.listar(false);
    if (lojas.length) return lojas;
    throw new Error('Nenhuma loja autorizada foi provisionada para este usuário.');
  },
  async selecionarInterativamente(titulo = 'Selecione a loja', forcarEscolha = false) {
    const lojas = await this.garantirLojaInicial();
    const atual = window.getDTLojaAtiva();
    if (!forcarEscolha && atual && lojas.some(l => l.id === atual)) return atual;
    if (!forcarEscolha && lojas.length === 1) {
      window.setDTLojaAtiva(lojas[0].id);
      return lojas[0].id;
    }
    return await new Promise(resolve => {
      let bg = document.getElementById('dt-loja-modal');
      if (bg) bg.remove();
      bg = document.createElement('div');
      bg.id = 'dt-loja-modal';
      bg.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(3,10,18,.86);display:flex;align-items:center;justify-content:center;padding:20px';
      bg.innerHTML = `<div style="width:min(460px,95vw);background:#fff;color:#17202a;border-radius:16px;padding:24px;box-shadow:0 25px 70px rgba(0,0,0,.4)">
        <div style="font-size:1.15rem;font-weight:800;margin-bottom:6px">🏪 ${titulo}</div>
        <div style="font-size:.82rem;color:#667085;margin-bottom:16px">Cada loja possui inventários, coletores e dados separados.</div>
        <select id="dt-loja-modal-select" style="width:100%;padding:12px;border:1px solid #d0d5dd;border-radius:9px;font-size:.95rem">${lojas.map(l => `<option value="${l.id}">${l.nome || l.id}${l.codigo ? ' · ' + l.codigo : ''}</option>`).join('')}</select>
        <button id="dt-loja-modal-ok" style="width:100%;margin-top:14px;padding:12px;border:0;border-radius:9px;background:#1e6f4e;color:#fff;font-weight:800;cursor:pointer">ENTRAR NESTA LOJA</button>
      </div>`;
      document.body.appendChild(bg);
      const seletor = bg.querySelector('#dt-loja-modal-select');
      if (atual && lojas.some(l => l.id === atual)) seletor.value = atual;
      bg.querySelector('#dt-loja-modal-ok').onclick = () => {
        const id = bg.querySelector('#dt-loja-modal-select').value;
        window.setDTLojaAtiva(id);
        bg.remove();
        resolve(id);
      };
    });
  },
  async preencherSelect(selectId, incluirTodas = false) {
    const el = document.getElementById(selectId);
    if (!el) return [];
    const lojas = await this.garantirLojaInicial();
    el.innerHTML = (incluirTodas ? '<option value="">Todas as lojas</option>' : '') + lojas.map(l => `<option value="${l.id}">${l.nome || l.id}</option>`).join('');
    const atual = window.getDTLojaAtiva();
    if (atual && lojas.some(l => l.id === atual)) el.value = atual;else if (lojas[0]) {
      el.value = lojas[0].id;
      window.setDTLojaAtiva(lojas[0].id);
    }
    return lojas;
  }
};