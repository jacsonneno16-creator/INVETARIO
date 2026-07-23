// Configuração e bootstrap compartilhados do Firebase
window.DT_FIREBASE_CFG = {
  apiKey:            "AIzaSyCpeTNeJUGgn5yEmIIM8aGos9VIN0VqcgA",
  authDomain:        "daterrinha-inventario.firebaseapp.com",
  projectId:         "daterrinha-inventario",
  storageBucket:     "daterrinha-inventario.firebasestorage.app",
  messagingSenderId: "310264955486",
  appId:             "1:310264955486:web:16f22d7b5db6f8f2b8a9b4"
};
window.DT_FCOL = {
  inventarios:   'dt_inventarios',
  contagens:     'dt_contagens',
  vazios:        'dt_vazios',
  recontagens:   'dt_recontagens',
  divergencias:  'dt_divergencias',
  coletores:     'dt_coletores',
  locais:        'dt_locais',
  auditorias:    'dt_auditorias',
  auditoriaMeta: 'dt_auditoria_meta',
  auditoriaImp:  'dt_auditoria_imports',
  operadores:    'dt_operadores',
  produtos:      'dt_produtos',
  analistas:     'dt_analistas',
};
window.getDTFirebaseApp = function(){
  if (!window.firebase) throw new Error('Firebase SDK não carregado.');
  try { return firebase.app(); } catch (e) { return firebase.initializeApp(window.DT_FIREBASE_CFG); }
};
window.getDTRawFirestore = function(){ return getDTFirebaseApp().firestore(); };

// Administradores mestres autorizados a inicializar e recuperar o ambiente multiloja.
// Após o primeiro acesso, a permissão também fica persistida em usuarios_acessos.
window.DT_ADMIN_MESTRE_EMAILS = window.DT_ADMIN_MESTRE_EMAILS || [
  'jacson@daterrinhaalimentos.com.br',
  'jacson.souza@daterrinhaalimentos.com.br'
];
window.isDTAdminMestre = function(user, acesso){
  const email = String((user && user.email) || (acesso && acesso.email) || '').trim().toLowerCase();
  return !!(acesso && (acesso.admin_mestre === true || acesso.administrador_mestre === true)) ||
    window.DT_ADMIN_MESTRE_EMAILS.indexOf(email) >= 0;
};

// ── MULTILOJA ───────────────────────────────────────────────────────────────
// Coleções operacionais são automaticamente direcionadas para
// lojas/{lojaAtiva}/{colecao}. A coleção raiz "lojas" permanece global.
window.DT_LOJA_KEY = 'dt_loja_ativa_v1';
window.getDTLojaAtiva = function(){ return localStorage.getItem(window.DT_LOJA_KEY) || ''; };
window.setDTLojaAtiva = function(id){
  const lojaId = String(id || '').trim();
  if (lojaId) localStorage.setItem(window.DT_LOJA_KEY, lojaId);
  else localStorage.removeItem(window.DT_LOJA_KEY);
  window.dispatchEvent(new CustomEvent('dt-loja-alterada', { detail:{ lojaId } }));
  return lojaId;
};
window.getDTFirestore = function(){
  const raw = window.getDTRawFirestore();
  return new Proxy(raw, {
    get(target, prop){
      if (prop === 'collection') {
        return function(nome){
          const path = String(nome || '');
          // Somente lojas é global. Todo dado do inventário fica isolado por loja.
          if (path === 'lojas' || path.startsWith('lojas/') || path === 'usuarios_acessos') return raw.collection(path);
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
window.getDTAuth = function(){ return getDTFirebaseApp().auth(); };

window.DTLoja = {
  async bootstrapAdministrador(user, acessoExistente){
    const raw = window.getDTRawFirestore();
    const acesso = acessoExistente || null;
    let primeiroSetup = false;

    // Instalação nova: se ainda não há lojas nem permissões, o primeiro usuário
    // autenticado assume o papel de administrador mestre para destravar o sistema.
    if (!acesso) {
      try {
        const resultados = await Promise.all([
          raw.collection('lojas').limit(1).get(),
          raw.collection('usuarios_acessos').limit(1).get()
        ]);
        primeiroSetup = resultados[0].empty && resultados[1].empty;
      } catch (_) {}
    }

    const adminMestre = window.isDTAdminMestre(user, acesso) || primeiroSetup;
    if (!adminMestre) return acesso;

    const agora = new Date().toISOString();
    const lojaRef = raw.collection('lojas').doc('loja_matriz');
    const lojaDoc = await lojaRef.get();
    if (!lojaDoc.exists) {
      await lojaRef.set({
        nome: 'Loja Matriz', codigo: 'MATRIZ', ativa: true,
        criada_em: agora, criada_por: user && user.email ? user.email : ''
      }, { merge: true });
    }

    const dadosAdmin = {
      uid: user.uid,
      email: String(user.email || '').toLowerCase(),
      nome: user.displayName || String(user.email || '').split('@')[0],
      perfil: 'administrador',
      ativo: true,
      admin_mestre: true,
      administrador_mestre: true,
      acesso_todas_lojas: true,
      lojas_permitidas: [],
      atualizado_em: agora,
      atualizado_por: 'BOOTSTRAP_AUTOMATICO'
    };
    if (!acesso) dadosAdmin.criado_em = agora;
    await raw.collection('usuarios_acessos').doc(user.uid).set(dadosAdmin, { merge: true });
    return Object.assign({}, acesso || {}, dadosAdmin);
  },
  async listar(apenasAtivas=true){
    const raw = window.getDTRawFirestore();
    const snap = await raw.collection('lojas').get();
    const acesso = window.DT_USUARIO_ACESSO_ATUAL || null;
    return snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(x=>!apenasAtivas || x.ativa !== false)
      .filter(x=>!acesso || acesso.acesso_todas_lojas === true || (Array.isArray(acesso.lojas_permitidas) && acesso.lojas_permitidas.includes(x.id)))
      .sort((a,b)=>String(a.nome||a.id).localeCompare(String(b.nome||b.id),'pt-BR'));
  },
  slug(nome){
    return String(nome||'loja').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || ('loja_'+Date.now());
  },
  async garantirLojaInicial(){
    const raw = window.getDTRawFirestore();
    const lojas = await this.listar(false);
    if (lojas.length) return lojas;
    const id='loja_matriz';
    await raw.collection('lojas').doc(id).set({nome:'Loja Matriz',codigo:'MATRIZ',ativa:true,criada_em:new Date().toISOString()},{merge:true});
    return [{id,nome:'Loja Matriz',codigo:'MATRIZ',ativa:true}];
  },
  async selecionarInterativamente(titulo='Selecione a loja', forcarEscolha=false){
    const lojas = await this.garantirLojaInicial();
    const atual = window.getDTLojaAtiva();
    if (!forcarEscolha && atual && lojas.some(l=>l.id===atual)) return atual;
    if (!forcarEscolha && lojas.length===1){ window.setDTLojaAtiva(lojas[0].id); return lojas[0].id; }
    return await new Promise(resolve=>{
      let bg=document.getElementById('dt-loja-modal');
      if(bg) bg.remove();
      bg=document.createElement('div'); bg.id='dt-loja-modal';
      bg.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(3,10,18,.86);display:flex;align-items:center;justify-content:center;padding:20px';
      bg.innerHTML=`<div style="width:min(460px,95vw);background:#fff;color:#17202a;border-radius:16px;padding:24px;box-shadow:0 25px 70px rgba(0,0,0,.4)">
        <div style="font-size:1.15rem;font-weight:800;margin-bottom:6px">🏪 ${titulo}</div>
        <div style="font-size:.82rem;color:#667085;margin-bottom:16px">Cada loja possui inventários, coletores e dados separados.</div>
        <select id="dt-loja-modal-select" style="width:100%;padding:12px;border:1px solid #d0d5dd;border-radius:9px;font-size:.95rem">${lojas.map(l=>`<option value="${l.id}">${l.nome||l.id}${l.codigo?' · '+l.codigo:''}</option>`).join('')}</select>
        <button id="dt-loja-modal-ok" style="width:100%;margin-top:14px;padding:12px;border:0;border-radius:9px;background:#1e6f4e;color:#fff;font-weight:800;cursor:pointer">ENTRAR NESTA LOJA</button>
      </div>`;
      document.body.appendChild(bg);
      const seletor=bg.querySelector('#dt-loja-modal-select');
      if(atual && lojas.some(l=>l.id===atual)) seletor.value=atual;
      bg.querySelector('#dt-loja-modal-ok').onclick=()=>{const id=bg.querySelector('#dt-loja-modal-select').value;window.setDTLojaAtiva(id);bg.remove();resolve(id);};
    });
  },
  async preencherSelect(selectId, incluirTodas=false){
    const el=document.getElementById(selectId); if(!el) return [];
    const lojas=await this.garantirLojaInicial();
    el.innerHTML=(incluirTodas?'<option value="">Todas as lojas</option>':'')+lojas.map(l=>`<option value="${l.id}">${l.nome||l.id}</option>`).join('');
    const atual=window.getDTLojaAtiva(); if(atual && lojas.some(l=>l.id===atual)) el.value=atual;
    else if(lojas[0]){el.value=lojas[0].id;window.setDTLojaAtiva(lojas[0].id);}
    return lojas;
  }
};
