'use strict';
// Gera uma planilha (CSV, abre direto no Excel) com todos os produtos do
// cadastro do PCP (producao_produtos + pcp_produtos_bluesoft, de TODAS as
// lojas) e a categoria que a tela de Planejamento/Insumos mostra HOJE —
// mesma lógica de _categoriaDoNome() em 78-pcp-central.js (primeira
// palavra do nome, maiúscula). Pedido ao vivo (2026-09-20): o usuário quer
// revisar e corrigir a categoria de cada produto numa planilha, em vez de
// ficar ajustando isso pelo sistema toda hora.
const path = require('node:path');
const fs = require('node:fs');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
const SAIDA = process.argv[2] || 'C:/Users/Daterrinha69/OneDrive - daterrinhaalimentos.com.br/Área de Trabalho/produtos-categorias.csv';

// Mesma função exata de 78-pcp-central.js — não reimplementa, só copia,
// pra garantir que a planilha mostra a categoria REAL que a tela usa hoje.
function categoriaDoNome(nome) {
  return String(nome || '').replace(/^\d+\s*/, '').trim().split(/\s+/)[0]?.toUpperCase() || '';
}
function keyOf(x) {
  return String(x?.cod ?? x?.prodCod ?? x?.prodKey ?? '').trim() || String(x?.produto ?? x?.nome ?? x?.descricao ?? '').trim().toUpperCase();
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  const lojasSnap = await db.collection('lojas').get();
  console.log('Lojas encontradas:', lojasSnap.size);

  const porCodigo = new Map();
  for (const lojaDoc of lojasSnap.docs) {
    for (const colecao of ['producao_produtos', 'pcp_produtos_bluesoft']) {
      const snap = await lojaDoc.ref.collection(colecao).get();
      snap.docs.forEach(doc => {
        const x = doc.data();
        const cod = String(x.cod || '').trim();
        if (!cod) return;
        const nome = x.nome || x.produto || x.descricao || '';
        if (!nome) return;
        const atual = porCodigo.get(cod);
        // Fica com o nome mais completo entre as lojas (mesmo critério já
        // usado em metaProduto()/_juntarEstoqueBi para escolher a melhor
        // descrição quando o mesmo código aparece em mais de uma loja).
        if (!atual || String(nome).length > String(atual.nome).length) {
          porCodigo.set(cod, { cod, nome, tipoProduto: x.bluesoftTipoProduto || x.tipoProduto || '' });
        }
      });
    }
  }

  const linhas = Array.from(porCodigo.values()).sort((a, b) => {
    const catA = categoriaDoNome(a.nome), catB = categoriaDoNome(b.nome);
    return catA.localeCompare(catB, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR');
  });

  const csvLinhas = ['Código;Nome do produto;Categoria atual (auto, primeira palavra do nome);Categoria correta (preencha aqui)'];
  linhas.forEach(x => {
    const nomeEsc = String(x.nome).replace(/;/g, ',');
    csvLinhas.push(`${x.cod};${nomeEsc};${categoriaDoNome(x.nome)};`);
  });

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, '\uFEFF' + csvLinhas.join('\r\n'), 'utf8');
  console.log('Produtos únicos (por código):', linhas.length);
  console.log('Categorias distintas hoje:', new Set(linhas.map(x => categoriaDoNome(x.nome))).size);
  console.log('Gravado em:', SAIDA);
  process.exit(0);
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
