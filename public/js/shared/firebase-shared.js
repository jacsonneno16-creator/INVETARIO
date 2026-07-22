// Configuração e bootstrap compartilhados do Firebase
window.DT_FIREBASE_CFG = {
  apiKey:            "AIzaSyCpeTNeJUGgn5yEmIIM8aGos9VIN0VqcgA",
  authDomain:        "daterrinha-inventario.firebaseapp.com",
  projectId:         "daterrinha-inventario",
  storageBucket:     "daterrinha-inventario.firebasestorage.app",
  messagingSenderId: "310264955486",
  appId:             "1:310264955486:web:b9954757ba022d91bd6acf"
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
  analistas:     'dt_analistas',
};
window.getDTFirebaseApp = function(){
  if (!window.firebase) throw new Error('Firebase SDK não carregado.');
  try { return firebase.app(); } catch (e) { return firebase.initializeApp(window.DT_FIREBASE_CFG); }
};
window.getDTFirestore = function(){ return getDTFirebaseApp().firestore(); };
window.getDTAuth = function(){ return getDTFirebaseApp().auth(); };

// Instâncias globais de compatibilidade usadas pelos módulos legados e refatorados.
window.DT_FIREBASE_APP = window.getDTFirebaseApp();
window.FS_AN = window.getDTFirestore();
window.AUTH_AN = window.getDTAuth();
window.FS = window.FS || window.FS_AN;
window.AUTH = window.AUTH || window.AUTH_AN;
window.FCOL = window.FCOL || window.DT_FCOL;
console.log('[Firebase] projeto conectado:', window.DT_FIREBASE_CFG.projectId);
