'use strict';
// Investigação (2026-09-25): chama de verdade a Cloud Function
// buscarArquivoBiGraphApi (a mesma que o botão "Atualizar BI" chama),
// pra ver o que a API do SharePoint devolve AGORA pro produto_key 27745
// (00001 TAPIOCA DA TERRINHA 1 KG - FD 12), sem depender do arquivo local.
const path = require('node:path');
const https = require('node:https');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
const API_KEY = 'AIzaSyCpeTNeJUGgn5yEmIIM8aGos9VIN0VqcgA';

function postJson(hostname, urlPath, body, idToken) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (idToken) headers.Authorization = 'Bearer ' + idToken;
    const req = https.request({ hostname, path: urlPath, method: 'POST', headers }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } catch (e) { resolve({ status: res.statusCode, body: chunks }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  const usuariosSnap = await db.collection('usuarios_acessos').where('admin_mestre', '==', true).limit(1).get();
  if (usuariosSnap.empty) { console.error('Nenhum admin_mestre achado em usuarios_acessos.'); process.exit(1); }
  const uid = usuariosSnap.docs[0].id;
  console.log('Usando UID admin:', uid, usuariosSnap.docs[0].data().nome || usuariosSnap.docs[0].data().email || '');

  const customToken = await admin.auth().createCustomToken(uid);
  console.log('Custom token gerado.');

  const signIn = await postJson('identitytoolkit.googleapis.com', `/v1/accounts:signInWithCustomToken?key=${API_KEY}`, { token: customToken, returnSecureToken: true });
  if (!signIn.body.idToken) { console.error('Falha ao trocar custom token por idToken:', JSON.stringify(signIn.body)); process.exit(1); }
  const idToken = signIn.body.idToken;
  console.log('ID token obtido.');

  console.log('\nChamando buscarArquivoBiGraphApi(produtos_estoque.json)...');
  const resp = await postJson('southamerica-east1-daterrinha-inventario.cloudfunctions.net', '/buscarArquivoBiGraphApi', { data: { arquivo: 'produtos_estoque.json' } }, idToken);
  console.log('Status HTTP:', resp.status);
  if (resp.status !== 200) { console.error('Erro:', JSON.stringify(resp.body).slice(0, 2000)); process.exit(1); }

  const dados = resp.body.result ? resp.body.result.dados : (resp.body.data ? resp.body.data.dados : null);
  if (!dados) { console.error('Formato de resposta inesperado:', JSON.stringify(resp.body).slice(0, 1000)); process.exit(1); }
  const linhas = Array.isArray(dados) ? dados : (dados.produtos || dados.dados || dados.linhas || []);
  console.log('Total de linhas recebidas da API AGORA:', linhas.length);
  const alvo = linhas.filter(l => String(l.produto_key || '') === '27745');
  console.log('Linhas com produto_key 27745 (via SharePoint/Graph API, AGORA):', alvo.length);
  alvo.forEach(l => console.log(JSON.stringify(l)));
  const soma = alvo.reduce((s, l) => s + (Number(l.quantidade_estoque) || 0), 0);
  console.log('Soma quantidade_estoque:', soma);

  process.exit(0);
}
main().catch(e => { console.error('ERRO:', e); process.exit(1); });
