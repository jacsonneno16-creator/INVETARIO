// Usuários, canais de acesso e autorização detalhada por módulo.
(function(global){
  'use strict';
  const raw=()=>global.getDTRawFirestore();
  const ACCESS='usuarios_acessos';
  let usuarios=[],editando=null,editandoIndice=-1,lojasCache=[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emailId=email=>String(email||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'_');
  const DOMINIO='@daterrinhaalimentos.com.br';
  const partesNome=nome=>String(nome||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').split(/\s+/).filter(Boolean);
  function emailManual(valor){const email=String(valor||'').trim().toLowerCase();if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Informe um e-mail válido.');return email;}
  function loginsManuais(email,recuperacao){email=emailManual(email);return {analista:email,coletorEmail:email,recuperacao:emailManual(recuperacao)};}
  function preencherEmailsRecuperacao(){const d=document.getElementById('op-emails-recuperacao');if(d)d.innerHTML=[...new Set(usuarios.map(u=>u.email_recuperacao).filter(Boolean))].map(e=>'<option value="'+esc(e)+'"></option>').join('');}
  async function opVerificarRemetente(){if(!ehMasterAtual())return global.showToast?.('Somente administrador verifica o remetente.','error');try{const r=await gestaoCall('verificarRemetenteRecuperacao',{});global.showToast?.(r.mensagem,'success');}catch(e){global.showToast?.(e.message,'error');}}


  // `setor`/`canais` (correção estrutural — reforma da tela de Usuários e
  // Permissões): `setor` é mecânico, a partir do agrupamento por prefixo
  // que já existia informalmente (sem-prefixo + recebimento-* → logística,
  // producao-* → produção, pcp-*/compras-* → seus próprios setores).
  // `canais` vem da auditoria real dos fluxos. Além de Recebimento, Inventário,
  // Auditoria e Recontagem agora possuem permissões operacionais próprias no
  // Coletor e proteção equivalente nas regras. O catálogo continua separando
  // o canal da permissão: ter acesso ao Coletor não concede nenhuma ação por
  // si só; cada módulo/ação precisa estar explicitamente liberado.
  const MODULOS=[
    // PEDIDO AO VIVO (2026-10-02): "bem simples o nome" — estes 17 módulos
    // (o setor "Inventário / Logística" original, de antes do padrão
    // "Setor · Tela" existir) tinham nome curto demais ("Dashboard",
    // "Inventários", "Auditoria"...) comparado com todo o resto do
    // catálogo (ex.: "Recebimento · Notas Retornadas"), tanto no Catálogo
    // de permissões quanto no popup "Permissões desta tela". Ganharam o
    // mesmo prefixo "Inventário · " — mesmo grupo que `grupoDe()` (ver
    // catalogo() em 123-configuracoes-sistema.js) já usa como fallback
    // pra todos eles.
    {id:'dashboard',nome:'Inventário · Dashboard',setor:'logistica',canais:['analista'],acoes:['visualizar','atualizar']},
    {id:'inventarios',nome:'Inventário · Inventários',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','excluir','importar','exportar','publicar','finalizar','contar']},
    {id:'acompanhamento',nome:'Inventário · Acompanhamento',setor:'logistica',canais:['analista'],acoes:['visualizar','atualizar','exportar']},
    {id:'auditoria',nome:'Inventário · Auditoria',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','excluir','importar','exportar','publicar','finalizar','conferir']},
    {id:'contagens',nome:'Inventário · Contagens',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','excluir','exportar']},
    {id:'pendencias',nome:'Inventário · Pendências',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','exportar']},
    {id:'recontagens',nome:'Inventário · Recontagem',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','excluir','exportar','executar']},
    {id:'rel-divergencias',nome:'Inventário · Relatório de Conflitos',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'capas-duplicadas',nome:'Inventário · Capas Duplicadas',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','excluir','exportar']},
    {id:'produtividade',nome:'Inventário · Produtividade',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'enderecos',nome:'Inventário · Endereços',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'produtos',nome:'Inventário · Produtos',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar','atualizar']},
    {id:'coletores',nome:'Inventário · Coletores',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','aprovar','bloquear']},
    {id:'operadores',nome:'Inventário · Usuários e Permissões',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'lojas',nome:'Inventário · Lojas',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar']},
    {id:'rastreabilidade',nome:'Inventário · Rastreabilidade',setor:'logistica',canais:['analista'],acoes:['visualizar','excluir','exportar']},
    {id:'importar-exportar',nome:'Inventário · Importar / Exportar / API',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','exportar','configurar','executar','excluir']},
    // PEDIDO AO VIVO (2026-10-02): "veja se tem mais alguma coisa sem
    // permissão" — auditoria achou page-impressoras (122-impressoras-
    // rede.js) sem NENHUMA checagem de permissão em abrirModalConfiguracoes
    // (ao contrário de "integracao", que já checava importar-exportar
    // antes de mostrar a página) — qualquer um que abrisse Configurações
    // conseguia configurar impressoras de rede, sem controle por usuário.
    {id:'impressoras',nome:'Configurações · Impressoras de rede',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-dashboard',nome:'Produção · Dashboard',setor:'producao',canais:['analista'],acoes:['visualizar']},
    {id:'producao-ficha-tecnica',nome:'Produção · Ficha Técnica',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-maquinas',nome:'Produção · Máquinas',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-programacao',nome:'Produção · Programação',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar']},
    {id:'producao-gantt',nome:'Produção · Gantt',setor:'producao',canais:['analista'],acoes:['visualizar','editar','reordenar','exportar']},
    {id:'producao-realizado',nome:'Produção · Realizado',setor:'producao',canais:['analista'],acoes:['visualizar','editar','finalizar','liberar','resetar','importar','exportar']},
    {id:'producao-insumos',nome:'Produção · Insumos',setor:'producao',canais:['analista'],acoes:['visualizar','editar','importar','exportar']},
    {id:'producao-projecao',nome:'Produção · Projeção',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'producao-prog-automatica',nome:'Produção · Prog. Automática',setor:'producao',canais:['analista'],acoes:['visualizar','executar']},
    {id:'producao-funcionarios',nome:'Produção · Funcionários',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-relatorios',nome:'Produção · Relatórios',setor:'producao',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'producao-setup',nome:'Produção · Tempos de Setup',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'producao-mapa-fabrica',nome:'Produção · Mapa da Fábrica',setor:'producao',canais:['analista'],acoes:['visualizar']},
    {id:'producao-config',nome:'Produção · Configurações',setor:'producao',canais:['analista'],acoes:['visualizar','editar']},
    {id:'producao-importacao',nome:'Produção · Importação / API',setor:'producao',canais:['analista'],acoes:['visualizar','importar','exportar','configurar']},
    {id:'producao-estoque',nome:'Produção · Estoque (BI/SharePoint)',setor:'producao',canais:['analista'],acoes:['visualizar']},
    {id:'producao-relatorios-bi',nome:'Produção · Relatórios BI (Compras/PCP/Produção)',setor:'producao',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'pcp-central',nome:'PCP · Central de Planejamento',setor:'pcp',canais:['analista'],acoes:['visualizar','criar','editar','excluir','configurar']},
    {id:'compras-central',nome:'Compras · Central de Compras',setor:'compras',canais:['analista'],acoes:['visualizar','editar','configurar']},
    // Recebimento operacional — módulos do setor, incluindo Recusas dentro de Recebimento.
    // "Tempos/Performance" reaproveita a permissão do
    // Dashboard e "Histórico" a de Recebimentos, por serem visões de
    // leitura dos mesmos dados, não módulos com escrita própria.
    {id:'recebimento-dashboard',nome:'Recebimento · Dashboard',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-operacao',nome:'Recebimento · Recebimentos',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','cancelar','finalizar','corrigir-horario','gerar-qrcode','exportar','excluir']},
    {id:'recebimento-notas',nome:'Recebimento · Notas Fiscais',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'recebimento-fornecedores',nome:'Recebimento · Fornecedores',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','exportar']},
    {id:'recebimento-agendamentos',nome:'Recebimento · Agenda / Cargas',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'recebimento-transbordo',nome:'Recebimento · Transbordo',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','cancelar','finalizar','corrigir-horario','gerar-qrcode','excluir']},
    {id:'recebimento-paletes',nome:'Recebimento · Controle de Pallets',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','estoque','saida','transferir','criar','editar','excluir']},
    {id:'recebimento-patio-tempo-real',nome:'Recebimento · Pátio em Tempo Real',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    // PEDIDO AO VIVO (2026-10-02): relatório só de leitura das sessões de
    // "Inventário do Pátio" já finalizadas no Coletor (29-recebimento-
    // patio-inventario.js) — ver 124-recebimento-patio-inventarios-
    // relatorio.js.
    {id:'recebimento-patio-inventarios',nome:'Recebimento · Inventários do Pátio (Relatório)',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-recusas',nome:'Recebimento · Notas Retornadas',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','entrada','saida','rastrear','identificar','criar','editar','excluir','importar','exportar']},
    {id:'recebimento-retornos-indicadores',nome:'Recebimento · Indicadores de Retornos',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    // Só "visualizar" — quem PODE avançar uma etapa é governado pela MESMA
    // permissão 'editar' de recebimento-recusas (mesmo dado, mesma tela de
    // origem), não uma ação granular nova — decisão do plano desta feature,
    // pra não repetir o estouro de orçamento de sub-expressões do rules já
    // sofrido duas vezes neste projeto com múltiplas permissões pro mesmo
    // registro. Checado manualmente em 99-recebimento-retornos-status.js.
    {id:'recebimento-retornos-status',nome:'Recebimento · Status de Retornos',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-recusas-indicadores',nome:'Recebimento · Recusas',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    // Módulos antigos (telas separadas de Devoluções) — ficam inertes no
    // catálogo, sem mais nenhuma tela que os referencie; a migração de
    // permissões (script único, não runtime) copia visualizar/importar/
    // exportar daqui pro módulo novo abaixo. Não apagar: contas que já
    // tinham permissão aqui continuam existindo até a migração rodar.
    {id:'recebimento-consulta-notas',nome:'Recebimento · Devoluções (BI) [antigo]',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','exportar']},
    {id:'recebimento-devolucoes-indicadores',nome:'Recebimento · Indicadores de Devoluções [antigo]',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    // Devoluções unificadas (2026-10-13): substitui as 2 telas acima por uma
    // única (Controle/Relatórios/Indicadores) — ver 106-devolucoes.js e
    // firestore.rules (hasPermissionDevolucoes). confirmar/relatorio_*/
    // estornar nascem SEMPRE false pra todo mundo (ninguém tinha essa
    // capacidade antes — nunca inferir de importar).
    {id:'recebimento-devolucoes',nome:'Recebimento · Devoluções',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','confirmar','relatorio_criar','relatorio_finalizar','exportar','estornar','excluir']},
    // Pedido ao vivo do usuário: "as partes de cadastro da parte de
    // recebimento fazer em um menu só... deixar bem separado e organizado"
    // — Motorista/Motivo/Conferente (que viviam misturados dentro da
    // própria tela de Notas Retornadas) viraram uma tela própria. Só
    // "visualizar" aqui, mesmo padrão de indicadores/status acima — quem
    // PODE criar/editar/excluir um cadastro continua sendo a MESMA
    // permissão administrativa de recebimento-recusas (Firestore rules
    // já protege as coleções recebimento_recusas_motoristas/_motivos/
    // _conferentes por ali, sem regra nova).
    {id:'recebimento-recusas-cadastros',nome:'Recebimento · Notas Retornadas · Cadastros',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-config',nome:'Recebimento · Configurações',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'estoque-separacao',nome:'Estoque · Separação',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','iniciar','finalizar','corrigir-horario','registrar-erro','tratar-erro','cancelar','reabrir','exportar','configurar']},
    {id:'estoque-rel-apontamento',nome:'Estoque · Apontamento de Produção',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','conferir','cancelar','reprocessar','configurar']},
    {id:'estoque-enderecamento',nome:'Estoque · Endereçamento de Paletes',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','executar','exportar']},
    {id:'estoque-lote-trocas',nome:'Estoque · Lote de Trocas',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','executar','exportar','configurar']},
    {id:'estoque-transformacao-api',nome:'Estoque · Transformação de Produtos',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','executar','exportar','configurar']},
    // PEDIDO AO VIVO (2026-10-02): mesma auditoria acima — page-recebimento-
    // tempos e page-recebimento-historico são abertas via goPage() (checa
    // temPermissao(id,'visualizar') igual qualquer outra página), mas
    // nenhum dos dois ids tinha entrada aqui nem caso especial dentro de
    // temPermissao() (ao contrário de 'recebimento-cargas', que já herda de
    // transbordo/operacao de propósito) — ou seja, SEMPRE negava acesso
    // pra todo mundo que não é admin_mestre, sem nenhum jeito de liberar
    // pela tela de permissões. O oposto do bug de impressoras: aqui
    // ninguém tinha acesso nenhum, nem podendo ser liberado.
    {id:'recebimento-tempos',nome:'Recebimento · Tempos / Performance',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-historico',nome:'Recebimento · Histórico',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    // PEDIDO AO VIVO (2026-10-02): Logística › Estoque › Relatórios —
    // movimentos/inventários/notas de estoque coletados da Bluesoft (só
    // GET) e carregados no BigQuery. 4 telas, 1 módulo cada.
    {id:'estoque-rel-inventario',nome:'Estoque · Relatório de Inventário',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'estoque-rel-descarte',nome:'Estoque · Relatório de Descarte',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'estoque-rel-requisicao',nome:'Estoque · Relatório de Baixa de Requisição',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'estoque-rel-transformacao',nome:'Estoque · Relatório de Transformação',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'estoque-rel-analise',nome:'Estoque · Análise de Inventários',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'estoque-rel-analise-inventario',nome:'Estoque · Análise Completa do Inventário',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'atendimento-dashboard',nome:'Atendimento · Dashboard',setor:'atendimento',canais:['analista'],acoes:['visualizar','supervisionar']},
    {id:'atendimento-conversas',nome:'Atendimento · Conversas WhatsApp',setor:'atendimento',canais:['analista'],acoes:['visualizar','responder','assumir','transferir','finalizar','notas','supervisionar']},
    {id:'atendimento-config',nome:'Atendimento · Configuração WhatsApp',setor:'atendimento',canais:['analista'],acoes:['visualizar','configurar']}
  ];
  const ROTULOS={iniciar:'Registrar início',reabrir:'Reabrir carga','registrar-erro':'Registrar erro no Coletor','tratar-erro':'Tratar ocorrências',visualizar:'Visualizar',criar:'Criar',editar:'Editar',excluir:'Excluir',importar:'Importar',exportar:'Exportar',publicar:'Liberar/Publicar',finalizar:'Finalizar',cancelar:'Cancelar',atualizar:'Atualizar',aprovar:'Aprovar',bloquear:'Bloquear',configurar:'Configurar',executar:'Executar/Enviar',reordenar:'Reordenar','corrigir-horario':'Corrigir horário','gerar-qrcode':'Gerar QR Code',entrada:'Entrada',saida:'Saída',rastrear:'Rastrear',identificar:'Identificar',estoque:'Pallets em estoque',transferir:'Transferir pallets',contar:'Contar no Coletor',conferir:'Conferir no Coletor',liberar:'Liberar sequência/quantidade',resetar:'Resetar liberação',responder:'Responder',assumir:'Assumir atendimento',notas:'Notas internas',supervisionar:'Supervisionar',reprocessar:'Reprocessar integração',confirmar:'Confirmar recebimento',relatorio_criar:'Criar relatório (bipagem)',relatorio_finalizar:'Finalizar relatório',estornar:'Estornar confirmação'};

  // Catálogo numérico de permissões — inspirado em ERPs onde o suporte/TI
  // identifica cada ação por "número + nome". O código é derivado da chave
  // módulo/ação (não da posição no array), então continua estável mesmo que a
  // ordem visual dos módulos mude.
  function _hashPermissao(txt){
    var h=2166136261;txt=String(txt||'');
    for(var i=0;i<txt.length;i++){h^=txt.charCodeAt(i);h=Math.imul(h,16777619);}
    return h>>>0;
  }
  function codigoPermissao(modulo,acao){
    return 20000+(_hashPermissao(String(modulo)+'|'+String(acao))%70000);
  }
  function catalogoPermissoes(){
    return MODULOS.reduce(function(out,m){
      m.acoes.forEach(function(a){out.push({codigo:codigoPermissao(m.id,a),modulo:m.id,moduloNome:m.nome,acao:a,nome:(ROTULOS[a]||a),setor:m.setor});});
      return out;
    },[]).sort(function(a,b){return a.codigo-b.codigo;});
  }
  function ehMasterAtual(){
    var a=global.DT_USUARIO_ACESSO_ATUAL||{};
    return a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador';
  }
  const MODULO_ICONES={dashboard:'📊',inventarios:'📦',acompanhamento:'📈',auditoria:'🕵️',contagens:'🔢',pendencias:'⏳',recontagens:'🔁','rel-divergencias':'⚠️','capas-duplicadas':'🧾',produtividade:'🏆',enderecos:'📍',produtos:'🏷️',coletores:'📱',operadores:'👤',lojas:'🏪',rastreabilidade:'🔍','importar-exportar':'🔄','producao-dashboard':'📊','producao-ficha-tecnica':'🏭','producao-maquinas':'⚙️','producao-programacao':'📋','producao-gantt':'📅','producao-realizado':'✅','producao-insumos':'🧪','producao-projecao':'📈','producao-prog-automatica':'🤖','producao-funcionarios':'👷','producao-relatorios':'📊','producao-setup':'🔧','producao-mapa-fabrica':'🗺️','producao-config':'⚙️','producao-importacao':'🔄','producao-estoque':'📦','recebimento-dashboard':'📊','recebimento-operacao':'🚚','recebimento-notas':'📄','recebimento-fornecedores':'🏢','recebimento-agendamentos':'📅','recebimento-transbordo':'🚛','recebimento-patio-tempo-real':'📦','recebimento-recusas':'↩️','recebimento-retornos-indicadores':'📊','recebimento-recusas-indicadores':'📊','recebimento-consulta-notas':'📥','recebimento-devolucoes-indicadores':'📊','recebimento-devolucoes':'📥','recebimento-config':'⚙️','atendimento-dashboard':'📊','atendimento-conversas':'💬','atendimento-config':'⚙️'};
  const todos=()=>Object.fromEntries(MODULOS.map(m=>[m.id,Object.fromEntries(m.acoes.map(a=>[a,true]))]));
  const normalizar=(p,legadoTotal)=>{
    if(!p||typeof p!=='object')return legadoTotal?todos():{};
    const out={}; MODULOS.forEach(m=>{out[m.id]={};m.acoes.forEach(a=>out[m.id][a]=p[m.id]?.[a]===true);});return out;
  };
  const _todasAcoesDe=id=>Object.fromEntries((MODULOS.find(m=>m.id===id)?.acoes||[]).map(a=>[a,true]));
  // Presets (correção estrutural — atalhos de permissão por função, seção 8
  // do pedido): aplicar um preset é só um PONTO DE PARTIDA — marca as
  // permissões definidas e para por aí; o admin continua livre pra ajustar
  // manualmente depois (nunca trava a edição, nunca sobrescreve sozinho).
  // "Operador de Coletor · Recebimento" fica só com editar/criar/corrigir-
  // horario/gerar-qrcode (o que o bip do Coletor de fato usa — o 5º bip de
  // finalização passa pelo ramo "editar" das Firestore Rules, nunca pelo
  // "finalizar" dedicado) — sem cancelar/finalizar, que são ações
  // administrativas (o pedido é explícito: "não liberar telas
  // administrativas").
  const PRESETS=[
    {id:'conferente-separacao',nome:'Conferente · Separação',icone:'📱',descricao:'Localiza cargas e registra erros no coletor.',permissoes:{'estoque-separacao':{visualizar:true,'registrar-erro':true}}},
    {id:'analista-separacao',nome:'Analista · Separação',icone:'📦',descricao:'Cadastro de cargas, horários e tratamento de ocorrências.',permissoes:{'estoque-separacao':_todasAcoesDe('estoque-separacao')}},
    {id:'coletor-recebimento',nome:'Operador de Coletor · Recebimento',icone:'📱',descricao:'Bipar transbordo pelo Coletor — sem telas administrativas.',
      permissoes:{
        'recebimento-operacao':{visualizar:true,criar:true,editar:true,'corrigir-horario':true,'gerar-qrcode':true},
        'recebimento-transbordo':{visualizar:true,criar:true,editar:true,'corrigir-horario':true,'gerar-qrcode':true},
        'recebimento-paletes':{visualizar:true,criar:true,editar:true},
      }},
    {id:'analista-recebimento',nome:'Analista de Recebimento',icone:'🚚',descricao:'Dashboard, recebimentos, notas, fornecedores, agenda, transbordo e configurações do setor.',
      permissoes:Object.fromEntries(MODULOS.filter(m=>m.id.startsWith('recebimento-')).map(m=>[m.id,_todasAcoesDe(m.id)]))},
    {id:'pcp',nome:'PCP',icone:'📋',descricao:'Acesso completo ao setor PCP.',
      permissoes:{'pcp-central':_todasAcoesDe('pcp-central')}},
    {id:'compras',nome:'Compras',icone:'🛒',descricao:'Acesso completo ao setor Compras.',
      permissoes:{'compras-central':_todasAcoesDe('compras-central')}},
    {id:'administrador',nome:'Administrador',icone:'👑',descricao:'Acesso completo a todos os módulos.',
      permissoes:todos()},
  ];
  // Limpa tudo antes de aplicar — um preset precisa ser previsível (o
  // mesmo resultado sempre, a partir de qualquer estado anterior), não uma
  // soma incremental que dependeria do que já estava marcado antes.
  function opAplicarPreset(prefix,presetId){
    const preset=PRESETS.find(x=>x.id===presetId);if(!preset)return;
    const permissoes={};MODULOS.forEach(m=>{permissoes[m.id]={};m.acoes.forEach(ac=>permissoes[m.id][ac]=!!(preset.permissoes[m.id]&&preset.permissoes[m.id][ac]===true&&concedivelAtual(m.id,ac)));});
    const canais={analista:false,coletor:false},setores={logistica:false,compras:false,pcp:false,producao:false,atendimento:false};
    MODULOS.forEach(m=>{if(Object.values(permissoes[m.id]).some(Boolean)){setores[m.setor]=true;m.canais.forEach(c=>canais[c]=true);}});
    if(presetId==='coletor-recebimento'||presetId==='conferente-separacao')canais.analista=false;
    if(presetId==='analista-separacao')canais.coletor=false;
    renderCanais(prefix,canais);renderSetores(prefix,setores);renderPermissoes(prefix,permissoes);if(prefix==='editar'){const ges=document.createElement('div');ges.id='op-gestao-usuario';ges.innerHTML=htmlGestaoUsuario(editando||{});document.getElementById('op-permissoes-editar').appendChild(ges);}
    global.showToast?.('Modelo rápido aplicado. Confira antes de salvar.','success');
  }

  // Modelos cadastráveis são padrões aplicados ao formulário; alterações não
  // sobrescrevem silenciosamente usuários já configurados.
  let modelosAcesso=[];
  const gestaoCall=(n,d)=>firebase.app().functions('southamerica-east1').httpsCallable(n)(d||{}).then(r=>r.data);
  function delegadoAtual(){const a=global.DT_USUARIO_ACESSO_ATUAL||{};return !ehMasterAtual()&&a.gestao_areas&&Object.keys(a.gestao_areas).length>0;}
  function areaModelo(m){return ['operadores','lojas','importar-exportar','impressoras'].includes(m.id)?'sistema':m.id.indexOf('recebimento-')===0?'recebimento':m.id.indexOf('estoque-')===0?'estoque':m.setor==='logistica'?'inventario':m.setor;}
  function concedivelAtual(mod,acao){
    if(ehMasterAtual())return true;
    const a=global.DT_USUARIO_ACESSO_ATUAL||{},d=a.gestao_areas||{},m=MODULOS.find(x=>x.id===mod);
    return !!(m&&(d.areas||[]).includes(areaModelo(m))&&a.permissoes&&a.permissoes[mod]&&a.permissoes[mod][acao]===true&&d.permissoes&&d.permissoes[mod]&&d.permissoes[mod][acao]===true);
  }
  function htmlModelo(prefix){return `<div class="perm-presets"><label>Setor / modelo de acesso <select class="field" id="op-modelo-${prefix}" onchange="opSelecionarModelo('${prefix}',this.value)"><option value="">Personalizado / sem modelo</option>${modelosAcesso.filter(m=>m.ativo!==false).map(m=>`<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('')}</select></label>${ehMasterAtual()?'<button type="button" class="btn btn-ghost btn-sm" onclick="opAbrirModelos()">Cadastrar / editar setores</button>':''}<small>Aplica as permissões padrão. Ajuste antes de salvar. Alterações no modelo não mudam automaticamente usuários existentes.</small></div>`;}
  function opSelecionarModelo(prefix,id){
    const m=modelosAcesso.find(x=>x.id===id);if(!m)return;
    renderCanais(prefix,m.canais||{});
    const setores={logistica:false,compras:false,pcp:false,producao:false,atendimento:false};
    MODULOS.forEach(mod=>{if(Object.values(m.permissoes[mod.id]||{}).some(v=>v===true))setores[mod.setor]=true;});
    renderSetores(prefix,setores);renderPermissoes(prefix,m.permissoes);document.getElementById('op-modelo-'+prefix).value=id;
    if(prefix==='editar'){document.getElementById('opedit-setor').value=m.nome;const ges=document.createElement('div');ges.id='op-gestao-usuario';ges.innerHTML=htmlGestaoUsuario(editando||{});document.getElementById('op-permissoes-editar').appendChild(ges);}
  }
  function htmlGestaoUsuario(u){
    if(!ehMasterAtual()){const a=global.DT_USUARIO_ACESSO_ATUAL||{},d=a.gestao_areas||{},total=Object.keys(u.permissoes||{}).every(id=>!Object.values(u.permissoes[id]||{}).some(v=>v===true)||(d.areas||[]).includes(areaModelo(MODULOS.find(m=>m.id===id)||{id:'desconhecido',setor:'sistema'})));return total&&d.operacoes&&d.operacoes.bloquear?`<label><input type="checkbox" id="op-usuario-ativo" ${u.ativo!==false?'checked':''}> Usuário ativo</label>`:'';}
    const d=u.gestao_areas||{},op=d.operacoes||{};
    return `<label><input type="checkbox" id="op-usuario-ativo" ${u.ativo!==false?'checked':''}> Usuário ativo</label><details><summary>Responsável por área — pode administrar a equipe</summary><div class="alert">Apenas os acessos operacionais selecionados e as lojas desta pessoa poderão ser concedidos. Administração global não é incluída.</div><div id="op-gestao-areas">${['inventario','recebimento','estoque','compras','pcp','producao','atendimento'].map(a=>`<label style="margin:8px"><input type="checkbox" value="${a}" ${ (d.areas||[]).includes(a)?'checked':''}> ${a}</label>`).join('')}</div><div id="op-gestao-operacoes">${[['visualizar','Listar usuários'],['criar','Criar usuários'],['editar','Editar usuários'],['atribuir','Distribuir permissões'],['bloquear','Bloquear / desbloquear'],['senha','Redefinir senha'],['excluir','Excluir usuários']].map(([id,n])=>`<label style="margin:8px"><input type="checkbox" value="${id}" ${op[id]?'checked':''}> ${n}</label>`).join('')}</div><small>Somente o administrador define responsáveis. Usuários com outras áreas têm proteção para ações sobre a conta inteira.</small></details>`;
  }
  function lerGestaoUsuario(data){
    if(!ehMasterAtual())return {};
    const areas=[...document.querySelectorAll('#op-gestao-areas input:checked')].map(x=>x.value);if(!areas.length)return {};
    if(data.acesso_todas_lojas)throw new Error('Para nomear um responsável, selecione explicitamente as lojas que ele pode administrar.');
    const operacoes={};document.querySelectorAll('#op-gestao-operacoes input').forEach(x=>operacoes[x.value]=x.checked);
    const p={};MODULOS.forEach(m=>{if(areas.includes(areaModelo(m)))p[m.id]=data.permissoes[m.id]||{};});
    return {areas,lojas:data.lojas_permitidas,canais:data.canais_acesso,operacoes,permissoes:p};
  }
  async function opSalvarArea(prefix,nome,senha,logins,u,comum){
    if(senha&&senha.length<6)throw new Error('A senha deve ter no mínimo 6 caracteres.');
    const c=comum?comum.canais:lerCanais(prefix),modo=comum?comum.modo:(document.querySelector(`input[name="op-lojas-${prefix}-modo"]:checked`)||{}).value||'selecionadas';
    const sel=comum?comum.lojas:[...document.querySelectorAll(`#op-lojas-${prefix}-lista input:checked`)].map(x=>x.value);
    const id=comum?comum.modeloId||'':(document.getElementById('op-modelo-'+prefix)||{}).value||'';
    const data={...(u||{}),nome,perfil:c.analista?'analista':'operador',setor:prefix==='editar'?document.getElementById('opedit-setor').value:'',ativo:u?u.ativo!==false:true,canais_acesso:c,setores_permitidos:comum?comum.setores:lerSetores(prefix),permissoes:comum?comum.permissoes:lerPermissoes(prefix),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,modelo_acesso_id:id,gestao_areas:{}};
    if(prefix==='editar'){
      data.papelCompras=(document.getElementById('opedit-papel-compras')||{}).value||'';
      data.compradoresGerenciados=String((document.getElementById('opedit-compradores-gerenciados')||{}).value||'').split(',').map(x=>x.trim()).filter(Boolean);
      data.gestao_areas=lerGestaoUsuario(data);if(document.getElementById('op-usuario-ativo'))data.ativo=document.getElementById('op-usuario-ativo').checked;
    }
    if(logins)data.email_recuperacao=logins.recuperacao;
    if(prefix==='editar'){const campo=document.getElementById('opedit-email-recuperacao');if(campo&&!campo.disabled&&campo.value.trim())data.email_recuperacao=emailManual(campo.value);}
    const resposta=await gestaoCall('salvarUsuarioArea',{uid:u&&(u.uid||u.id)||null,acesso:data,senha:senha||'',emailAnalista:logins&&logins.analista,emailColetor:logins&&logins.coletorEmail});
    if(senha&&u)await gestaoCall('alterarSenhaUsuario',{uids:[...new Set([u.uid||u.id,u.analista_uid,u.coletor_uid,...(u.uids_vinculados||[])].filter(Boolean))],senha});
    return resposta;
  }
  function opAbrirModelos(){
    if(!ehMasterAtual())return;
    let box=document.getElementById('op-modelos-modal');if(!box){box=document.createElement('div');box.id='op-modelos-modal';box.style.cssText='position:fixed;inset:0;z-index:12000;background:#0009;display:flex;align-items:center;justify-content:center';document.body.appendChild(box);}
    box.style.display='flex';box.innerHTML=`<div style="background:var(--card,#18202d);color:var(--text);padding:24px;border-radius:16px;width:min(960px,95vw);max-height:90vh;overflow:auto"><h3>Setores e modelos de acesso</h3><select class="field" id="op-modelo-edicao" onchange="opEditarModelo(this.value)"><option value="">Novo setor / modelo</option>${modelosAcesso.map(m=>`<option value="${esc(m.id)}">${esc(m.nome)}${m.ativo===false?' (inativo)':''}</option>`).join('')}</select><label>Nome <input class="field" id="op-modelo-nome" maxlength="120"></label><label>Descrição <input class="field" id="op-modelo-descricao" maxlength="500"></label><label><input type="checkbox" id="op-modelo-ativo" checked> Ativo</label><div id="op-canais-modelo"></div><div id="op-setores-modelo"></div><div id="op-permissoes-modelo"></div><button class="btn btn-primary" onclick="opSalvarModelo()">Salvar modelo</button><button class="btn btn-ghost" onclick="opDuplicarModelo()">Duplicar</button><button class="btn btn-ghost" onclick="document.getElementById('op-modelos-modal').style.display='none'">Fechar</button></div>`;
    opEditarModelo('');
  }
  function opEditarModelo(id){
    const m=modelosAcesso.find(x=>x.id===id)||{permissoes:{},canais:{analista:true,coletor:false},ativo:true};
    document.getElementById('op-modelo-nome').value=m.nome||'';document.getElementById('op-modelo-descricao').value=m.descricao||'';document.getElementById('op-modelo-ativo').checked=m.ativo!==false;
    renderCanais('modelo',m.canais);renderSetores('modelo',{logistica:true,compras:true,pcp:true,producao:true,atendimento:true});renderPermissoes('modelo',m.permissoes);
    document.querySelectorAll('#op-permissoes-modelo .perm-presets').forEach(x=>x.style.display='none');
    document.querySelectorAll('#op-permissoes-modelo [data-modulo]').forEach(x=>{const m=MODULOS.find(m=>m.id===x.dataset.modulo);if(areaModelo(m)==='sistema'){x.disabled=true;x.checked=false;}});
  }
  function opDuplicarModelo(){document.getElementById('op-modelo-edicao').value='';document.getElementById('op-modelo-nome').value+=' (cópia)';}
  async function opSalvarModelo(){try{await gestaoCall('salvarModeloAcesso',{id:document.getElementById('op-modelo-edicao').value||null,nome:document.getElementById('op-modelo-nome').value,descricao:document.getElementById('op-modelo-descricao').value,ativo:document.getElementById('op-modelo-ativo').checked,permissoes:lerPermissoes('modelo'),canais:lerCanais('modelo')});const r=await gestaoCall('listarGestaoAcessos',{});modelosAcesso=r.modelos;opAbrirModelos();global.showToast?.('Modelo salvo. Aplique-o nos usuários desejados.','success');}catch(e){global.showToast?.(e.message,'error');}}
  Object.assign(global,{opSelecionarModelo,opAbrirModelos,opEditarModelo,opDuplicarModelo,opSalvarModelo});
  async function carregarLojas(){lojasCache=await global.DTLoja.garantirLojaInicial();return lojasCache;}
  function lojasLabels(ids){const a=Array.isArray(ids)?ids:[];if(!a.length)return'<span class="badge badge-red">Sem loja</span>';return a.map(id=>`<span class="badge badge-blue" style="margin:2px">${esc(lojasCache.find(x=>x.id===id)?.nome||id)}</span>`).join('');}
  function canais(u){const c=u.canais_acesso||{};return `${c.coletor!==false?'📱 Coletor ':''}${c.analista===true||u.perfil==='analista'?'🖥️ Analista':''}`.trim()||'Sem acesso';}
  async function coletarUsuariosExistentes(){
    await carregarLojas();
    if(delegadoAtual()){const r=await gestaoCall('listarGestaoAcessos',{});modelosAcesso=r.modelos;usuarios=r.usuarios;return usuarios;}
    const gestao=ehMasterAtual()?await gestaoCall('listarGestaoAcessos',{}):{modelos:[]};modelosAcesso=gestao.modelos;
    const mapa=new Map(),snap=gestao.usuarios?{docs:gestao.usuarios.map(u=>({id:u.id,data:()=>u}))}:await raw().collection(ACCESS).get().catch(()=>({docs:[]}));
    snap.docs.forEach(d=>{const x={id:d.id,...d.data()};if(x.conta_secundaria===true)return;mapa.set(x.uid||x.email||d.id,x);});
    // PEDIDO AO VIVO (2026-09-10, "até os usuários demora pra carregar"):
    // era um for/await SEQUENCIAL — uma leitura de dt_operadores por loja,
    // esperando terminar uma pra só então começar a próxima. Com N lojas
    // isso sozinho já custava N idas e voltas ao servidor em série antes da
    // lista aparecer. Promise.all troca por "todas ao mesmo tempo" sem
    // mudar o que é buscado nem a ordem de mescla (resultadosPorLoja mantém
    // a ordem de lojasCache, processado abaixo na mesma sequência de antes).
    const resultadosPorLoja=await Promise.all(lojasCache.map(loja=>raw().collection('lojas').doc(loja.id).collection('dt_operadores').limit(500).get().then(s=>({loja,docs:s.docs})).catch(e=>{console.warn('[Usuários]',e.message);return{loja,docs:[]};})));
    resultadosPorLoja.forEach(({loja,docs})=>{docs.forEach(d=>{const o={id:d.id,...d.data()};if(o.conta_secundaria===true)return;const k=o.uid||o.email||d.id,a=mapa.get(k)||{};mapa.set(k,{...o,...a,uid:a.uid||o.uid||d.id,email:a.email||o.email||'',nome:a.nome||o.nome||o.name||'',_lojasEncontradas:[...new Set([...(a._lojasEncontradas||[]),loja.id])]});});});
    const atual=global._currentAnalistaUser;if(atual){const k=atual.uid||atual.email;if(!mapa.has(k))mapa.set(k,{uid:atual.uid,email:atual.email,nome:atual.displayName||atual.email?.split('@')[0],perfil:'analista',acesso_todas_lojas:true,lojas_permitidas:[],canais_acesso:{coletor:true,analista:true},permissoes:todos()});}
    usuarios=[...mapa.values()].sort((a,b)=>String(a.nome||a.email).localeCompare(String(b.nome||b.email),'pt-BR'));return usuarios;
  }
  async function listarOperadores(){const w=document.getElementById('op-lista-wrap');if(!w)return;w.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando usuários…</div></div>';try{await coletarUsuariosExistentes();renderUsuarios();opCarregarOperadoresParaFiltro();}catch(e){w.innerHTML=`<div class="empty"><div class="empty-title">Erro ao carregar usuários</div><div class="empty-sub">${esc(e.message)}</div></div>`;}}
  function usuarioProtegido(u){
    const atual=global._currentAnalistaUser;
    return !u?.uid||u.uid===atual?.uid||u.admin_mestre===true||u.administrador_mestre===true;
  }
  function loginsHtml(u){const analista=u.email_analista||((u.canais_acesso?.analista===true||u.perfil==='analista')?u.email:'');const coletor=u.login_coletor||String(u.email_coletor||((u.canais_acesso?.coletor!==false&&u.perfil!=='analista')?u.email:'')).split('@')[0];return `${analista?`<div style="font-size:.72rem;color:var(--muted)">🖥️ ${esc(analista)}</div>`:''}${coletor?`<div style="font-size:.72rem;color:var(--muted)">📱 ${esc(coletor)}</div>`:''}`||'<div style="font-size:.72rem;color:var(--muted)">—</div>';}
  function renderUsuarios(){
    const w=document.getElementById('op-lista-wrap');
    if(!w)return;
    let filtroModelo=document.getElementById('op-filtro-modelo');
    if(!filtroModelo){filtroModelo=document.createElement('select');filtroModelo.id='op-filtro-modelo';filtroModelo.className='field';filtroModelo.style.maxWidth='320px';w.parentNode.insertBefore(filtroModelo,w);filtroModelo.onchange=renderUsuarios;}
    const modeloFiltrado=filtroModelo.value||'';filtroModelo.innerHTML='<option value="">Todos os setores / modelos</option><option value="sem-modelo">Sem modelo cadastrado</option>'+modelosAcesso.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.nome)+'</option>').join('');filtroModelo.value=modeloFiltrado;
    const q=String(document.getElementById('op-busca')?.value||'').toLowerCase();
    const perfil=String(document.getElementById('op-filtro-perfil')?.value||'');
    const status=String(document.getElementById('op-filtro-status')?.value||'');
    const lista=usuarios.map((u,i)=>({...u,_indiceOriginal:i})).filter(u=>{
      const texto=`${u.nome||''} ${u.email||''} ${u.email_analista||''} ${u.email_coletor||''} ${u.login_coletor||''} ${u.perfil||''} ${u.setor||''}`.toLowerCase();
      const p=String(u.perfil||u.tipo||'operador').toLowerCase();
      const ehAdmin=u.admin_mestre===true||u.administrador_mestre===true||p==='administrador'||p==='admin';
      const perfilOk=!perfil||(perfil==='administrador'?ehAdmin:perfil==='analista'?(p==='analista'&&!ehAdmin):(p==='operador'&&!ehAdmin));
      const statusOk=!status||(status==='ativo'?u.ativo!==false:u.ativo===false);
      return texto.includes(q)&&perfilOk&&statusOk&&(!modeloFiltrado||(modeloFiltrado==='sem-modelo'?!u.modelo_acesso_id:u.modelo_acesso_id===modeloFiltrado));
    });
    global.DTAtualizarResumoUsuarios?.(usuarios,lista.length);
    if(!lista.length){w.innerHTML='<div class="empty"><div class="empty-title">Nenhum usuário encontrado</div></div>';return;}
    w.innerHTML=`<div class="tbl-wrap op-lista-linhas"><table>
      <thead><tr><th>Usuário</th><th>Login</th><th>Acesso</th><th>Lojas</th><th>Status</th><th style="width:74px;text-align:center">Ações</th></tr></thead>
      <tbody>${lista.map(u=>{
        const loginPrincipal=u.email_analista||u.email||'—';
        const loginColetor=u.login_coletor||String(u.email_coletor||'').split('@')[0]||'—';
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:10px"><div class="u-avatar" style="width:32px;height:32px;font-size:.75rem;flex:0 0 auto">${esc((u.nome||u.email||'?').charAt(0).toUpperCase())}</div><div><div style="font-weight:750">${esc(u.nome||u.name||'Sem nome')}</div><div style="font-size:.68rem;color:var(--muted)">${esc(u.setor||u.perfil||'Usuário')}</div></div></div></td>
          <td><div style="font-size:.74rem">${esc(loginPrincipal)}</div><div style="font-size:.68rem;color:var(--muted)">Coletor: ${esc(loginColetor)}</div></td>
          <td>${esc(canais(u))}</td>
          <td>${u.acesso_todas_lojas===true?'<span class="badge badge-green">Todas</span>':lojasLabels(u.lojas_permitidas||u.lojasPermitidas)}</td>
          <td>${u.ativo===false?'<span class="badge badge-red">Bloqueado</span>':'<span class="badge badge-green">Ativo</span>'}</td>
          <td style="text-align:center"><button class="acao-lapis" style="display:${temPermissao('operadores','editar')?'inline-flex':'none'}" type="button" title="Configurar usuário" aria-label="Configurar usuário" data-usuario-editar="${u._indiceOriginal}">✏️</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
  function opFiltrarLista(){renderUsuarios();}
  // Lista vertical com círculo pequeno + nome (mesmo idioma visual das
  // ações do módulo) — substitui a grade de caixas lado a lado que "tomava
  // conta da tela toda" (pedido ao vivo do usuário).
  function montarChecks(id,sel){const b=document.getElementById(id);if(!b)return;const s=new Set(sel||[]);b.innerHTML=lojasCache.map(l=>`<label class="op-loja-item"><input type="checkbox" value="${esc(l.id)}" ${s.has(l.id)?'checked':''}><span>${esc(l.nome||l.id)}</span></label>`).join('');}
  function setModo(p,m){document.querySelectorAll(`input[name="op-lojas-${p}-modo"]`).forEach(r=>r.checked=r.value===m);const b=document.getElementById(`op-lojas-${p}-box`);if(b)b.style.display=m==='selecionadas'?'block':'none';}
  // Correção estrutural: antes, desmarcar "Analista" escondia o painel de
  // permissões INTEIRO (hack de quando só existia canal Coletor de
  // propósito, pra não travar recebimento-transbordo pra ele). Agora o
  // painel fica sempre visível e cada checkbox de canal RE-FILTRA a árvore
  // (_permAtualizarVisibilidade) — mostra só setor/módulo compatível com o
  // que está marcado, nos dois sentidos (Coletor sozinho não vê nada
  // exclusivo do Analista, e vice-versa).
  function renderCanais(prefix,c={}){const b=document.getElementById(`op-canais-${prefix}`);if(!b)return;b.innerHTML=[['coletor','📱 Coletor'],['analista','🖥️ Analista']].map(([id,n])=>`<label class="op-toggle-chip"><input type="checkbox" data-canal="${id}" ${c[id]===true?'checked':''}> ${n}</label>`).join('');b.querySelectorAll('[data-canal]').forEach(chk=>chk.addEventListener('change',()=>{_permAtualizarVisibilidade(prefix);if(prefix==='criar')opGerarUsername();}));}
  // Setores: fase 1 da unificação com o Sistema de Produção — controla só
  // quais abas de topo (Logística/Compras/PCP/Produção) aparecem pro login;
  // dentro de cada setor, os módulos continuam filtrados pelas permissões
  // de sempre (renderPermissoes/temPermissao), sem mudança nessa mecânica.
  // Logística vem marcada por padrão (undefined !== false) pra ninguém
  // perder acesso ao que já usa hoje.
  var SETORES=[['logistica','🚚 Logística'],['compras','🛒 Compras'],['pcp','📋 PCP'],['producao','🏭 Produção'],['atendimento','💬 Atendimento']];
  // PEDIDO AO VIVO (2026-08-27): "seleciono a loja... aí seleciona os
  // setores... aí só vai aparecer as permissões do que eu selecionar" —
  // antes, marcar/desmarcar setor aqui não reagia em nada; a árvore de
  // permissões (renderPermissoes) sempre mostrava TODOS os setores. Agora
  // dispara o mesmo filtro que os canais já usam (_permAtualizarVisibilidade),
  // que também esconde o setor inteiro quando ele não está marcado aqui.
  // BUG AO VIVO REAL (2026-08-27 — "quando eu seleciono compras, ou PCP ou
  // produção, a tela fica toda branca"): o checkbox aqui usava
  // `data-setor`, o MESMO nome de atributo que a barra de navegação de
  // Setores do topo do app já usa pra trocar de setor inteiro (ver
  // document.addEventListener('click',...) mais abaixo, que casa QUALQUER
  // `[data-setor]` clicado em qualquer lugar do documento e chama
  // irParaSetor()). Clicar num checkbox "Compras/PCP/Produção" aqui também
  // disparava irParaSetor('compras'/'pcp'/'producao') por baixo — trocando
  // o setor do app inteiro e escondendo a shell onde o modal estava,
  // exatamente a "tela em branco" relatada. Renomeado pra `data-op-setor`,
  // que não colide com nada.
  function renderSetores(prefix,s={}){const b=document.getElementById(`op-setores-${prefix}`);if(!b)return;b.innerHTML=SETORES.map(([id,n])=>`<label class="op-toggle-chip"><input type="checkbox" data-op-setor="${id}" ${(id==='logistica'?s[id]!==false:s[id]===true)?'checked':''}> ${n}</label>`).join('');b.querySelectorAll('[data-op-setor]').forEach(chk=>chk.addEventListener('change',()=>_permAtualizarVisibilidade(prefix)));}
  function lerSetores(prefix){const o={logistica:false,compras:false,pcp:false,producao:false};document.querySelectorAll(`#op-setores-${prefix} [data-op-setor]`).forEach(x=>o[x.dataset.opSetor]=x.checked);return o;}
  // Reforma da tela de Usuários e Permissões (correção estrutural) — trocou
  // a grade solta de cards por uma árvore Canal → Setor → Módulo → Ação. O
  // Canal é o seletor "Onde este login pode entrar" logo ACIMA desta árvore
  // (renderCanais) — ele não vira um nível de indentação a mais aqui dentro,
  // ele FILTRA quais setor/módulo aparecem (seção 7.2 do pedido: conta só-
  // Coletor não deve nem ver permissão exclusiva do Analista). Setor agrupa
  // os módulos (mecânico, por `m.setor`); Módulo é o card recolhível de
  // sempre; Ação são os chips de dentro. `data-perm-canais` guarda os canais
  // do módulo pra o filtro em _permAtualizarVisibilidade() decidir o que
  // mostrar sem precisar re-renderizar a árvore inteira a cada clique.
  var SETORES_PERM_INFO={logistica:{label:'🚚 Logística'},compras:{label:'🛒 Compras'},pcp:{label:'📋 PCP'},producao:{label:'🏭 Produção'},atendimento:{label:'💬 Atendimento'}};
  function renderPermissoes(prefix,p){
    const b=document.getElementById(`op-permissoes-${prefix}`);if(!b)return;
    const perms=normalizar(p,false);
    const totalGeral=MODULOS.reduce((a,m)=>a+m.acoes.length,0);
    const marcadosGeral=MODULOS.reduce((a,m)=>a+m.acoes.filter(ac=>perms[m.id]?.[ac]===true).length,0);
    const porSetor={};
    MODULOS.forEach(m=>{(porSetor[m.setor]=porSetor[m.setor]||[]).push(m);});
    const arvore=Object.keys(SETORES_PERM_INFO).filter(s=>(porSetor[s]||[]).length).map(setorId=>{
      const modulosDoSetor=porSetor[setorId];
      const marcadosSetor=modulosDoSetor.reduce((a,m)=>a+m.acoes.filter(ac=>perms[m.id]?.[ac]===true).length,0);
      const totalSetor=modulosDoSetor.reduce((a,m)=>a+m.acoes.length,0);
      const modulosHtml=modulosDoSetor.map(m=>{
        const marcados=m.acoes.filter(a=>perms[m.id]?.[a]===true).length;
        const todas=marcados===m.acoes.length, nenhuma=marcados===0;
        const busca=esc((m.nome+' '+m.acoes.map(a=>(codigoPermissao(m.id,a)+' '+ROTULOS[a])).join(' ')).toLowerCase());
        return `<div class="perm-modulo" data-perm-card data-perm-busca="${busca}" data-perm-canais="${m.canais.join(',')}">
          <div class="perm-modulo-hdr" data-perm-toggle-modulo="1">
            <span class="perm-modulo-seta">▸</span>
            <label class="perm-card-toggle" onclick="event.stopPropagation()">
              <input type="checkbox" data-modulo-all="${m.id}" ${todas?'checked':''} onchange="opMarcarModulo('${prefix}','${m.id}',this.checked)">
              <span class="perm-card-icon">${MODULO_ICONES[m.id]||'▫️'}</span>
              <span class="perm-card-name">${esc(m.nome)}</span>
            </label>
            <span class="perm-card-count ${todas?'is-complete':nenhuma?'is-empty':'is-partial'}" data-contagem-modulo="${m.id}">${marcados}/${m.acoes.length}</span>
          </div>
          <div class="perm-modulo-acoes">${m.acoes.map(a=>`<label class="perm-chip" title="Permissão ${codigoPermissao(m.id,a)} — ${esc(m.nome)} · ${esc(ROTULOS[a])}"><input type="checkbox" data-modulo="${m.id}" data-acao="${a}" ${perms[m.id]?.[a]===true?'checked':''} onchange="opAtualizarContagemModulo('${prefix}','${m.id}')"><span class="perm-code">${codigoPermissao(m.id,a)}</span> ${ROTULOS[a]}</label>`).join('')}</div>
        </div>`;
      }).join('');
      return `<div class="perm-setor" data-perm-setor="${setorId}">
        <div class="perm-setor-hdr" data-perm-toggle-setor="1">
          <span class="perm-setor-seta">▾</span>
          <label onclick="event.stopPropagation()"><input type="checkbox" data-setor-all="${setorId}" onchange="opMarcarSetor('${prefix}','${setorId}',this.checked)"> ${SETORES_PERM_INFO[setorId].label}</label>
          <span class="perm-card-count" data-contagem-setor="${setorId}" style="margin-left:auto">${marcadosSetor}/${totalSetor}</span>
        </div>
        <div class="perm-setor-modulos">${modulosHtml}</div>
      </div>`;
    }).join('');
    b.innerHTML=htmlModelo(prefix)+`<div class="perm-presets">
      <span class="perm-presets-label">Modelo rápido:</span>
      ${PRESETS.map(pr=>`<button type="button" class="btn btn-ghost btn-sm" title="${esc(pr.descricao)}" data-op-preset="${pr.id}" data-op-preset-prefix="${prefix}">${pr.icone} ${esc(pr.nome)}</button>`).join('')}
    </div>
    <div class="perm-toolbar">
      <input type="text" class="perm-busca" placeholder="🔍 Buscar módulo ou permissão..." oninput="opFiltrarPermissoes('${prefix}',this.value)">
      <span class="perm-total-geral" data-contagem-geral="${prefix}">${marcadosGeral} de ${totalGeral} selecionadas</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',true)">✓ Marcar tudo</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',false)">✕ Limpar tudo</button>
    </div>
    <div class="perm-arvore" data-perm-grid="${prefix}">${arvore}</div>
    <div class="perm-vazio" data-perm-vazio="${prefix}" style="display:none">Nenhuma permissão encontrada para essa busca (ou nenhum módulo faz sentido pro canal marcado).</div>`;
    b.querySelectorAll('[data-modulo]').forEach(x=>{x.disabled=(!ehMasterAtual()&&!concedivelAtual(x.dataset.modulo,x.dataset.acao))||(prefix==='modelo'&&areaModelo(MODULOS.find(m=>m.id===x.dataset.modulo))==='sistema');});
    MODULOS.forEach(m=>_permAtualizarIndeterminado(prefix,m.id));
    _permAtualizarVisibilidade(prefix);
    _permAtualizarContagemGeral(prefix);
  }
  function _permAtualizarContagemGeral(prefix){
    const ctx=contextoElegivel(prefix);
    const box=document.getElementById(`op-permissoes-${prefix}`);if(!box)return;
    const checks=[...box.querySelectorAll('[data-modulo]')];
    const marcados=checks.filter(x=>x.checked).length;
    const el=box.querySelector(`[data-contagem-geral="${prefix}"]`);if(el)el.textContent=`${marcados} de ${checks.length} selecionadas`;
    box.querySelectorAll('[data-perm-setor]').forEach(s=>{const cs=[...s.querySelectorAll('[data-modulo]')].filter(x=>elegivel(prefix,x,ctx)),n=cs.filter(x=>x.checked).length,all=s.querySelector('[data-setor-all]'),count=s.querySelector('[data-contagem-setor]');if(all){all.checked=cs.length>0&&n===cs.length;all.indeterminate=n>0&&n<cs.length;all.disabled=cs.length===0;}if(count)count.textContent=n+'/'+cs.length;});
  }
  function _permAtualizarIndeterminado(prefix,moduloId){
    const ctx=contextoElegivel(prefix);
    const box=document.getElementById(`op-permissoes-${prefix}`);if(!box)return;
    const checks=[...box.querySelectorAll(`[data-modulo="${moduloId}"]`)].filter(x=>elegivel(prefix,x,ctx));
    const marcados=checks.filter(x=>x.checked).length, total=checks.length;
    const contagem=box.querySelector(`[data-contagem-modulo="${moduloId}"]`);
    if(contagem){contagem.textContent=`${marcados}/${total}`;contagem.className='perm-card-count '+(marcados===total?'is-complete':marcados===0?'is-empty':'is-partial');}
    const todas=box.querySelector(`[data-modulo-all="${moduloId}"]`);
    if(todas){todas.checked=total>0&&marcados===total;todas.indeterminate=marcados>0&&marcados<total;}
  }
  // Substitui a busca de texto pura por uma que também respeita o canal —
  // as duas razões de esconder um módulo (busca não bate, canal não é
  // compatível) precisam ser combinadas (E lógico), não uma sobrescrever a
  // outra. `termoParam` vem de quem digitou (oninput); quando ausente
  // (chamada pelo listener de canal, que não tem o texto em mãos), relê o
  // valor atual do campo de busca direto do DOM.
  function _permAtualizarVisibilidade(prefix,termoParam){
    const grid=document.querySelector(`[data-perm-grid="${prefix}"]`);if(!grid)return;
    const campoBusca=document.querySelector(`#op-permissoes-${prefix} .perm-busca`);
    const t=String(termoParam!==undefined?termoParam:(campoBusca?.value||'')).trim().toLowerCase();
    const canaisMarcados=lerCanais(prefix);
    const canaisAtivos=Object.keys(canaisMarcados).filter(c=>canaisMarcados[c]);
    const setoresMarcados=lerSetores(prefix);
    let visiveis=0;
    grid.querySelectorAll('[data-perm-setor]').forEach(setorEl=>{
      // "só vai aparecer as permissões do que eu selecionar" — setor
      // desmarcado em "Setores" esconde o bloco inteiro, sem nem olhar os
      // módulos de dentro (o filtro de canal continua rodando por cima,
      // pros setores que ficaram visíveis).
      if(!setoresMarcados[setorEl.dataset.permSetor]){setorEl.style.display='none';setorEl.querySelectorAll('[data-perm-card]').forEach(card=>card.style.display='none');return;}
      let algumVisivelNesteSetor=false;
      setorEl.querySelectorAll('[data-perm-card]').forEach(card=>{
        const canaisModulo=(card.dataset.permCanais||'').split(',').filter(Boolean);
        const combinaCanal=canaisAtivos.some(c=>canaisModulo.includes(c));
        const combinaBusca=!t||(card.dataset.permBusca||'').includes(t);
        const ok=combinaCanal&&combinaBusca;
        card.style.display=ok?'':'none';
        if(ok){visiveis++;algumVisivelNesteSetor=true;}
      });
      setorEl.style.display=algumVisivelNesteSetor?'':'none';
    });
    const vazio=document.querySelector(`[data-perm-vazio="${prefix}"]`);if(vazio)vazio.style.display=visiveis?'none':'block';
    MODULOS.forEach(m=>_permAtualizarIndeterminado(prefix,m.id));_permAtualizarContagemGeral(prefix);
  }
  function opFiltrarPermissoes(prefix,termo){_permAtualizarVisibilidade(prefix,termo);}
  function contextoElegivel(prefix){return {canais:lerCanais(prefix),setores:lerSetores(prefix),master:ehMasterAtual()};}
  function elegivel(prefix,x,ctx){
    const mod=MODULOS.find(m=>m.id===x.dataset.modulo);if(!mod||x.disabled)return false;
    if(prefix==='modelo'&&areaModelo(mod)==='sistema')return false;
    ctx=ctx||contextoElegivel(prefix);
    return ctx.setores[mod.setor]===true&&mod.canais.some(c=>ctx.canais[c]===true)&&(ctx.master||concedivelAtual(mod.id,x.dataset.acao));
  }
  function opMarcarSetor(prefix,id,v){
    const ctx=contextoElegivel(prefix);
    const box=document.getElementById('op-permissoes-'+prefix);if(!box)return;
    box.querySelectorAll('[data-perm-setor="'+id+'"] [data-modulo]').forEach(x=>{if(elegivel(prefix,x,ctx))x.checked=v;});
    MODULOS.forEach(m=>_permAtualizarIndeterminado(prefix,m.id));_permAtualizarContagemGeral(prefix);
  }
  global.opMarcarSetor=opMarcarSetor;
  function opAtualizarContagemModulo(prefix,moduloId){
    _permAtualizarIndeterminado(prefix,moduloId);
    _permAtualizarContagemGeral(prefix);
  }
  function opMarcarModulo(prefix,moduloId,valor){
    const ctx=contextoElegivel(prefix);
    document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo="${moduloId}"]`).forEach(x=>{if(elegivel(prefix,x,ctx))x.checked=valor;});
    opAtualizarContagemModulo(prefix,moduloId);
  }
  function opMarcarPermissoes(prefix,v){
    const ctx=contextoElegivel(prefix);
    document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo]`).forEach(x=>{if(elegivel(prefix,x,ctx))x.checked=v;});
    MODULOS.forEach(m=>_permAtualizarIndeterminado(prefix,m.id));
    _permAtualizarContagemGeral(prefix);
  }
  function lerCanais(prefix){const o={coletor:false,analista:false};document.querySelectorAll(`#op-canais-${prefix} [data-canal]`).forEach(x=>o[x.dataset.canal]=x.checked);return o;}
  function lerPermissoes(prefix){const p={};MODULOS.forEach(m=>p[m.id]={});document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo]`).forEach(x=>p[x.dataset.modulo][x.dataset.acao]=x.checked);return p;}
  function validarAcesso(prefix){const c=lerCanais(prefix);if(!c.coletor&&!c.analista){global.showToast?.('Libere Coletor e/ou Analista','error');return false;}if(c.analista&&!MODULOS.some(m=>lerPermissoes(prefix)[m.id]?.visualizar)){global.showToast?.('Libere ao menos uma aba do Analista','error');return false;}return true;}
  function opSetModoLojasCriar(m){setModo('criar',m);}function opSetModoLojasEditar(m){setModo('editar',m);}
  // PEDIDO AO VIVO (2026-09-18): "quero que cada comprador só veja os
  // próprios produtos... só o gerente pode escolher ver de outro" — papel
  // formal (em vez do antigo _usuarioPcp() que liberava a lista de
  // compradores pra QUALQUER um com a permissão 'pcp-central', sem
  // distinção nenhuma). Usado por 89-compras-dashboard.js e pelas outras
  // telas de Compras que também precisam desse mesmo escopo.
  function opAtualizarCamposPapelCompras(){const papel=document.getElementById('opedit-papel-compras')?.value||'';const wrap=document.getElementById('opedit-compradores-gerenciados-wrap');if(wrap)wrap.style.display=papel==='gerente'?'block':'none';}
  async function opEditarUsuario(i){if(!temPermissao('operadores','editar'))return global.showToast?.('Sem autorização para editar usuários.','error');editando=usuarios[i];editandoIndice=i;if(!editando)return;await carregarLojas();document.getElementById('opedit-nome').value=editando.nome||editando.name||'';document.getElementById('opedit-cargo').value=editando.perfil||editando.tipo||'operador';document.getElementById('opedit-setor').value=editando.setor||'';document.getElementById('opedit-senha').value='';const recuperacao=document.getElementById('opedit-email-recuperacao');if(recuperacao){recuperacao.value=editando.email_recuperacao||'';recuperacao.disabled=delegadoAtual()&&!(global.DT_USUARIO_ACESSO_ATUAL.gestao_areas.operacoes||{}).senha;}const logins=document.getElementById('opedit-logins');if(logins)logins.textContent=[editando.email_analista,editando.email_coletor,editando.email].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ');preencherEmailsRecuperacao();if(delegadoAtual())document.getElementById('opedit-senha').disabled=!(global.DT_USUARIO_ACESSO_ATUAL.gestao_areas.operacoes||{}).senha;else document.getElementById('opedit-senha').disabled=false;const campoPapelCompras=document.getElementById('opedit-papel-compras');if(campoPapelCompras)campoPapelCompras.value=editando.papelCompras||'';const campoCompradoresGerenciados=document.getElementById('opedit-compradores-gerenciados');if(campoCompradoresGerenciados)campoCompradoresGerenciados.value=(editando.compradoresGerenciados||[]).join(', ');opAtualizarCamposPapelCompras();montarChecks('op-lojas-editar-lista',editando.lojas_permitidas||[]);setModo('editar',editando.acesso_todas_lojas===true?'todas':'selecionadas');const legadoAnalista=editando.perfil==='analista'&&!editando.canais_acesso;renderCanais('editar',editando.canais_acesso||{coletor:true,analista:legadoAnalista});renderSetores('editar',editando.setores_permitidos||{});renderPermissoes('editar',normalizar(editando.permissoes,legadoAnalista));document.getElementById('op-permissoes-editar').style.display='block';const modeloSel=document.getElementById('op-modelo-editar');if(modeloSel)modeloSel.value=editando.modelo_acesso_id||'';const velhoGestao=document.getElementById('op-gestao-usuario');if(velhoGestao)velhoGestao.remove();const ges=document.createElement('div');ges.id='op-gestao-usuario';ges.innerHTML=htmlGestaoUsuario(editando);document.getElementById('op-permissoes-editar').appendChild(ges);const btnExcluir=document.getElementById('btn-excluir-oped');if(btnExcluir)btnExcluir.style.display=usuarioProtegido(editando)?'none':'inline-flex';const diag=document.getElementById('op-diagnostico');if(diag){diag.style.display='none';diag.innerHTML='';}document.getElementById('op-modal-bg').style.display='flex';}
  function opFecharModal(){document.getElementById('op-modal-bg').style.display='none';editando=null;editandoIndice=-1;const diag=document.getElementById('op-diagnostico');if(diag){diag.style.display='none';diag.innerHTML='';}}
  async function opExcluirUsuarioAtual(){if(editandoIndice<0)return;const indice=editandoIndice;opFecharModal();await opExcluirUsuario(indice);}

  // ── Diagnóstico de acesso (correção estrutural) ─────────────────────────
  // Lê os documentos usuarios_acessos AO VIVO (não o cache de `usuarios`,
  // que só tem o que coletarUsuariosExistentes() já mesclou) — pra pegar
  // divergência de verdade entre a conta principal e as vinculadas, sem
  // depender de recarregar a lista inteira. Facilita o suporte: em vez de
  // adivinhar por que um Coletor específico está com permission-denied, dá
  // pra ver aqui se o documento dele existe e se bate com o principal.
  function _uidsVinculadosDe(u){return [...new Set([u.analista_uid,u.coletor_uid,...(u.uids_vinculados||[])].filter(Boolean).filter(x=>x!==(u.uid||u.id)))];}
  async function _lerDocAcesso(uid){const snap=await raw().collection(ACCESS).doc(uid).get().catch(()=>null);return {uid,existe:!!snap?.exists,dados:snap?.exists?snap.data():null};}
  function _permissoesIguais(a,b){return JSON.stringify(a||{})===JSON.stringify(b||{});}
  async function opAbrirDiagnostico(){
    if(!editando)return;
    const box=document.getElementById('op-diagnostico');if(!box)return;
    box.style.display='block';
    box.innerHTML='⏳ Verificando…';
    const uidPrincipal=editando.uid||editando.id||emailId(editando.email);
    const vinculados=_uidsVinculadosDe(editando);
    const principal=await _lerDocAcesso(uidPrincipal);
    const outros=await Promise.all(vinculados.map(_lerDocAcesso));
    _renderDiagnostico(uidPrincipal,principal,outros);
  }
  function _renderDiagnostico(uidPrincipal,principal,outros){
    const box=document.getElementById('op-diagnostico');if(!box)return;
    const divergentes=outros.filter(o=>o.existe&&!_permissoesIguais(o.dados.permissoes,principal.dados?.permissoes));
    const ausentes=outros.filter(o=>!o.existe);
    const linhaUid=(rotulo,d)=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0"><span style="color:var(--muted)">${esc(rotulo)}</span><span class="mono" style="font-size:.72rem">${esc(d.uid)} — ${d.existe?(d===principal?'✓ encontrado':(_permissoesIguais(d.dados.permissoes,principal.dados?.permissoes)?'✓ sincronizado':'⚠ não sincronizado')):'⚠ documento não encontrado'}</span></div>`;
    const alerta=(divergentes.length||ausentes.length)
      ? `<div class="badge badge-red" style="margin-top:8px;display:inline-block">⚠ Permissões do login Coletor não estão sincronizadas com o cadastro principal.</div><button type="button" class="btn btn-primary btn-sm" style="margin-top:8px;display:block" data-op-diagnostico-ressincronizar="${esc(uidPrincipal)}">🔄 Ressincronizar agora</button>`
      : `<div class="badge badge-green" style="margin-top:8px;display:inline-block">✓ Todas as identidades sincronizadas</div>`;
    // "Sincronizado" só compara contas entre si — não prova que a permissão
    // marcada na TELA chegou de verdade no Firestore (login único não tem
    // com o que comparar, sempre dá "sincronizado" mesmo se o valor real
    // salvo estiver errado/vazio). Esta seção mostra o valor CRU, lido
    // agora mesmo do documento — bypassa qualquer cache do navegador — pra
    // responder "o que está gravado de verdade" sem depender de adivinhação.
    const dadosPrincipal=principal.dados||{};
    const permissoesReais=dadosPrincipal.permissoes||{};
    const areasComAlgumaAcao=Object.keys(permissoesReais).filter(a=>Object.values(permissoesReais[a]||{}).some(v=>v===true));
    const linhaPermissoesReais=areasComAlgumaAcao.length
      ? areasComAlgumaAcao.map(area=>`<div style="padding:2px 0"><span class="mono" style="font-size:.7rem">${esc(area)}</span>: ${Object.keys(permissoesReais[area]).filter(ac=>permissoesReais[area][ac]===true).map(esc).join(', ')||'—'}</div>`).join('')
      : '<div style="color:var(--danger,#ff4757)">Nenhuma permissão marcada como true no documento — se a tela mostra checkboxes marcados, o Salvar não persistiu.</div>';
    box.innerHTML=`
      <div>${linhaUid('UID principal',principal)}</div>
      ${outros.map(o=>linhaUid('UID vinculado',o)).join('')}
      ${!outros.length?'<div style="color:var(--muted)">Nenhuma identidade vinculada — login único.</div>':''}
      ${alerta}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="font-weight:700;margin-bottom:4px">Valor real gravado agora (lido direto do Firestore):</div>
        <div>Canal: ${esc(JSON.stringify(dadosPrincipal.canais_acesso||{}))}</div>
        <div>Ativo: ${dadosPrincipal.ativo===false?'Não':'Sim'}</div>
        <div>Lojas: ${dadosPrincipal.acesso_todas_lojas===true?'Todas':(esc((dadosPrincipal.lojas_permitidas||[]).join(', ')||'nenhuma'))}</div>
        <div style="margin-top:4px">Permissões com alguma ação marcada:</div>
        ${linhaPermissoesReais}
      </div>`;
  }
  // Não é migração em massa — só reaplica o MESMO fan-out que
  // criarOperador()/opSalvarEdicao() já fazem, sob demanda, pra corrigir
  // contas que ficaram dessincronizadas ANTES desta correção existir (sem
  // reescrever nada em quem já está ok).
  async function opRessincronizarPermissoes(uidPrincipal){
    const doc=await raw().collection(ACCESS).doc(uidPrincipal).get().catch(()=>null);
    if(!doc?.exists)return global.showToast?.('Conta principal não encontrada','error');
    const dados=doc.data(),vinculados=_uidsVinculadosDe({...dados,uid:uidPrincipal});
    for(const alvoUid of vinculados){
      await raw().collection(ACCESS).doc(alvoUid).set({permissoes:dados.permissoes,canais_acesso:dados.canais_acesso,setores_permitidos:dados.setores_permitidos,conta_secundaria:true,cadastro_principal_uid:uidPrincipal},{merge:true});
    }
    global.showToast?.('Permissões ressincronizadas','success');
    const principal=await _lerDocAcesso(uidPrincipal),outros=await Promise.all(vinculados.map(_lerDocAcesso));
    _renderDiagnostico(uidPrincipal,principal,outros);
  }
  // Busca por UID direto (correção estrutural — pedido ao vivo: "não
  // consigo rastrear o UID dele"). Contas `conta_secundaria===true` ficam
  // de propósito fora da listagem principal (coletarUsuariosExistentes),
  // e um login criado por engano via "Primeiro acesso" no Coletor
  // (usuário digitou um login diferente do cadastrado, virou uma conta
  // órfã sem NENHUM vínculo) nunca aparece na lista de jeito nenhum — o
  // único jeito de achar essas contas é procurando pelo UID exato, direto
  // no documento, sem passar pela lista.
  async function opBuscarPorUid(){
    const uid=String(document.getElementById('op-busca-uid')?.value||'').trim();
    const box=document.getElementById('op-busca-uid-resultado');if(!box)return;
    if(!uid){global.showToast?.('Cole um UID pra buscar','error');return;}
    box.style.display='block';
    box.innerHTML='⏳ Buscando…';
    const doc=await _lerDocAcesso(uid);
    if(!doc.existe){
      box.innerHTML=`<div class="badge badge-red" style="display:inline-block">⚠ Nenhum documento usuarios_acessos encontrado pra esse UID.</div>
        <div style="margin-top:6px;color:var(--muted)">Isso normalmente quer dizer: a conta existe no Firebase Auth (alguém conseguiu logar com ela), mas NUNCA foi cadastrada nessa tela — típico de login criado sozinho pelo Coletor em "Primeiro acesso" com um usuário diferente do que o Analista configurou.</div>`;
      return;
    }
    const d=doc.dados;
    const areas=Object.keys(d.permissoes||{}).filter(a=>Object.values(d.permissoes[a]||{}).some(v=>v===true));
    box.innerHTML=`
      <div><b>E-mail:</b> ${esc(d.email||'—')}</div>
      <div><b>Nome:</b> ${esc(d.nome||'—')}</div>
      <div><b>Canal:</b> ${esc(JSON.stringify(d.canais_acesso||{}))}</div>
      <div><b>Ativo:</b> ${d.ativo===false?'Não':'Sim'}</div>
      <div><b>Conta secundária?</b> ${d.conta_secundaria===true?('Sim — vinculada a '+esc(d.cadastro_principal_uid||'?')+' (por isso não aparece na lista principal)'):'Não'}</div>
      <div><b>Permissões com alguma ação marcada:</b> ${areas.length?esc(areas.join(', ')):'nenhuma — permissoes:{} ou tudo false'}</div>`;
  }
  document.addEventListener('click',function(event){
    if(event.target.closest('[data-op-buscar-uid]')){opBuscarPorUid();return;}
    if(event.target.closest('[data-op-diagnostico-abrir]')){opAbrirDiagnostico();return;}
    const btnResync=event.target.closest('[data-op-diagnostico-ressincronizar]');
    if(btnResync){if(delegadoAtual())return global.showToast?.('Somente administrador pode ressincronizar cadastros legados.','error');opRessincronizarPermissoes(btnResync.getAttribute('data-op-diagnostico-ressincronizar'));return;}
  });
  // Árvore de permissões: cada setor/módulo expande/recolhe (mesmo idioma
  // de clique-delegado já usado no resto do arquivo, ex.: data-usuario-editar
  // acima) — clicar no checkbox "marcar tudo do módulo" (dentro do cabeçalho)
  // não deve expandir/recolher junto, por isso o próprio checkbox chama
  // `event.stopPropagation()` no HTML gerado por renderPermissoes().
  document.addEventListener('click',function(event){
    const setorHdr=event.target.closest('[data-perm-toggle-setor]');
    if(setorHdr){setorHdr.closest('[data-perm-setor]')?.classList.toggle('is-recolhido');return;}
    const moduloHdr=event.target.closest('[data-perm-toggle-modulo]');
    if(moduloHdr){moduloHdr.closest('.perm-modulo')?.classList.toggle('is-aberto');return;}
    const btnPreset=event.target.closest('[data-op-preset]');
    if(btnPreset){opAplicarPreset(btnPreset.getAttribute('data-op-preset-prefix'),btnPreset.getAttribute('data-op-preset'));return;}
  });
  async function opSalvarEdicao(){try{if(!editando||!validarAcesso('editar'))return;await opSalvarArea('editar',document.getElementById('opedit-nome').value.trim(),document.getElementById('opedit-senha').value,null,editando);global.showToast?.('Acessos salvos','success');opFecharModal();await listarOperadores();}catch(e){global.showToast?.(e.message,'error');}return;}
  // As permissões granulares (Recebimento · Transbordo, etc.) ficavam
  // escondidas pra login só-Coletor (display:none) — pensado quando essas
  // permissões só importavam pro Analista. Bug ao vivo relatado: um login
  // só-Coletor não conseguia gerar transbordo, porque nem tinha como o
  // admin marcar "Recebimento · Transbordo → Criar/Editar" pra ele — o
  // painel inteiro sumia. O fluxo de bip fixo por motorista (fase 15) passou
  // a exigir essa permissão pra ações que o Coletor dispara sozinho, então
  // o painel agora fica sempre visível, não só quando o canal Analista tá
  // marcado.
  // PEDIDO AO VIVO (2026-08-27): "se eu cancelar... e colocar de novo criar
  // novo usuário, não é pra vim com as informações, é pra vim do zero" —
  // nome/senha/preview de login nunca eram limpos ao reabrir; se você
  // cancelava e abria de novo, o que tinha digitado antes ainda estava lá.
  function opAbrirModalCriar(){
    const campoNome=document.getElementById('op-nome'),campoSenha=document.getElementById('op-senha');
    if(campoNome)campoNome.value='';
    if(campoSenha)campoSenha.value='';['op-email-login','op-email-recuperacao'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});preencherEmailsRecuperacao();
    const preview=document.getElementById('op-logins-preview');if(preview)preview.textContent='Digite o e-mail que será usado para entrar.';
    carregarLojas().then(()=>{montarChecks('op-lojas-criar-lista',[]);setModo('criar',delegadoAtual()?'selecionadas':'todas');renderCanais('criar',delegadoAtual()?(global.DT_USUARIO_ACESSO_ATUAL.gestao_areas.canais||{}):{coletor:true,analista:false});renderSetores('criar',{});renderPermissoes('criar',{});document.getElementById('op-permissoes-criar').style.display='block';document.getElementById('op-modal-criar-bg').style.display='flex';});
  }
  function opFecharModalCriar(){document.getElementById('op-modal-criar-bg').style.display='none';}
  // PEDIDO AO VIVO (2026-08-27): a prévia de login agora segue os
  // checkboxes de "Onde este login pode entrar" (canais), não mais o card
  // "Tipo de acesso" removido — mostra só a linha do canal marcado, e cada
  // linha exige só o que aquele login precisa (Analista só usa o primeiro
  // nome; Coletor precisa de primeiro+sobrenome).
  function opGerarUsername(){const campo=document.getElementById('op-email-login'),preview=document.getElementById('op-logins-preview'),c=lerCanais('criar');if(preview)preview.textContent=campo&&campo.value.trim()?'Login: '+campo.value.trim()+' · '+[c.analista?'Analista':'',c.coletor?'Coletor':''].filter(Boolean).join(' e '):'Digite o e-mail que será usado para entrar.';}

  function opGerarSenha(){document.getElementById('op-senha').value=Math.random().toString(36).slice(-4).toUpperCase()+Math.floor(1000+Math.random()*9000);}
  function toggleOpSenha(){const e=document.getElementById('op-senha');e.type=e.type==='password'?'text':'password';}function toggleOpeditSenha(){const e=document.getElementById('opedit-senha');e.type=e.type==='password'?'text':'password';}
  function opValidarUsername(){}function opValidarSenha(){}
  let cadastroPendente=false;
  async function criarOperador(){
    if(cadastroPendente||!validarAcesso('criar'))return;
    try{const nome=document.getElementById('op-nome').value.trim(),senha=document.getElementById('op-senha').value,logins=loginsManuais(document.getElementById('op-email-login').value,document.getElementById('op-email-recuperacao').value);if(!nome)throw new Error('Informe o nome.');if(senha.length<6)throw new Error('Senha com no mínimo 6 caracteres.');cadastroPendente=true;await opSalvarArea('criar',nome,senha,logins,null);document.getElementById('op-senha').value='';opFecharModalCriar();global.showToast?.('Usuário criado','success');await listarOperadores();}catch(e){global.showToast?.(e.message,'error');}finally{cadastroPendente=false;}
  }

  async function opExcluirUsuario(i){
    const u=usuarios[i];
    if(!u||usuarioProtegido(u))return global.showToast?.('Esta conta é protegida e não pode ser excluída','error');
    if(!temPermissao('operadores','excluir'))return global.showToast?.('Seu login não possui permissão para excluir usuários','error');
    const nome=u.nome||u.email||'este usuário';
    if(!global.confirm(`Excluir permanentemente ${nome}?\n\nO login será removido do Firebase Authentication e os acessos serão apagados de todas as lojas. Esta ação não pode ser desfeita.`))return;
    try{
      global.showToast?.('Excluindo usuário do Firebase…','info');
      const callable=firebase.app().functions('southamerica-east1').httpsCallable('excluirUsuario');
      const resposta=await callable({uid:u.uid});
      if(!resposta?.data?.ok)throw new Error('O Firebase não confirmou a exclusão');
      global.showToast?.('Usuário excluído do Firebase e de todas as lojas','success');
      await listarOperadores();
    }catch(e){
      console.error('[Usuários] Falha ao excluir',e);
      const codigo=String(e?.code||'').replace('functions/','');
      const msg=codigo==='not-found'?'Publique também as funções do Firebase antes de usar a exclusão.':(e?.message||'Falha desconhecida');
      global.showToast?.('Erro ao excluir usuário: '+msg,'error');
    }
  }

  function temPermissao(modulo,acao='visualizar'){
    const a=global.DT_USUARIO_ACESSO_ATUAL;
    // Segurança/UX: ausência de mapa NÃO significa acesso total. O único
    // bypass é conta mestre/administrador. Assim menu novo nunca aparece só
    // porque a chave ainda não existe no cadastro do usuário.
    if(!a)return false;
    if(a.ativo===false)return false;

    if(a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador')return true;
    if(modulo==='operadores'&&a.gestao_areas&&a.gestao_areas.operacoes){const d=a.gestao_areas.operacoes;return acao==='editar'?d.editar===true&&d.atribuir===true:d[acao]===true;}

    if(modulo==='operadores'&&acao!=='visualizar')return false;
    const p=a.permissoes||{};
    if(modulo==='recontagens') return p?.recontagens?.[acao]===true || p?.divergencias?.[acao]===true;
    // Cargas reaproveita Transbordo/Recebimentos por ser o mesmo fluxo.
    if(modulo==='recebimento-cargas'){
      return p?.['recebimento-transbordo']?.[acao]===true || p?.['recebimento-operacao']?.[acao]===true;
    }
    // Compatibilidade de rollout: a análise histórica usa a mesma fonte e
    // o mesmo nível de acesso do Relatório de Inventário. Usuários que já
    // tinham a permissão antiga não ficam bloqueados só porque a nova aba
    // ainda não existe no mapa salvo. Quando a chave nova existir, ela vence.
    if(modulo==='estoque-rel-analise'||modulo==='estoque-rel-analise-inventario'){
      const explicita=p?.['estoque-rel-analise'];
      if(explicita && typeof explicita==='object')return explicita?.[acao]===true;
      return p?.['estoque-rel-inventario']?.[acao]===true;
    }
    // Compatibilidade de rollout: essas duas áreas de Recebimento foram
    // criadas depois de muitos usuários já terem o mapa de permissões salvo.
    // Uma chave EXPLÍCITA (inclusive false) sempre vence; só herdamos quando
    // o módulo ainda não existe no documento legado.
    if(modulo==='recebimento-recusas'){
      const explicita=p?.['recebimento-recusas'];
      if(explicita && typeof explicita==='object')return explicita?.[acao]===true;
      const ehAnalista=(a.perfil==='analista')||a.canais_acesso?.analista===true;
      const tinhaRecebimento=['recebimento-operacao','recebimento-transbordo','recebimento-notas','recebimento-dashboard']
        .some(m=>p?.[m]?.visualizar===true);
      if(ehAnalista&&tinhaRecebimento)return true;
    }
    if(modulo==='recebimento-patio-tempo-real'){
      const explicita=p?.['recebimento-patio-tempo-real'];
      if(explicita && typeof explicita==='object')return explicita?.[acao]===true;
      const ehAnalista=(a.perfil==='analista')||a.canais_acesso?.analista===true;
      const tinhaRecebimento=['recebimento-operacao','recebimento-transbordo','recebimento-notas','recebimento-dashboard','recebimento-recusas']
        .some(m=>p?.[m]?.visualizar===true);
      if(ehAnalista&&tinhaRecebimento)return true;
    }
    return p?.[modulo]?.[acao]===true;
  }
  function moduloTemAlgumaPermissao(modulo){
    const m=MODULOS.find(x=>x.id===modulo);
    return !!(m&&m.acoes.some(acao=>temPermissao(modulo,acao)));
  }
  function _acaoPermitidaDoModulo(modulo,acao){
    const m=MODULOS.find(x=>x.id===modulo);
    if(!m)return true;
    if(m.acoes.includes(acao))return temPermissao(modulo,acao);
    // Busca/refresh sem ação própria no catálogo é leitura, não edição.
    if(acao==='atualizar'||acao==='buscar')return temPermissao(modulo,'visualizar');
    // Uma ação mutável não catalogada nunca ganha acesso por acidente.
    // Cai em editar quando o módulo possui essa ação; senão em executar;
    // por fim, nega. Isso força novas ações a entrarem no catálogo.
    if(m.acoes.includes('editar'))return temPermissao(modulo,'editar');
    if(m.acoes.includes('executar'))return temPermissao(modulo,'executar');
    return false;
  }
  function _inferirAcaoElemento(el){
    const explicita=el.getAttribute('data-perm-acao');if(explicita)return explicita;
    const txt=[el.getAttribute('onclick'),el.getAttribute('onchange'),el.getAttribute('data-action'),el.getAttribute('data-acao'),el.textContent].filter(Boolean).join(' ').toLowerCase();
    // Fechar/cancelar um modal é navegação, não uma permissão de negócio.
    if(/closemodal|fecharmodal|modal-close/.test(txt))return'visualizar';
    if(/exclu|apagar|remover|delet/.test(txt))return'excluir';
    if(/cancelar/.test(txt))return'cancelar';
    if(/aprovar/.test(txt))return'aprovar';
    if(/bloquear/.test(txt))return'bloquear';
    if(/finaliz|encerrar|fechar invent/.test(txt))return'finalizar';
    if(/publicar|liberar/.test(txt))return'publicar';
    if(/importar|upload|processfile|handlefile/.test(txt))return'importar';
    if(/exportar|baixar|download/.test(txt))return'exportar';
    if(/novo|nova|criar|adicionar|cadastrar|registrar/.test(txt))return'criar';
    if(/configurar|salvar config|mapeamento/.test(txt))return'configurar';
    if(/resetar|reprocessar|sincronizar|executar|gerar/.test(txt))return'executar';
    if(/salvar|editar|alterar|corrigir|reatrib|confirmar|concluir|movimentar|transferir/.test(txt))return'editar';
    if(/atualizar|recarregar|refresh|buscar|consultar|filtrar|pesquisar/.test(txt))return'atualizar';
    return'visualizar';
  }
  function aplicarPermissoesAnalista(){
    const a=global.DT_USUARIO_ACESSO_ATUAL;if(!a)return;
    const legado=!a.permissoes; if(legado)return;
    MODULOS.forEach(m=>{const nav=document.getElementById('nav-'+m.id),page=document.getElementById('page-'+m.id),ver=temPermissao(m.id);if(nav)nav.style.display=ver?'':'none';if(page&&!ver)page.classList.remove('on');});
    // BUG AO VIVO REAL (2026-09-03): "o site está travando... qualquer tela
    // que eu entre demora pra carregar" — esta função roda a cada mutação
    // no DOM inteiro (MutationObserver em document.body, debounced 40ms),
    // e cada página visitada na sessão FICA no DOM (só escondida via CSS,
    // nunca removida) — depois de navegar por várias telas ao longo do
    // dia, document.querySelectorAll varria TODAS elas (inclusive as ~20
    // escondidas) a cada mutação em QUALQUER lugar do app. Só a página
    // ATIVA (.page.on) tem botão que dá pra clicar — escondida não
    // interage com ninguém — então os dois scans abaixo (que antes eram
    // document.querySelectorAll(...), varrendo tudo) agora ficam restritos
    // a ela, cortando o trabalho de "todo o histórico de telas da sessão"
    // pra "só a tela que a pessoa está olhando agora".
    const escopo=document.querySelector('.page.on')||document;
    // Contrato explícito para botões/links dinâmicos: qualquer tela pode
    // declarar data-perm-modulo/data-perm-acao e o componente some antes de
    // poder ser usado. A validação no handler/rules continua como 2ª camada.
    escopo.querySelectorAll('[data-perm-modulo]').forEach(el=>{
      const modulo=el.getAttribute('data-perm-modulo');const acao=el.getAttribute('data-perm-acao')||'visualizar';
      el.style.display=_acaoPermitidaDoModulo(modulo,acao)?'':'none';
    });
    document.querySelectorAll('[data-perm-context-modulo]').forEach(ctx=>{
      const modulo=ctx.getAttribute('data-perm-context-modulo');
      ctx.querySelectorAll('button,[role="button"],a[onclick]').forEach(el=>{
        if(el.hasAttribute('data-perm-modulo'))return;
        const acao=_inferirAcaoElemento(el);
        if(acao!=='visualizar')el.style.display=_acaoPermitidaDoModulo(modulo,acao)?'':'none';
      });
    });
    // Legado: mapeia automaticamente ações inline pelo módulo da página.
    // Serve como cobertura para botões antigos ainda sem data-perm-*.
    escopo.querySelectorAll('button,[role="button"],a[onclick],[onclick],[onchange]').forEach(el=>{
      if(el.hasAttribute('data-perm-modulo'))return;
      const page=el.closest('.page')?.id?.replace(/^page-/,'');if(!page||!MODULOS.some(m=>m.id===page))return;
      const acao=_inferirAcaoElemento(el);if(acao!=='visualizar'&&!_acaoPermitidaDoModulo(page,acao))el.style.display='none';
    });
    // Recebimento (fase 15/FASE 5) usa clique delegado (data-*) em vez de
    // onclick inline (obrigatório porque as linhas são geradas
    // dinamicamente — onclick inline não reaplica em HTML injetado depois
    // do primeiro carregamento). O laço acima nunca alcança esses botões,
    // então a ação de cada um é mapeada aqui, 1 pra 1 com o que
    // firestore.rules realmente exige (não é heurística por texto).
    const RECEBIMENTO_ACAO_POR_ATRIBUTO={
      'recop-novo':'criar','recop-iniciar-descarga':'editar','recop-finalizar-descarga':'editar','recop-conferencia':'editar','recop-finalizar':'finalizar','recop-detalhes':'editar','recop-cancelar':'cancelar','recop-nota-remover':'criar',
      'rebt-qr-teste':'gerar-qrcode','rebt-novo':'criar','rebt-saida':'editar','rebt-chegada':'editar','rebt-iniciar':'editar','rebt-fim-descarga':'editar','rebt-finalizar':'finalizar','rebt-cancelar':'cancelar','rebt-excluir':'excluir','rebt-excluir-todos':'excluir','rebt-editar-completo':'corrigir-horario',
      'recmot-novo':'editar','recmot-editar':'editar','recmot-excluir':'editar',
      'recveic-novo':'editar','recveic-editar':'editar','recveic-excluir':'editar',
      'recdoca-novo':'editar','recdoca-editar':'editar','recdoca-excluir':'editar',
      'recag-novo':'criar','recag-editar':'editar','recag-excluir':'excluir',
      'recist-exportar':'exportar',
      'recusa-ler-pdfs':'importar','recusa-salvar-import':'importar','recusa-sync-bluesoft':'importar','recusa-sync-agora':'importar','recusa-ler-import-cadastros':'importar','recusa-salvar-import-cadastros':'importar',
      'recusa-add':'editar','recusa-toggle':'editar','recusa-del':'excluir','recusa-excluir':'excluir',
      'recusa-atualizar':'visualizar','recusa-exportar':'exportar','recusa-solicitar-conf':'criar','recusa-tratamento':'editar',
    };
    const RECEBIMENTO_SELETOR=Object.keys(RECEBIMENTO_ACAO_POR_ATRIBUTO).map(k=>'[data-'+k+']').join(',');
    // BUG AO VIVO REAL (2026-09-11): "busca rápido, mas pra mostrar tá
    // demorando" — este scan ficou de fora da correção de escopo acima
    // (2026-09-03) e continuava varrendo `document` inteiro, incluindo
    // TODAS as páginas de Recebimento já visitadas na sessão (ficam no DOM,
    // só escondidas — cada uma pode ter centenas de linhas com esses
    // atributos, ex.: Notas Retornadas/Recusas). Rodava a cada mutação em
    // QUALQUER lugar do app (MutationObserver em document.body), inclusive
    // disparado pelo próprio innerHTML que acabou de desenhar a tela nova —
    // por isso o efeito era só depois da busca já ter voltado rápido.
    escopo.querySelectorAll(RECEBIMENTO_SELETOR).forEach(el=>{
      const page=el.closest('.page')?.id?.replace(/^page-/,'');
      if(!page||!MODULOS.some(m=>m.id===page))return;
      const attr=Object.keys(RECEBIMENTO_ACAO_POR_ATRIBUTO).find(k=>el.hasAttribute('data-'+k));
      const acao=attr&&RECEBIMENTO_ACAO_POR_ATRIBUTO[attr];
      if(acao)el.style.display=temPermissao(page,acao)?'':'none';
    });
  }
  // Só faz sentido logo após o login, pra escolher a tela inicial de quem
  // não tem nenhuma página ainda ativa. Ficava DENTRO de
  // aplicarPermissoesAnalista() antes — só que essa função agora roda a
  // toda hora (MutationObserver a cada mudança no DOM, redraw do
  // Recebimento a cada ação), e como a tela de Usuários e Permissões não
  // faz parte do sistema de `.page`, toda vez que o admin mexia numa
  // permissão (o contador "N de M" muda o DOM → dispara o observer) o app
  // pulava sozinho pra primeira aba liberada — exatamente a aba que
  // estava sendo mexida. Chamar só uma vez, no login, resolve sem tirar a
  // funcionalidade original (era só esse único ponto que precisava dela).
  // BUG AO VIVO REAL (2026-09-17): "usuário só com acesso de recebimento...
  // mostra notas no pátio mas tá em inventário, sem acesso" — chamava
  // goPage() direto pro primeiro módulo permitido, mas Recebimento (e
  // Produção/PCP/Compras) moram numa casca própria (#setor-logistica-
  // recebimento-shell etc.) que só fica visível depois de irParaSetor().
  // Pra um usuário cujo ÚNICO módulo liberado é de Recebimento (ex.:
  // só "Pátio em Tempo Real"), a página certa ficava marcada .on (por
  // isso o título aparecia certo) só que dentro da casca ERRADA
  // (Inventário clássico, sempre visível por padrão) — a casca de
  // Recebimento nunca era mostrada, então a pessoa via o menu do
  // Inventário vazio (sem nenhuma permissão ali) em vez da tela real.
  function irParaPrimeiraPaginaPermitida(){
    const primeira=MODULOS.find(m=>temPermissao(m.id));
    if(document.querySelector('.page.on')||!primeira)return;
    // Produção/PCP/Compras: irParaSetor(setor) já navega sozinho pro
    // primeiro módulo permitido daquele setor (pcpIrParaAba/
    // comprasIrParaPagina/goPage internos) — chamar goPage aqui de novo
    // só duplicaria a navegação (ou, no caso de PCP/Compras, conflitaria
    // com o mecanismo próprio deles, que não é goPage).
    if(primeira.setor==='producao'||primeira.setor==='pcp'||primeira.setor==='compras'){
      global.irParaSetor?.(primeira.setor);
      return;
    }
    // Logística: precisa trocar pra visão certa (Inventário clássico vs
    // Recebimento, cascas diferentes) ANTES de abrir a página — senão a
    // página certa fica marcada .on dentro da casca escondida, e quem
    // aparece é a casca padrão (Inventário) vazia. 'recebimento' já navega
    // sozinho dentro de irParaSetor (mesmo motivo de Produção/PCP/Compras
    // acima — chamar goPage nesse caso duplicaria a navegação); só
    // 'inventario' nunca navegou sozinho e continua precisando deste
    // goPage explícito no final.
    if(primeira.setor==='logistica'){
      const view=primeira.id.indexOf('recebimento-')===0?'recebimento':'inventario';
      global.irParaSetor?.('logistica',view);
      if(view==='recebimento')return;
    }
    global.goPage?.(primeira.id,document.getElementById('nav-'+primeira.id));
  }
  // ── Setores (fase 1 da unificação com o Sistema de Produção) ──────────
  // Barra de abas no topo (Logística/Compras/PCP/Produção). Logística é o
  // Inventário de hoje, sem mudança nenhuma — só reclassificado como um
  // setor. Compras/PCP/Produção, nesta fase, são só um placeholder "em
  // construção"; os módulos reais entram nas próximas fases, um por vez.
  // PEDIDO AO VIVO (2026-09-10): "tirar PCP, Compras e Produção... como se
  // não fizesse mais parte do projeto" — Compras/PCP/Produção saíram deste
  // mapa de propósito. `irParaSetor()` já recusa qualquer id que não esteja
  // aqui (`if(!SETORES_INFO[id])return;`), e a barra de setores (linha
  // ~851, `Object.keys(SETORES_INFO)`) só oferece o que sobrou — não é só
  // "escondido", ninguém consegue mais navegar até lá pela UI. Os
  // `<script>` desses 3 setores também saíram de analista.html (só ficam
  // os poucos arquivos que o Recebimento usa de verdade, ver comentário
  // lá), então também não roda mais nenhum código nem leitura deles.
  var SETORES_INFO={
    logistica:{label:'🚚 Logística',icone:'🚚',titulo:'Logística'},
    compras:{label:'🛒 Compras',icone:'🛒',titulo:'Compras'},
    pcp:{label:'📋 PCP',icone:'📋',titulo:'PCP'},
    producao:{label:'🏭 Produção',icone:'🏭',titulo:'Produção'},
    atendimento:{label:'💬 Atendimento',icone:'💬',titulo:'Atendimento'}
  };
  var _setorAtual='logistica';
  // Logística (fase 15/FASE 1) passou a ter DOIS contextos completos —
  // Inventário (shell de sempre) e Recebimento (sidebar própria,
  // #setor-logistica-recebimento-shell) — escolhidos pelo flyout do botão
  // "Logística". `_logisticaView` guarda qual dos dois está ativo; entra
  // sempre em 'inventario' por padrão, exatamente como hoje.
  var _logisticaView='inventario';
  function _areaLazyDoSetor(id,view){
    if(id==='logistica'&&view==='recebimento')return'recebimento';
    if(id==='logistica'&&view==='estoque')return'estoque';
    if(id==='producao')return'producao';
    if(id==='pcp')return'pcp';
    if(id==='compras')return'compras';
    if(id==='atendimento')return'atendimento';
    return null;
  }
  function _paginaCarregandoDoSetor(area){
    if(area==='recebimento')return document.getElementById('page-recebimento-dashboard');
    if(area==='estoque')return document.getElementById('page-estoque-rel-inventario');
    return null;
  }
  async function irParaSetor(id,view){
    if(!SETORES_INFO[id])return;
    if(id==='logistica'&&view)_logisticaView=view;
    _setorAtual=id;
    document.querySelectorAll('#setor-bar button').forEach(function(b){
      var ativo=b.id==='setor-btn-'+id;
      b.style.borderBottomColor=ativo?'var(--accent)':'transparent';
      b.style.color=ativo?'#fff':'rgba(255,255,255,.65)';
    });
    var logisticaEl=document.getElementById('app-main-logistica'),recebimentoShell=document.getElementById('setor-logistica-recebimento-shell'),estoqueShell=document.getElementById('setor-logistica-estoque-shell'),placeholder=document.getElementById('setor-placeholder'),producaoShell=document.getElementById('setor-producao-shell'),pcpShell=document.getElementById('setor-pcp-shell'),comprasShell=document.getElementById('setor-compras-shell'),atendimentoShell=document.getElementById('setor-atendimento-shell');
    if(logisticaEl)logisticaEl.style.display=(id==='logistica'&&_logisticaView==='inventario')?'flex':'none';
    if(recebimentoShell)recebimentoShell.style.display=(id==='logistica'&&_logisticaView==='recebimento')?'flex':'none';
    if(estoqueShell)estoqueShell.style.display=(id==='logistica'&&_logisticaView==='estoque')?'flex':'none';
    if(producaoShell)producaoShell.style.display=id==='producao'?'flex':'none';
    if(pcpShell)pcpShell.style.display=id==='pcp'?'flex':'none';
    if(comprasShell)comprasShell.style.display=id==='compras'?'flex':'none';
    if(atendimentoShell)atendimentoShell.style.display=id==='atendimento'?'flex':'none';
    var _areaLazy=_areaLazyDoSetor(id,_logisticaView);
    if(_areaLazy&&typeof global.carregarScriptsDeArea==='function'){
      var _shellSeletor=_areaLazy==='estoque'?'#setor-logistica-estoque-shell':'#setor-logistica-recebimento-shell';
      var _semPaginaAindaAberta=!document.querySelector(_shellSeletor+' .page.on');
      var _pgCarregando=_semPaginaAindaAberta?_paginaCarregandoDoSetor(_areaLazy):null;
      if(_pgCarregando){_pgCarregando.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando módulo...</div></div>';_pgCarregando.classList.add('on');}
      try{await global.carregarScriptsDeArea(_areaLazy);global.AnalistaRouter?.rewrapNavegacao?.();}
      catch(e){
        if(_pgCarregando)_pgCarregando.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar este módulo</div><div class="empty-sub">Verifique a conexão e recarregue a página.</div></div>';
        return;
      }
      if(_pgCarregando)_pgCarregando.classList.remove('on');
    }
    if(id==='logistica'||id==='producao'||id==='pcp'||id==='compras'||id==='atendimento'){
      if(placeholder)placeholder.style.display='none';
      // BUG AO VIVO REAL (2026-09-17): esta cadeia ficava desatualizada toda
      // vez que um módulo novo de Recebimento nascia (faltavam paletes,
      // patio-tempo-real, retornos-indicadores, retornos-status, recusas-
      // indicadores, recusas-cadastros, consulta-notas) — quem só tinha
      // permissão num desses caía direto no "Sem módulos liberados", mesmo
      // tendo acesso de verdade. Reescrita na MESMA ordem de MODULOS acima,
      // pra nunca mais precisar lembrar de sincronizar os dois manualmente.
      if(id==='logistica'&&_logisticaView==='recebimento'&&!document.querySelector('#setor-logistica-recebimento-shell .page.on')){
        var _primeiraRecebimento=MODULOS.find(function(m){return m.id.indexOf('recebimento-')===0&&temPermissao(m.id);});
        if(_primeiraRecebimento)goPage(_primeiraRecebimento.id,document.getElementById('nav-'+_primeiraRecebimento.id));
        else{var pgr=document.getElementById('page-recebimento-dashboard');if(pgr){pgr.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pgr.classList.add('on');}}
      }
      // PEDIDO AO VIVO (2026-10-02): mesmo padrão do bloco de Recebimento
      // acima, pro novo sub-setor Estoque (Relatórios).
      // Abre sozinho o primeiro relatório de Relatórios (não o Apontamento,
      // que vem antes na lista de MODULOS e trocava o relatório pedido pela
      // rota). Prefixo TEM que ficar em 'estoque-rel-', não 'estoque-': os
      // módulos sem esse prefixo (separação, endereçamento, lote de trocas,
      // transformação) não são alcançados por nenhuma rota
      // "logistica/estoque/relatorios/*" — são abertos só por clique direto
      // no menu — então nenhum deles pode competir aqui pra não roubar a
      // navegação de quem pediu um relatório específico pela URL (achado ao
      // vivo: um 'estoque-' genérico aqui pegava os 3 primeiros da lista de
      // MODULOS, nenhum dos quais tinha página na tela de destino).
      if(id==='logistica'&&_logisticaView==='estoque'&&!document.querySelector('#setor-logistica-estoque-shell .page.on')){
        var _primeiraEstoque=MODULOS.find(function(m){return m.id.indexOf('estoque-rel-')===0&&m.id!=='estoque-rel-apontamento'&&temPermissao(m.id);});
        if(_primeiraEstoque)goPage(_primeiraEstoque.id,document.getElementById('nav-'+_primeiraEstoque.id));
        else{var pge=document.getElementById('page-estoque-rel-inventario');if(pge){pge.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pge.classList.add('on');}}
      }
      if(id==='pcp'&&!document.querySelector('#setor-pcp-shell .page.on')){
        if(temPermissao('pcp-central','visualizar')&&typeof global.pcpIrParaAba==='function')global.pcpIrParaAba('dashboard',document.getElementById('nav-pcp-dashboard'));
        else{var pgp=document.getElementById('page-pcp-central');if(pgp){pgp.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pgp.classList.add('on');}}
      }
      if(id==='compras'&&!document.querySelector('#setor-compras-shell .page.on')){
        if(temPermissao('compras-central','visualizar')&&typeof global.comprasIrParaPagina==='function')global.comprasIrParaPagina('dashboard',document.getElementById('nav-compras-dashboard'));
        else{var pgc=document.getElementById('page-compras-central');if(pgc){pgc.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pgc.classList.add('on');}}
      }
      if(id==='atendimento'&&!document.querySelector('#setor-atendimento-shell .page.on')){
        if(temPermissao('atendimento-dashboard','visualizar')&&typeof global.atendimentoIrParaPagina==='function')global.atendimentoIrParaPagina('dashboard',document.getElementById('nav-atendimento-dashboard'));
        else if(temPermissao('atendimento-conversas','visualizar')&&typeof global.atendimentoIrParaPagina==='function')global.atendimentoIrParaPagina('conversas',document.getElementById('nav-atendimento-conversas'));
        else{var pga=document.getElementById('page-atendimento-dashboard');if(pga){pga.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pga.classList.add('on');}}
      }
      if(id==='producao'&&!document.querySelector('#setor-producao-shell .page.on')){
        if(temPermissao('producao-dashboard','visualizar'))goPage('producao-dashboard',document.getElementById('nav-producao-dashboard'));
        else if(temPermissao('producao-ficha-tecnica','visualizar'))goPage('producao-ficha-tecnica',document.getElementById('nav-producao-ficha-tecnica'));
        else if(temPermissao('producao-maquinas','visualizar'))goPage('producao-maquinas',document.getElementById('nav-producao-maquinas'));
        else if(temPermissao('producao-programacao','visualizar'))goPage('producao-programacao',document.getElementById('nav-producao-programacao'));
        else if(temPermissao('producao-gantt','visualizar'))goPage('producao-gantt',document.getElementById('nav-producao-gantt'));
        else if(temPermissao('producao-realizado','visualizar'))goPage('producao-realizado',document.getElementById('nav-producao-realizado'));
        else if(temPermissao('producao-insumos','visualizar'))goPage('producao-insumos',document.getElementById('nav-producao-insumos'));
        else if(temPermissao('producao-projecao','visualizar'))goPage('producao-projecao',document.getElementById('nav-producao-projecao'));
        else if(temPermissao('producao-prog-automatica','visualizar'))goPage('producao-prog-automatica',document.getElementById('nav-producao-prog-automatica'));
        else if(temPermissao('producao-funcionarios','visualizar'))goPage('producao-funcionarios',document.getElementById('nav-producao-funcionarios'));
        else if(temPermissao('producao-relatorios','visualizar'))goPage('producao-relatorios',document.getElementById('nav-producao-relatorios'));
        else if(temPermissao('producao-setup','visualizar'))goPage('producao-setup',document.getElementById('nav-producao-setup'));
        else if(temPermissao('producao-mapa-fabrica','visualizar'))goPage('producao-mapa-fabrica',document.getElementById('nav-producao-mapa-fabrica'));
        else if(temPermissao('producao-config','visualizar'))goPage('producao-config',document.getElementById('nav-producao-config'));
        else if(temPermissao('producao-importacao','visualizar'))goPage('producao-importacao',document.getElementById('nav-producao-importacao'));
        else if(temPermissao('producao-estoque','visualizar'))goPage('producao-estoque',document.getElementById('nav-producao-estoque'));
        else{var pg=document.getElementById('page-producao-ficha-tecnica');if(pg){pg.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pg.classList.add('on');}}
      }
    }else{
      if(placeholder){
        placeholder.style.display='flex';
        var info=SETORES_INFO[id];
        var elIcone=document.getElementById('setor-placeholder-icone'),elTitulo=document.getElementById('setor-placeholder-titulo');
        if(elIcone)elIcone.textContent=info.icone;
        if(elTitulo)elTitulo.textContent=info.titulo;
      }
    }
  }
  // Derivado automaticamente de MODULOS em vez de lista manual — a lista
  // fixa anterior já estava desatualizada (faltavam recusas-indicadores,
  // retornos-indicadores, retornos-status, consulta-notas/devolucoes-
  // indicadores, recusas-cadastros), então telas novas paravam de contar
  // pra decidir se o setor Recebimento tem alguma permissão liberada.
  var RECEBIMENTO_MODULOS=MODULOS.filter(function(m){return m.id.indexOf('recebimento-')===0;}).map(function(m){return m.id;});
  // PEDIDO AO VIVO (2026-10-02): Logística ganhou um 3º sub-setor (Estoque,
  // relatórios de BI vindos do BigQuery) — mesmo molde de RECEBIMENTO_MODULOS
  // acima, derivado de MODULOS em vez de lista manual.
  var ESTOQUE_MODULOS=MODULOS.filter(function(m){return m.id.indexOf('estoque-')===0;}).map(function(m){return m.id;});
  // Engrenagem de Configurações (pedido ao vivo do usuário) — Usuários/
  // Coletores/Lojas/API são cross-loja, não fazem sentido enterrados dentro
  // só do setor Inventário; ficam na mesma linha dos setores, sempre
  // acessíveis de qualquer setor. String vazia (sem o ícone) se o usuário
  // não tiver nenhuma dessas permissões — evita mostrar uma engrenagem que
  // só abriria um painel vazio.
  // Correção estrutural (pedido ao vivo do usuário): as mesmas 3 opções
  // (Usuários/Coletores/Lojas) apareciam DUAS vezes — uma na engrenagem do
  // topo (só pra escolher qual abrir) e de novo como abas DENTRO do card
  // já aberto (mesmas 3 opções, mesmos nomes). A engrenagem agora é um
  // botão único que já abre direto na primeira opção que o usuário tem
  // permissão (Usuários → Coletores → Lojas, mesma ordem de antes) — as
  // abas de dentro do modal (cfgm-tab-*, HTML fixo em analista.html)
  // continuam sendo o único lugar de trocar entre as três.
  // PEDIDO AO VIVO (2026-10-01): "tirar as configurações que fica ali...
  // deixar só aí nesse menu do perfil" — a engrenagem ⚙️ Configurações
  // saiu da barra do topo; continua acessível só pelo botão dentro do
  // modal "Meu perfil" (abrirPerfilSistema, 123-configuracoes-sistema.js),
  // com a mesma permissão (podeConfig) que antes decidia se aparecia aqui.
  function _htmlFlyoutConfiguracoes(){
    var html='<div class="dt-globalbar-actions">';
    if(ehMasterAtual())html+='<button type="button" id="setor-btn-permissoes" data-system-permissions="1" class="dt-globalbar-btn" title="Permissões desta tela">🔐 <span>Permissões</span></button>';
    html+='<button type="button" id="setor-btn-perfil" data-system-profile="1" class="dt-globalbar-profile" title="Meu perfil"><span class="dt-globalbar-avatar" data-global-avatar>AN</span><span class="dt-globalbar-profile-text" data-global-user-name>Perfil</span> ▾</button>';
    html+='</div>';
    return html;
  }
  // Abas de dentro do modal seguem a MESMA permissão que antes decidia se o
  // item aparecia na engrenagem — sem isso, um usuário sem permissão de
  // "coletores" via a aba mesmo assim (só ficava invisível o atalho de
  // fora, não a aba de dentro).
  function _aplicarPermissaoAbasConfiguracoes(){
    var mapa={operadores:'cfgm-tab-operadores',coletores:'cfgm-tab-coletores',lojas:'cfgm-tab-lojas'};
    Object.keys(mapa).forEach(function(modulo){
      var el=document.getElementById(mapa[modulo]);
      if(el)el.style.display=temPermissao(modulo)?'':'none';
    });
    // A aba de Integração API segue a MESMA permissão que já gateava o
    // recurso em Inventário → Importar/Exportar ("importar-exportar") — não
    // é um módulo novo, só um segundo lugar de abrir a mesma tela.
    var elApi=document.getElementById('cfgm-tab-integracao');
    if(elApi)elApi.style.display=temPermissao('importar-exportar')?'':'none';
    // PEDIDO AO VIVO (2026-10-02): esta aba usava temPermissao('coletores')
    // — permissão sem nenhuma relação com impressoras de rede (cópia e
    // cola errada). Ganhou módulo próprio (ver MODULOS acima).
    var elImp=document.getElementById('cfgm-tab-impressoras');
    if(elImp)elImp.style.display=temPermissao('impressoras')?'':'none';
  }
  function aplicarSetoresPermitidos(){
    // Move page-integracao-api pro modal de Configurações já no boot (não só
    // na primeira vez que a engrenagem abre) — sem isso, quem for direto em
    // Inventário → Importar/Exportar → API antes de abrir a engrenagem veria
    // o card sumido: ele começa dentro de #ie-panel-api com class="page"
    // (escondida por padrão, só fica visível com .on), e só ganha .on
    // quando abrirModalConfiguracoes('integracao') roda.
    _moverPaginasParaModalConfiguracoes();
    var a=global.DT_USUARIO_ACESSO_ATUAL;if(!a)return;
    var admin=a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador';
    var setores=a.setores_permitidos||{};
    var idsLiberados=Object.keys(SETORES_INFO).filter(function(id){
      if(admin)return true;
      if(id==='logistica')return setores.logistica!==false;
      if(setores[id]===true)return true;
      // Reativa setor quando o usuário já possui permissão funcional nele,
      // mesmo que o campo legado setores_permitidos esteja ausente/desatualizado.
      // Não libera funções novas: a navegação interna continua obedecendo
      // temPermissao() em cada módulo.
      return MODULOS.some(function(m){return m.setor===id&&temPermissao(m.id);});
    });
    var bar=document.getElementById('setor-bar');if(!bar)return;
    var temAlgumaPermissaoRecebimento=RECEBIMENTO_MODULOS.some(function(m){return temPermissao(m);});
    var temAlgumaPermissaoEstoque=ESTOQUE_MODULOS.some(function(m){return temPermissao(m);});
    var flyoutConfig=_htmlFlyoutConfiguracoes();
    // Antes, com só 1 setor liberado, a barra inteira ficava escondida (não
    // fazia sentido mostrar 1 aba só). Agora "Logística" pode esconder um
    // flyout com Recebimento dentro — se for esse o único setor E o usuário
    // tiver alguma permissão de Recebimento, a barra continua visível (só
    // com essa aba) pra não esconder o único jeito de chegar em Recebimento.
    // A engrenagem de Configurações também precisa continuar acessível
    // mesmo nesse caso (é cross-loja, não depende de setor nenhum liberado).
    // BUG AO VIVO REAL (2026-09-18): "usuária só com acesso de Compras...
    // fica presa numa tela em branco, sem nada pra clicar" — com só 1 setor
    // liberado, este bloco sempre chamava irParaSetor('logistica') FIXO,
    // não importa qual fosse o setor de verdade. Pra quem só tem acesso a
    // Recebimento (logística) isso por acaso batia certo; pra Compras/PCP/
    // Produção, jogava a pessoa pro Inventário clássico — onde ela não tem
    // NENHUMA permissão — escondia a barra de setores (só 1 mesmo) e não
    // sobrava nenhum jeito de voltar pro setor certo. Some para o setor que
    // a pessoa REALMENTE tem, não sempre logística.
    if(idsLiberados.length<=1&&!(idsLiberados[0]==='logistica'&&(temAlgumaPermissaoRecebimento||temAlgumaPermissaoEstoque))){
      bar.innerHTML=flyoutConfig;
      bar.style.display=flyoutConfig?'flex':'none';
      if(typeof global.atualizarBarraGlobalConfig==='function')global.atualizarBarraGlobalConfig();
      irParaSetor(idsLiberados[0]||'logistica');
      return;
    }
    bar.innerHTML=idsLiberados.map(function(id){
      var btn='<button type="button" id="setor-btn-'+id+'" data-setor="'+id+'" style="background:transparent;border:none;color:rgba(255,255,255,.65);padding:12px 16px;font-size:.82rem;font-weight:700;cursor:pointer;border-bottom:3px solid transparent">'+SETORES_INFO[id].label+'</button>';
      // Fase 15 — só "Logística" ganha o flyout (Inventário/Recebimento);
      // os outros setores continuam abas simples, sem sub-navegação ainda.
      if(id!=='logistica')return btn;
      var itemRecebimento=temAlgumaPermissaoRecebimento?'<button type="button" class="setor-flyout-item" data-setor-view="recebimento">🚚 Recebimento</button>':'';
      var itemEstoque=temAlgumaPermissaoEstoque?'<button type="button" class="setor-flyout-item" data-setor-view="estoque">📊 Estoque</button>':'';
      return '<div class="setor-flyout-trigger">'+btn+
        '<div class="setor-flyout-panel">'+
          '<button type="button" class="setor-flyout-item" data-setor-view="inventario">📦 Inventário</button>'+
          itemRecebimento+
          itemEstoque+
        '</div></div>';
    }).join('')+flyoutConfig;
    bar.style.display='flex';
    if(typeof global.atualizarBarraGlobalConfig==='function')global.atualizarBarraGlobalConfig();
    irParaSetor(idsLiberados.includes(_setorAtual)?_setorAtual:'logistica');
  }
  // ── Modal de Configurações (engrenagem no topo) ──────────────────────
  // As páginas reais (#page-operadores/#page-coletores/#page-lojas) nunca
  // mudam de conteúdo/lógica — só o nó de DOM é movido pra dentro do modal
  // na primeira vez que ele abre (idempotente: se já estiver lá, não faz
  // nada). goPage() continua funcionando igual, porque ele acha a página
  // por id (document.getElementById), não importa onde ela mora na árvore.
  function _moverPaginasParaModalConfiguracoes(){
    var destino=document.getElementById('modal-config-conteudo');
    if(!destino)return;
    ['page-operadores','page-coletores','page-lojas','page-integracao-api','page-impressoras'].forEach(function(id){
      var el=document.getElementById(id);
      if(el&&el.parentNode!==destino)destino.appendChild(el);
    });
  }
  // goPage() troca .on em TODAS as .page do documento (não só dentro do
  // shell atual) — abrir o modal por cima de, por exemplo, PCP, e chamar
  // goPage('operadores',...) tiraria o .on da página do PCP que estava
  // ativa. Por isso guarda qual estava ativa ANTES de abrir, e restaura ao
  // fechar — assim o usuário volta pro exato lugar de onde saiu, sem
  // precisar navegar de novo (pedido ao vivo: "abrir numa janela na frente").
  var _paginaAntesConfig=null;
  function abrirModalConfiguracoes(pageId,itemEl){
    _moverPaginasParaModalConfiguracoes();
    var modalEl=document.getElementById('modal-configuracoes');
    if(modalEl&&!modalEl.classList.contains('open')){
      var atual=document.querySelector('.page.on');
      _paginaAntesConfig=atual?atual.id.replace(/^page-/,''):null;
    }
    global.openModal?.('modal-configuracoes');
    _aplicarPermissaoAbasConfiguracoes();
    document.querySelectorAll('#modal-configuracoes .cfgm-tab').forEach(function(b){b.classList.remove('on');});
    var tabBtn=document.getElementById('cfgm-tab-'+pageId);
    if(tabBtn)tabBtn.classList.add('on');
    // "integracao" não é um módulo de permissão de verdade (é a mesma tela
    // de sempre, "importar-exportar", só reaberta aqui) — goPage() genérico
    // checaria temPermissao('integracao','visualizar'), que não existe pra
    // ninguém, e bloquearia todo mundo. Mostra a página movida direto e
    // reaproveita ieSetTab('api') (já existente em
    // 43-importar-exportar-api.js) pra carregar a config salva nos campos.
    if(pageId==='impressoras'){
      if(!temPermissao('impressoras')){global.showToast?.('Você não possui acesso a esta aba.','error');return;}
      document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on');});
      var pgImp=document.getElementById('page-impressoras'); if(pgImp)pgImp.classList.add('on');
      var titImp=document.getElementById('page-title');if(titImp)titImp.textContent='Configurações · Impressoras';
      if(typeof global.renderImpressorasRede==='function')global.renderImpressorasRede();
      return;
    }
    if(pageId==='integracao'){
      if(!temPermissao('importar-exportar')){global.showToast?.('Você não possui acesso a esta aba.','error');return;}
      document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on');});
      var pg=document.getElementById('page-integracao-api');
      if(pg)pg.classList.add('on');
      var titEl=document.getElementById('page-title');if(titEl)titEl.textContent='Configurações · Integração API';
      global.ieSetTab?.('api');
      return;
    }
    goPage(pageId,document.getElementById('nav-'+pageId));
  }
  // PEDIDO AO VIVO (2026-08-27): "se eu tiver criando um e eu fechar, quando
  // eu clicar de novo lá nas configurações não é pra abrir já onde eu
  // estava, é pra abrir as configurações normal do começo" — fechar
  // Configurações agora também fecha Criar/Editar Usuário se algum dos
  // dois ficou aberto por cima, pra nunca reabrir Configurações já em cima
  // de um modal de usuário esquecido aberto.
  function fecharModalConfiguracoes(){
    global.closeModal?.('modal-configuracoes');
    const modalCriar=document.getElementById('op-modal-criar-bg');if(modalCriar)modalCriar.style.display='none';
    const modalEditar=document.getElementById('op-modal-bg');if(modalEditar)modalEditar.style.display='none';
    editando=null;editandoIndice=-1;
    if(_paginaAntesConfig)goPage(_paginaAntesConfig,document.getElementById('nav-'+_paginaAntesConfig));
    _paginaAntesConfig=null;
  }
  global.abrirModalConfiguracoes=abrirModalConfiguracoes;
  global.fecharModalConfiguracoes=fecharModalConfiguracoes;
  global.irParaSetor=irParaSetor;
  global.aplicarSetoresPermitidos=aplicarSetoresPermitidos;
  // data-setor + escutador delegado (em vez de onclick inline): o botão da
  // barra de Setores é gerado via innerHTML, e onclick injetado assim não
  // dispara em alguns navegadores/extensões — mesmo motivo pelo qual o
  // resto deste arquivo já usa data-usuario-editar + addEventListener em
  // vez de onclick pra linhas geradas dinamicamente.
  document.addEventListener('click',function(event){
    const botao=event.target.closest('[data-setor]');
    if(!botao)return;
    irParaSetor(botao.dataset.setor);
  });
  // Flyout de "Logística" (fase 15) — item do menu navega direto pra
  // Inventário ou Recebimento; clique no botão/gatilho alterna .open (fallback
  // pra telas touch, onde :hover não é confiável); clique fora fecha tudo.
  document.addEventListener('click',function(event){
    // Engrenagem de Configurações — checado ANTES do ramo genérico de
    // .setor-flyout-item logo abaixo (esses botões também têm essa classe,
    // só pra herdar o estilo do flyout; sem checar primeiro, cairiam no
    // ramo de baixo e chamariam irParaSetor('logistica', undefined) à toa).
    const itemConfig=event.target.closest('[data-config-abrir]');
    if(itemConfig){
      abrirModalConfiguracoes(itemConfig.dataset.configAbrir,itemConfig);
      itemConfig.closest('.setor-flyout-trigger')?.classList.remove('open');
      return;
    }
    const item=event.target.closest('.setor-flyout-item');
    if(item){
      irParaSetor('logistica',item.dataset.setorView);
      item.closest('.setor-flyout-trigger')?.classList.remove('open');
      return;
    }
    const trigger=event.target.closest('.setor-flyout-trigger');
    if(trigger){trigger.classList.toggle('open');return;}
    document.querySelectorAll('.setor-flyout-trigger.open').forEach(t=>t.classList.remove('open'));
  });

  // Segunda camada no Analista: mesmo que algum componente reexiba um
  // botão via JS, o clique não executa a ação sem a permissão correspondente.
  document.addEventListener('click',function(event){
    const el=event.target.closest&&event.target.closest('button,[role="button"],a[onclick],[data-perm-modulo]');
    if(!el)return;
    const moduloExp=el.getAttribute('data-perm-modulo');
    const page=el.closest('.page')?.id?.replace(/^page-/,'');
    const ctx=el.closest('[data-perm-context-modulo]');
    const modulo=moduloExp||(ctx&&ctx.getAttribute('data-perm-context-modulo'))||(page&&MODULOS.some(m=>m.id===page)?page:'');
    if(!modulo)return;
    const acao=el.getAttribute('data-perm-acao')||_inferirAcaoElemento(el);
    if(acao==='visualizar')return;
    if(_acaoPermitidaDoModulo(modulo,acao))return;
    event.preventDefault();event.stopPropagation();if(typeof event.stopImmediatePropagation==='function')event.stopImmediatePropagation();
    global.showToast?.('Você não possui permissão para esta ação.','error');
  },true);

  let timerPermissoes=null;
  document.addEventListener('DOMContentLoaded',function(){
    new MutationObserver(function(){
      if(!global.DT_USUARIO_ACESSO_ATUAL?.permissoes)return;
      clearTimeout(timerPermissoes);
      timerPermissoes=setTimeout(aplicarPermissoesAnalista,40);
    }).observe(document.body,{childList:true,subtree:true});
  });
  // Fase de captura (mesmo padrão usado em Gestão de Lojas): garante o clique
  // mesmo se algum outro componente interromper a propagação no bubbling.
  document.addEventListener('click',function(event){
    const botao=event.target.closest('[data-usuario-editar]');
    if(!botao)return;
    event.preventDefault();
    event.stopPropagation();
    if(typeof event.stopImmediatePropagation==='function')event.stopImmediatePropagation();
    const indice=Number(botao.getAttribute('data-usuario-editar'));
    if(Number.isInteger(indice))opEditarUsuario(indice);
  },true);

  function oplSetTab(){
    const pageOp=document.getElementById('opl-page-operadores');
    if(pageOp)pageOp.style.display='block';
    listarOperadores();
  }
  function opCarregarOperadoresParaFiltro(){const s=document.getElementById('op-rec-filtro-operador');if(s)s.innerHTML='<option value="">Selecione um operador…</option>'+usuarios.map(u=>`<option value="${esc(u.uid||u.id)}">${esc(u.nome||u.email)}</option>`).join('');}
  function opVerificarMinhaConta(){}

  // Cadastro em lote: uma ficha por pessoa; preserva sucessos em novas tentativas.
  let lotePendente=false;
  function opAdicionarPessoaLote(){
    if(lotePendente)return;const box=document.getElementById('op-lote-pessoas');if(!box)return;
    const row=document.createElement('div');row.className='op-secao';row.setAttribute('data-op-pessoa','');row.style.margin='10px 0';
    row.innerHTML='<label>Nome completo<input class="field" data-pessoa="nome" autocomplete="off"></label><label>E-mail de login<input class="field" data-pessoa="email" type="email" autocomplete="off"></label><label>E-mail de recuperação<input class="field" data-pessoa="recuperacao" type="email" list="op-emails-recuperacao" autocomplete="off"></label><label>Senha inicial<input class="field" data-pessoa="senha" type="password" autocomplete="new-password"></label><label>Setor<select class="field" data-pessoa="modelo"><option value="">Usar setor / acessos comuns abaixo</option>'+modelosAcesso.filter(m=>m.ativo!==false).map(m=>'<option value="'+esc(m.id)+'">'+esc(m.nome)+'</option>').join('')+'</select></label><div data-pessoa-status style="font-size:.8rem;margin:8px 0"></div><button type="button" class="btn btn-ghost" data-pessoa-remover>Remover pessoa</button>';
    row.querySelector('[data-pessoa-remover]').onclick=function(){if(!lotePendente)row.remove();};box.appendChild(row);
  }
  function opAbrirModalCriarLote(){
    if(lotePendente)return;
    carregarLojas().then(function(){
      document.getElementById('op-lote-pessoas').innerHTML='';preencherEmailsRecuperacao();opAdicionarPessoaLote();
      montarChecks('op-lojas-lote-lista',[]);setModo('lote',delegadoAtual()?'selecionadas':'todas');
      renderCanais('lote',delegadoAtual()?(global.DT_USUARIO_ACESSO_ATUAL.gestao_areas.canais||{}):{coletor:true,analista:false});renderSetores('lote',{});renderPermissoes('lote',{});
      const fb=document.getElementById('op-lote-feedback');if(fb)fb.textContent='';
      document.getElementById('op-modal-lote-bg').style.display='flex';
      document.querySelectorAll('input[name="op-lojas-lote-modo"]').forEach(r=>r.onchange=function(){setModo('lote',this.value);});
    });
  }
  function opFecharModalCriarLote(){if(lotePendente)return;document.getElementById('op-modal-lote-bg').style.display='none';}
  function dadosPessoa(row,comum){
    const v=k=>row.querySelector('[data-pessoa="'+k+'"]').value;
    const nome=v('nome').trim(),senha=v('senha'),logins=loginsManuais(v('email'),v('recuperacao')),modeloId=v('modelo');
    if(!nome)throw new Error('Informe o nome.');if(senha.length<6||senha.length>128)throw new Error('Senha de 6 a 128 caracteres.');
    let acesso={...comum};if(modeloId){const m=modelosAcesso.find(x=>x.id===modeloId&&x.ativo!==false);if(!m)throw new Error('Setor indisponível.');const setores={logistica:false,compras:false,pcp:false,producao:false,atendimento:false};MODULOS.forEach(mod=>{if(Object.values(m.permissoes[mod.id]||{}).some(x=>x===true))setores[mod.setor]=true;});acesso={...acesso,modeloId,canais:m.canais,setores,permissoes:normalizar(m.permissoes,false)};}
    if(!acesso.canais.analista&&!acesso.canais.coletor)throw new Error('Selecione pelo menos um canal de acesso.');
    if(acesso.canais.analista&&!MODULOS.some(m=>m.canais.includes('analista')&&acesso.permissoes[m.id]&&acesso.permissoes[m.id].visualizar))throw new Error('O setor deve liberar ao menos uma tela do Analista.');
    return {row,nome,senha,logins,comum:acesso};
  }
  async function opCriarUsuariosLote(){
    if(lotePendente||!temPermissao('operadores','criar'))return;
    const rows=[...document.querySelectorAll('#op-lote-pessoas [data-op-pessoa]')],pendentes=rows.filter(r=>r.getAttribute('data-criado')!=='true');
    const modo=(document.querySelector('input[name="op-lojas-lote-modo"]:checked')||{}).value||'selecionadas',lojas=[...document.querySelectorAll('#op-lojas-lote-lista input:checked')].map(x=>x.value);
    const comum={canais:lerCanais('lote'),setores:lerSetores('lote'),permissoes:lerPermissoes('lote'),modo,lojas,modeloId:(document.getElementById('op-modelo-lote')||{}).value||''};
    let pessoas;try{if(!pendentes.length)throw new Error('Adicione uma pessoa para cadastrar.');if(pendentes.length>50)throw new Error('Cadastre no máximo 50 pessoas por vez.');if(modo==='selecionadas'&&!lojas.length)throw new Error('Selecione ao menos uma loja.');pessoas=pendentes.map(r=>dadosPessoa(r,comum));const emails=rows.map(r=>r.querySelector('[data-pessoa="email"]').value.trim().toLowerCase());if(new Set(emails).size!==emails.length)throw new Error('Existem e-mails de login repetidos nas fichas.');}catch(e){global.showToast?.(e.message,'error');return;}
    lotePendente=true;const btn=document.getElementById('op-lote-salvar'),fb=document.getElementById('op-lote-feedback');if(btn)btn.disabled=true;
    rows.forEach(r=>r.querySelectorAll('input,select,button').forEach(e=>e.disabled=true));
    let ok=0,erros=0;
    try{for(let i=0;i<pessoas.length;i++){
      const p=pessoas[i],status=p.row.querySelector('[data-pessoa-status]');if(fb)fb.textContent='Criando '+(i+1)+' de '+pessoas.length;
      try{await opSalvarArea('lote',p.nome,p.senha,p.logins,null,p.comum);p.row.setAttribute('data-criado','true');p.row.querySelector('[data-pessoa="senha"]').value='';status.textContent='✓ Criado';ok++;}catch(e){status.textContent='Erro: '+(e.message||e);erros++;}
    }if(fb)fb.textContent=ok+' criado(s) nesta tentativa · '+erros+' com erro';if(ok)await listarOperadores();global.showToast?.(ok+' criado(s) · '+erros+' com erro',erros?'warning':'success');}
    finally{lotePendente=false;if(btn)btn.disabled=false;rows.filter(r=>r.getAttribute('data-criado')!=='true').forEach(r=>r.querySelectorAll('input,select,button').forEach(e=>e.disabled=false));}
  }

  Object.assign(global,{opAdicionarPessoaLote,opVerificarRemetente,DT_MODULOS_PERMISSOES:MODULOS,DT_PRESETS_PERMISSOES:PRESETS,DT_CATALOGO_PERMISSOES:catalogoPermissoes(),codigoPermissao,ehMasterAtual,temPermissao,moduloTemAlgumaPermissao,aplicarPermissoesAnalista,irParaPrimeiraPaginaPermitida,listarOperadores,opFiltrarLista,opEditarUsuario,opExcluirUsuario,opExcluirUsuarioAtual,opSalvarEdicao,opFecharModal,opAbrirModalCriar,opFecharModalCriar,opAbrirModalCriarLote,opFecharModalCriarLote,opCriarUsuariosLote,opSetModoLojasCriar,opSetModoLojasEditar,opGerarUsername,opGerarSenha,toggleOpSenha,toggleOpeditSenha,opValidarUsername,opValidarSenha,criarOperador,oplSetTab,opCarregarOperadoresParaFiltro,opVerificarMinhaConta,opMarcarPermissoes,opMarcarModulo,opAtualizarContagemModulo,opFiltrarPermissoes,opAbrirDiagnostico,opRessincronizarPermissoes,opAplicarPreset,opBuscarPorUid,opAtualizarCamposPapelCompras});
})(window);
