#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const raiz = path.resolve(__dirname, '..');
const dados = path.join(raiz, 'dados-emulador');
const metadata = path.join(dados, 'firebase-export-metadata.json');
const args = ['emulators:start', '--only', 'hosting,auth,firestore,functions', '--export-on-exit=./dados-emulador'];

if (fs.existsSync(metadata)) args.push('--import=./dados-emulador');

console.log('[DT Teste] Iniciando Firebase Emulator Suite.');
console.log('[DT Teste] Produção não deve ser usada pelo frontend local; BigQuery real é bloqueado nas Functions locais.');
if (fs.existsSync(metadata)) console.log('[DT Teste] Restaurando dados locais de ./dados-emulador.');
else console.log('[DT Teste] Base local vazia; o primeiro encerramento salvará os dados em ./dados-emulador.');

// O PDF das NFs não fica no Firestore: ele é servido pelo DT Print Agent.
// No ambiente local subimos o agente junto com `npm run dev`, evitando que
// o botão "Anexar PDF" dependa de um serviço de produção ou configuração
// externa. Porta local padrão: 9101.
const nodeCmd = process.execPath;
const printAgent = spawn(nodeCmd, [path.join(raiz, 'print-agent', 'server.js')], {
  cwd: raiz,
  stdio: 'inherit',
  shell: false,
  env: Object.assign({}, process.env, {HOST: '127.0.0.1', PORT: process.env.DT_PRINT_AGENT_PORT || '9101'})
});
printAgent.on('error', (err) => {
  console.error('[DT Teste] Não foi possível iniciar o DT Print Agent:', err.message);
});

const cmd = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
const child = spawn(cmd, args, {cwd: raiz, stdio: 'inherit', shell: false});

function encerrarFilhos() {
  if (printAgent && !printAgent.killed) printAgent.kill();
  if (child && !child.killed) child.kill();
}
process.on('SIGINT', () => { encerrarFilhos(); });
process.on('SIGTERM', () => { encerrarFilhos(); });
process.on('exit', () => { if (printAgent && !printAgent.killed) printAgent.kill(); });

child.on('error', (err) => {
  console.error('[DT Teste] Firebase CLI não encontrado. Instale com: npm i -g firebase-tools');
  console.error(err.message);
  if (printAgent && !printAgent.killed) printAgent.kill();
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (printAgent && !printAgent.killed) printAgent.kill();
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code == null ? 1 : code;
});
