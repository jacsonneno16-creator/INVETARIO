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
  analistas:     'dt_analistas',
};
window.getDTFirebaseApp = function(){
  if (!window.firebase) throw new Error('Firebase SDK não carregado.');
  try { return firebase.app(); } catch (e) { return firebase.initializeApp(window.DT_FIREBASE_CFG); }
};
window.getDTFirestore = function(){ return getDTFirebaseApp().firestore(); };
window.getDTAuth = function(){ return getDTFirebaseApp().auth(); };
