const fs=require('fs'),assert=require('assert'),path=require('path');
const R=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(R,p),'utf8');
const perm=read('js/analista/37-usuarios-permissoes.js');
const cfg=read('js/analista/123-configuracoes-sistema.js');
const html=read('analista.html');
const css=read('css/analista.css');
assert.match(perm,/function codigoPermissao\(modulo,acao\)/,'catálogo deve ter código numérico estável');
assert.match(perm,/DT_CATALOGO_PERMISSOES:catalogoPermissoes\(\)/,'catálogo deve ser exportado');
assert.match(perm,/data-system-permissions=\"1\"/,'master precisa de Permissões no topo');
assert.match(perm,/data-system-profile=\"1\"/,'perfil precisa ficar na barra global');
assert.match(cfg,/Usuários e acessos/);assert.match(cfg,/Catálogo de permissões/);assert.match(cfg,/page-pcp-parametros/);assert.match(cfg,/renderPCPParametros/);assert.match(cfg,/page-producao-config/);assert.match(cfg,/renderProducaoConfig/);assert.match(cfg,/page-recebimento-config/);assert.match(cfg,/renderRecebimentoConfig/);
assert.match(cfg,/abrirPermissoesTela/);assert.match(cfg,/Gerenciar usuários e acessos/);
// A regra especial #setor-logistica-recebimento-shell>.sidebar (altura fixa
// + overflow:hidden no shell) quebrou a rolagem de verdade — removida em
// 2026-09-28. O Recebimento agora usa o MESMO mecanismo comprovado dos
// outros setores secundários (PCP/Produção/Compras): a regra base .sidebar
// (position:sticky + max-height:100vh + overflow-y:auto), sem CSS extra.
assert.doesNotMatch(css,/#setor-logistica-recebimento-shell>\.sidebar/,'não deve reintroduzir a regra especial que quebrou a rolagem do Recebimento');
assert.match(css,/\.sidebar\s*\{[^}]*overflow-y:\s*auto/s,'regra base .sidebar precisa continuar rolando (mecanismo usado por todos os setores, incl. Recebimento)');
assert.match(css,/\.content\{[^}]*overflow:auto\s*!important/,'regra base .content precisa continuar rolando (mecanismo usado por todos os setores, incl. Recebimento)');
// Não trava a string exata — arquivo já recebeu bump legítimo em rodadas
// posteriores (config-hub-v3, botão de sair, config só no menu do perfil)
// e travar o valor exato (ou mesmo só o prefixo da data) quebra a cada
// bump real. Só confirma que não ficou preso na versão anterior a esta
// rodada.
assert.doesNotMatch(html,/123-configuracoes-sistema\.js\?v=20260928-receb-perfil-perm-v1"/,'123-configuracoes-sistema.js precisa ter recebido cache bust desde esta rodada');
assert.match(html,/123-configuracoes-sistema\.js\?v=\S+/,'novo módulo precisa de cache bust');
assert.doesNotMatch(html,/analista\.css\?v=20260928-receb-perfil-perm-v1"/,'analista.css precisa ter recebido cache bust desde esta rodada');
assert.match(html,/analista\.css\?v=\S+/,'CSS precisa de cache bust');
console.log('configuracoes-globais-v1: ok');
