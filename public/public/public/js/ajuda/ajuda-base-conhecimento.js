
// ════════════════════════════════════════════════════════════════
//  BASE DE CONHECIMENTO — DT Inventário
// ════════════════════════════════════════════════════════════════
const AJUDA_ITENS = [

  // ── ANALISTA ────────────────────────────────────────────────

  {
    id: 'a01',
    icon: '📊',
    titulo: 'Dashboard',
    categoria: 'Analista',
    resumo: 'Visão geral em tempo real de todos os inventários, KPIs de progresso e alertas do sistema.',
    palavrasChave: ['dashboard','painel','visão geral','kpi','progresso','resumo','inicio','home'],
    conteudo: `O <strong>Dashboard</strong> é a tela inicial do Analista e exibe uma visão consolidada de todo o sistema.`,
    passos: [
      'Acesse o sistema com login de Analista.',
      'A primeira tela já é o Dashboard — sem necessidade de navegar.',
      'Use os filtros no topo para visualizar por inventário específico, rua ou local de estoque.',
      'Os KPIs mostram: inventários ativos, endereços contados/pendentes, divergências e recontagens.',
      'A seção de progresso por rua e por local mostra barras de conclusão em tempo real.',
      'O painel atualiza automaticamente quando coletores enviam contagens.',
    ],
    dicas: [
      { tipo: 'tip', texto: 'Clique em "Inventários Recentes" no Dashboard para ir direto ao gerenciamento de um inventário específico.' },
      { tipo: 'info', texto: 'O badge "🟢 Inventário Ativo" no topo da tela mostra qual inventário está selecionado para acompanhamento.' },
    ],
    relacionados: ['a02','a03','a04','a09'],
  },

  {
    id: 'a02',
    icon: '📥',
    titulo: 'Importação de Inventário',
    categoria: 'Analista',
    resumo: 'Como importar a base de endereços e itens para iniciar um novo inventário no sistema.',
    palavrasChave: ['importar','importação','upload','arquivo','excel','xlsx','csv','base','planilha','carregar','subir'],
    conteudo: `A <strong>Importação</strong> alimenta o sistema com a lista de endereços e produtos que serão contados.`,
    passos: [
      'Vá em "Importar / Exportar" no menu lateral.',
      'Clique na aba "Importar".',
      'Arraste o arquivo Excel/CSV para a zona de importação, ou clique para selecionar.',
      'O sistema validará o formato automaticamente — colunas obrigatórias: endereço, produto, quantidade esperada.',
      'Confira o preview dos dados antes de confirmar.',
      'Após a importação, crie um novo inventário clicando em "+ Novo Inventário".',
      'Vincule a base importada ao inventário criado.',
    ],
    dicas: [
      { tipo: 'warn', texto: 'Certifique-se que o arquivo não tem linhas em branco ou cabeçalhos duplicados — isso causa erros na importação.' },
      { tipo: 'tip', texto: 'O sistema aceita arquivos .xlsx e .csv com delimitador ponto-e-vírgula ou vírgula.' },
    ],
    relacionados: ['a01','a03','a08'],
  },

  {
    id: 'a03',
    icon: '📤',
    titulo: 'Exportação de Inventário',
    categoria: 'Analista',
    resumo: 'Gere relatórios e exporte os dados de contagem para Excel, CSV ou via API.',
    palavrasChave: ['exportar','exportação','download','baixar','relatório','excel','csv','resultado','dados','api','enviar'],
    conteudo: `A <strong>Exportação</strong> permite baixar os resultados do inventário ou enviá-los para sistemas externos.`,
    passos: [
      'Vá em "Importar / Exportar" no menu lateral.',
      'Clique na aba "Exportar".',
      'Selecione o inventário que deseja exportar.',
      'Escolha o formato: Excel (.xlsx), CSV, ou envio via API/Webhook.',
      'Para Excel/CSV: clique em "Exportar" e o arquivo será baixado automaticamente.',
      'Para API: configure o endpoint de destino e clique em "Enviar via API".',
      'Você pode adicionar à fila de envio para exportar depois, mesmo sem conexão.',
    ],
    dicas: [
      { tipo: 'info', texto: 'A fila de exportação fica visível na aba "Fila de Envio" — itens são enviados automaticamente quando a conexão é restaurada.' },
      { tipo: 'tip', texto: 'Use "Rel. Divergências" no menu para exportar apenas as divergências encontradas.' },
    ],
    relacionados: ['a07','a08','a01'],
  },

  {
    id: 'a04',
    icon: '🎯',
    titulo: 'Acompanhamento em Tempo Real',
    categoria: 'Analista',
    resumo: 'Monitore o progresso das contagens ao vivo, endereço por endereço, operador por operador.',
    palavrasChave: ['acompanhamento','tempo real','progresso','monitorar','monitor','live','ao vivo','situação','status'],
    conteudo: `O <strong>Acompanhamento</strong> mostra o estado atual do inventário com atualização automática.`,
    passos: [
      'Clique em "Acompanhamento" no menu lateral.',
      'Selecione o inventário ativo no seletor do topo.',
      'Os KPIs mostram: total de endereços, contados, pendentes, divergências e recontagens.',
      'A tabela abaixo lista cada endereço com seu status (pendente, contado, divergência, recontagem).',
      'Clique em qualquer endereço para ver detalhes da contagem.',
      'Use os filtros de rua e status para focar em áreas específicas.',
      'Clique em "Atualizar" para forçar sincronização imediata.',
    ],
    dicas: [
      { tipo: 'tip', texto: 'O acompanhamento atualiza automaticamente a cada vez que um coletor envia uma contagem.' },
      { tipo: 'info', texto: 'Endereços marcados em vermelho têm divergência — quantidade contada diferente da esperada.' },
    ],
    relacionados: ['a01','a05','a09'],
  },

  {
    id: 'a05',
    icon: '⚠️',
    titulo: 'Divergências',
    categoria: 'Analista',
    resumo: 'Gerencie e resolva diferenças entre a quantidade esperada e a quantidade contada.',
    palavrasChave: ['divergência','diferença','erro','quantidade','incorreta','resolver','analisar','conferir','ajuste'],
    conteudo: `Uma <strong>Divergência</strong> ocorre quando a quantidade contada é diferente da quantidade esperada para um endereço.`,
    passos: [
      'Acesse "Divergências" no menu lateral.',
      'Veja a lista de endereços com divergência — incluindo diferença de quantidade.',
      'Clique em um item para ver os detalhes: endereço, produto, esperado × contado.',
      'Decida a ação: Aceitar divergência, Solicitar recontagem ou Fazer ajuste manual.',
      'Para solicitar recontagem: clique em "Recontar" — o endereço volta para pendente no coletor.',
      'Para aceitar: clique em "Aceitar" e a divergência é encerrada.',
    ],
    dicas: [
      { tipo: 'warn', texto: 'Aceitar uma divergência é irreversível. Confirme que o dado está correto antes de aceitar.' },
      { tipo: 'tip', texto: 'Use "Rel. Divergências" para exportar um relatório completo de todas as divergências.' },
    ],
    relacionados: ['a04','a06','a01'],
  },

  {
    id: 'a06',
    icon: '🔄',
    titulo: 'Recontagens',
    categoria: 'Analista',
    resumo: 'Solicite que endereços específicos sejam recontados pelos operadores no coletor.',
    palavrasChave: ['recontagem','recontar','rever','segunda contagem','verificar novamente','pendente','devolver'],
    conteudo: `A <strong>Recontagem</strong> permite devolver um endereço para o coletor realizar uma nova contagem.`,
    passos: [
      'Acesse "Recontagens" no menu lateral para ver a fila de recontagens pendentes.',
      'Ou, a partir de "Divergências", clique em "Recontar" em qualquer item.',
      'O endereço fica marcado como "aguardando recontagem" no coletor.',
      'O operador verá o endereço na lista de pendências e realizará a nova contagem.',
      'Após a recontagem, o resultado aparece novamente no Acompanhamento.',
    ],
    dicas: [
      { tipo: 'info', texto: 'O badge "Recontagens" no menu mostra quantas estão pendentes.' },
    ],
    relacionados: ['a05','a04','c05'],
  },

  {
    id: 'a07',
    icon: '🔗',
    titulo: 'Integração / API',
    categoria: 'Analista',
    resumo: 'Envie dados de inventário para sistemas externos via webhook ou API REST.',
    palavrasChave: ['api','webhook','integração','endpoint','enviar','erp','sistema externo','url','rest','http','post','fila'],
    conteudo: `A <strong>Integração via API</strong> permite exportar os resultados do inventário diretamente para outros sistemas.`,
    passos: [
      'Acesse "Importar / Exportar" e selecione a aba "API / Webhook".',
      'Configure o endpoint de destino (URL do sistema externo).',
      'Defina o formato do payload: JSON com contagens, totais ou apenas divergências.',
      'Clique em "Enviar" para disparar imediatamente, ou "Adicionar à Fila" para enviar depois.',
      'A fila de envio pode ser gerenciada na aba "Fila de Envio".',
      'Itens na fila são enviados automaticamente quando a conexão é restaurada.',
    ],
    dicas: [
      { tipo: 'info', texto: 'A API usa método POST com JSON. Seu sistema deve responder com HTTP 200 para confirmar o recebimento.' },
      { tipo: 'warn', texto: 'Configure corretamente o endpoint antes de usar em produção. Envios incorretos não podem ser desfeitos automaticamente.' },
    ],
    relacionados: ['a03','a08'],
  },

  {
    id: 'a08',
    icon: '📜',
    titulo: 'Logs & Auditoria',
    categoria: 'Analista',
    resumo: 'Histórico completo de todas as ações realizadas no sistema — contagens, exportações, alterações.',
    palavrasChave: ['log','auditoria','histórico','rastro','ação','registro','quem fez','quando','evento','trilha'],
    conteudo: `Os <strong>Logs de Auditoria</strong> registram automaticamente cada ação realizada no sistema.`,
    passos: [
      'Acesse "Logs & Auditoria" no menu lateral.',
      'Use o campo de busca para filtrar por usuário, endereço, produto ou tipo de ação.',
      'Filtre por tipo: Inventário, Contagem, Recontagem, Divergência, Exportação, etc.',
      'Filtre por período: hoje, 7 dias, 30 dias.',
      'Clique em "Exportar" para baixar o histórico completo em CSV.',
    ],
    dicas: [
      { tipo: 'info', texto: 'Os logs são mantidos por até 1.000 registros recentes. Use a exportação periódica para manter o histórico completo.' },
    ],
    relacionados: ['a01','a05','a07'],
  },

  {
    id: 'a09',
    icon: '🏷️',
    titulo: 'Gestão de Capa Pallet',
    categoria: 'Analista',
    resumo: 'Visualize e controle os blocos de números de Capa Pallet reservados por operador.',
    palavrasChave: ['capa','pallet','palete','range','bloco','numero','7 digitos','reservar','liberar','gestão','faixa','operador'],
    conteudo: `O painel de <strong>Capa Pallet</strong> permite ao Analista visualizar e controlar os números reservados por cada operador.`,
    passos: [
      'Acesse "Capa Pallet" no menu lateral — seção Gestão.',
      'Use o filtro de inventário para ver apenas um inventário específico.',
      'O painel mostra para cada operador: range reservado, quantidade usada, saldo e status.',
      'O status pode ser: Em uso, Quase cheio, Esgotado ou Não iniciado.',
      'Para liberar um range manualmente, clique em "+ Liberar Range Manual".',
      'Informe o inventário, nome do operador e o início do range (o sistema calcula o fim).',
      'O histórico de alocações mostra todos os blocos reservados — automáticos e manuais.',
    ],
    dicas: [
      { tipo: 'info', texto: 'Cada operador recebe automaticamente um bloco de 200 números quando acessa o inventário pelo coletor pela primeira vez.' },
      { tipo: 'warn', texto: 'Ao liberar range manualmente, certifique-se que o início não conflita com ranges já existentes — o sistema valida isso automaticamente.' },
      { tipo: 'tip', texto: 'Use "Exportar" no histórico para ter uma trilha auditável de todos os ranges alocados.' },
    ],
    relacionados: ['c04','c05','a08'],
  },

  {
    id: 'a10',
    icon: '📋',
    titulo: 'Progresso de Contagem',
    categoria: 'Analista',
    resumo: 'Acompanhe o andamento do inventário por rua, local de estoque e por operador.',
    palavrasChave: ['progresso','porcentagem','conclusão','andamento','rua','local','operador','produtividade','quanto falta','avançar'],
    conteudo: `O <strong>Progresso de Contagem</strong> é visível no Dashboard e na tela de Acompanhamento.`,
    passos: [
      'No Dashboard, veja a seção "Progresso por Rua" e "Progresso por Local de Estoque".',
      'Cada barra mostra: endereços contados / total e porcentagem de conclusão.',
      'Em "Acompanhamento", os KPIs mostram o total geral de conclusão do inventário.',
      'Em "Produtividade", veja o desempenho por operador — quantidade contada, tempo médio.',
      'Use os filtros de rua e local para identificar onde há mais pendências.',
    ],
    dicas: [
      { tipo: 'tip', texto: 'A barra fica verde quando o progresso ultrapassa 80%, e vermelha em áreas com muita divergência.' },
    ],
    relacionados: ['a01','a04','a05'],
  },

  {
    id: 'a11',
    icon: '🔑',
    titulo: 'Controle de Operadores',
    categoria: 'Analista',
    resumo: 'Crie, edite e gerencie os acessos dos operadores ao sistema de coleta.',
    palavrasChave: ['operador','usuário','login','senha','criar','cadastrar','acesso','coletor','credencial','conta'],
    conteudo: `A tela de <strong>Operadores</strong> permite ao Analista gerenciar quem tem acesso ao sistema de coleta.`,
    passos: [
      'Acesse "Operadores" no menu lateral.',
      'Clique em "+ Criar Usuário" para criar um novo operador.',
      'Informe nome completo e login (formato: nome.sobrenome).',
      'Gere uma senha automática ou informe uma manualmente (mínimo 6 caracteres).',
      'Clique em "✓ Criar" — o operador já pode logar no coletor.',
      'Para editar um operador existente, clique no ícone de edição na lista.',
      'Para redefinir a senha, abra o modal de edição e informe a nova senha.',
    ],
    dicas: [
      { tipo: 'warn', texto: 'Anote a senha antes de criar o operador — ela não é exibida novamente após o cadastro.' },
      { tipo: 'info', texto: 'O login do operador é o e-mail completo: nome.sobrenome@daterrinhaalimentos.com.br' },
    ],
    relacionados: ['a01','c01'],
  },

  // ── COLETOR ─────────────────────────────────────────────────

  {
    id: 'c01',
    icon: '👤',
    titulo: 'Login do Operador no Coletor',
    categoria: 'Coletor',
    resumo: 'Como fazer login no aplicativo coletor para iniciar a contagem de inventário.',
    palavrasChave: ['login','entrar','acessar','senha','usuário','autenticar','coletor','operador','início','abrir'],
    conteudo: `O <strong>Login</strong> identifica o operador e conecta o coletor ao inventário ativo.`,
    passos: [
      'Abra o aplicativo coletor (coletor.html) no dispositivo.',
      'Informe o login no formato: nome.sobrenome@daterrinhaalimentos.com.br',
      'Digite a senha fornecida pelo Analista.',
      'Clique em "Entrar".',
      'O sistema conecta ao Firebase e carrega o inventário ativo automaticamente.',
      'Se aparecer uma tela de seleção de inventário, escolha o inventário desejado.',
    ],
    dicas: [
      { tipo: 'info', texto: 'Se o login falhar, verifique com o Analista se sua conta foi criada e se a senha está correta.' },
      { tipo: 'warn', texto: 'Não compartilhe sua senha com outros operadores — cada operador deve ter seu próprio acesso.' },
    ],
    relacionados: ['c02','c03','a11'],
  },

  {
    id: 'c02',
    icon: '📥',
    titulo: 'Download do Inventário no Coletor',
    categoria: 'Coletor',
    resumo: 'Baixe a base de dados do inventário para o dispositivo antes de começar a contar.',
    palavrasChave: ['download','baixar','carregar','sincronizar','base','dados','inventário','preparar','offline','iniciar'],
    conteudo: `O <strong>Download do Inventário</strong> carrega a base de endereços e produtos para o dispositivo, permitindo uso offline.`,
    passos: [
      'Após o login, o coletor verificará automaticamente se há um inventário ativo.',
      'Se sim, aparecerá a opção "Baixar Inventário" — clique para iniciar.',
      'Aguarde o carregamento completo (a barra de progresso indica o andamento).',
      'Após o download, os dados ficam salvos no dispositivo para uso offline.',
      'A lista de endereços/locais para contar aparece na tela principal.',
    ],
    dicas: [
      { tipo: 'warn', texto: 'Faça o download com conexão estável. Se cair durante o download, tente novamente.' },
      { tipo: 'tip', texto: 'Após o download, o coletor funciona mesmo sem internet — as contagens são salvas e enviadas depois.' },
    ],
    relacionados: ['c01','c03','c08'],
  },

  {
    id: 'c03',
    icon: '📋',
    titulo: 'Contagem de Endereço',
    categoria: 'Coletor',
    resumo: 'Como realizar a contagem de um endereço de estoque no aplicativo coletor.',
    palavrasChave: ['contar','contagem','endereço','local','produto','quantidade','registrar','lançar','confirmar'],
    conteudo: `A <strong>Contagem</strong> é a ação principal do coletor — registrar o que foi encontrado em cada endereço.`,
    passos: [
      'Na tela principal, selecione o endereço a ser contado (ou escaneie o QR Code do local).',
      'O sistema mostrará os produtos esperados naquele endereço.',
      'Para cada produto, informe a quantidade encontrada.',
      'Se houver Capa Pallet, preencha o número de 7 dígitos (veja o tópico Capa Pallet).',
      'Revise os dados e clique em "Confirmar Contagem".',
      'O sistema tenta enviar imediatamente — se offline, salva e envia depois.',
    ],
    dicas: [
      { tipo: 'tip', texto: 'Confirme a contagem assim que terminar cada endereço para evitar perda de dados.' },
      { tipo: 'info', texto: 'Endereços contados ficam marcados em verde na lista — assim você sabe o que já foi feito.' },
    ],
    relacionados: ['c04','c05','c07'],
  },

  {
    id: 'c04',
    icon: '🏷️',
    titulo: 'Criação de Capa Pallet no Coletor',
    categoria: 'Coletor',
    resumo: 'Como gerar automaticamente o número de Capa Pallet durante a contagem.',
    palavrasChave: ['capa','pallet','palete','criar','gerar','número','7 dígitos','reservar','range','automático','faixa'],
    conteudo: `O <strong>Capa Pallet</strong> é um número de 7 dígitos que identifica cada palete contado. O coletor reserva automaticamente uma faixa de 200 números para cada operador.`,
    passos: [
      'Durante a contagem de um endereço, localize o campo "Capa Pallet".',
      'Clique no botão ⚡ (raio) ao lado do campo para gerar automaticamente.',
      'O sistema verificará sua faixa reservada no servidor e preencherá o próximo número disponível.',
      'Se for seu primeiro uso neste inventário, o sistema reserva automaticamente uma faixa de 200 números.',
      'Após gerar, confirme se o número está correto e prossiga com a contagem.',
    ],
    dicas: [
      { tipo: 'info', texto: 'Cada operador recebe uma faixa exclusiva — não há risco de dois operadores usarem o mesmo número.' },
      { tipo: 'warn', texto: 'Se a faixa esgotar (200 capas usadas), entre em contato com o Analista para liberar uma nova faixa.' },
    ],
    relacionados: ['c05','a09','c03'],
  },

  {
    id: 'c05',
    icon: '✅',
    titulo: 'Validação de Capa Pallet',
    categoria: 'Coletor',
    resumo: 'Como o sistema valida o número de Capa Pallet e o que fazer se aparecer erro.',
    palavrasChave: ['validar','validação','capa','pallet','erro','inválido','repetido','duplicado','7 dígitos','formato','já usada'],
    conteudo: `A <strong>Validação de Capa Pallet</strong> garante que cada número seja único e esteja no formato correto.`,
    passos: [
      'Ao digitar manualmente um número de Capa Pallet, o campo aceita apenas dígitos.',
      'O número deve ter exatamente 7 dígitos (ex: 1000001).',
      'Se o número estiver fora da sua faixa reservada, um erro é exibido.',
      'Se o número já foi usado nesta sessão ou no banco de dados, um erro de duplicata é exibido.',
      'Corrija o número ou use o botão ⚡ para gerar automaticamente o próximo disponível.',
    ],
    dicas: [
      { tipo: 'warn', texto: 'Não tente adivinhar ou inventar números de Capa Pallet — use sempre o botão ⚡ para garantir um número válido e único.' },
      { tipo: 'info', texto: 'Mensagem "Capa Pallet já utilizada" indica número duplicado. Use ⚡ para obter o próximo livre.' },
    ],
    relacionados: ['c04','a09','c03'],
  },

  {
    id: 'c06',
    icon: '↩️',
    titulo: 'Estorno de Contagem',
    categoria: 'Coletor',
    resumo: 'Como corrigir ou desfazer uma contagem realizada incorretamente.',
    palavrasChave: ['estorno','corrigir','desfazer','recontar','erro','cancelar','contagem errada','voltar','excluir contagem'],
    conteudo: `O <strong>Estorno</strong> permite desfazer uma contagem realizada com erro, liberando o endereço para nova contagem.`,
    passos: [
      'Na lista de contagens realizadas, localize a contagem com erro.',
      'Toque e segure (ou clique no ícone de ação) para abrir as opções.',
      'Selecione "Estornar Contagem".',
      'Confirme a ação — o endereço volta para pendente.',
      'Realize a contagem correta normalmente.',
    ],
    dicas: [
      { tipo: 'warn', texto: 'O estorno só é possível enquanto o inventário está ativo. Após fechamento, contate o Analista.' },
      { tipo: 'info', texto: 'O Analista também pode solicitar recontagem de qualquer endereço pelo painel — o efeito é similar ao estorno.' },
    ],
    relacionados: ['c03','a06','a05'],
  },

  {
    id: 'c07',
    icon: '🔄',
    titulo: 'Sincronização de Contagens',
    categoria: 'Coletor',
    resumo: 'Como as contagens são enviadas para o sistema e o que fazer se o envio falhar.',
    palavrasChave: ['sincronizar','sync','enviar','upload','fila','pendente','conectar','transmitir','salvar','internet'],
    conteudo: `A <strong>Sincronização</strong> envia as contagens realizadas no coletor para o servidor em tempo real.`,
    passos: [
      'Após confirmar uma contagem, o coletor tenta enviar imediatamente via Firebase.',
      'Se houver conexão, o envio é instantâneo e a contagem aparece no painel do Analista.',
      'Se estiver offline, a contagem é salva localmente (fila offline).',
      'A fila offline é exibida no topo do coletor com o número de itens pendentes.',
      'Assim que a conexão for restaurada, o envio automático é acionado.',
      'Você pode forçar o envio clicando no botão "🔄 Sincronizar" ou "Reenviar Pendentes".',
    ],
    dicas: [
      { tipo: 'tip', texto: 'Sincronize ao final do dia ou ao sair da área de estoque — garante que todos os dados sejam enviados.' },
      { tipo: 'info', texto: 'Contagens na fila offline ficam seguras no dispositivo e não são perdidas mesmo que o app seja fechado.' },
    ],
    relacionados: ['c08','c02','c03'],
  },

  {
    id: 'c08',
    icon: '📡',
    titulo: 'Funcionamento Offline',
    categoria: 'Coletor',
    resumo: 'Use o coletor sem internet — entenda como funciona o modo offline e suas limitações.',
    palavrasChave: ['offline','sem internet','conexão','rede','funcionar sem wifi','sem sinal','modo local','cache','fila'],
    conteudo: `O coletor foi projetado para funcionar <strong>sem conexão com a internet</strong> durante a coleta.`,
    passos: [
      'Faça o download do inventário enquanto estiver com internet (obrigatório).',
      'Após o download, o app funciona normalmente mesmo sem conexão.',
      'Realize as contagens normalmente — elas ficam salvas no dispositivo.',
      'O ícone de status no topo mostra se está "Online" ou "Offline".',
      'Ao reconectar, as contagens pendentes são enviadas automaticamente.',
      'Para o Capa Pallet: o botão ⚡ funciona offline usando o range já reservado localmente.',
    ],
    dicas: [
      { tipo: 'warn', texto: 'O range de Capa Pallet precisa de conexão para ser reservado pela primeira vez. Reserve antes de ir para área sem internet.' },
      { tipo: 'warn', texto: 'Não feche o navegador/app por longos períodos em modo offline sem sincronizar — dados podem ser perdidos se o armazenamento local for limpo.' },
      { tipo: 'tip', texto: 'Adicione o coletor à tela inicial do celular como PWA — ele fica disponível mesmo sem abrir o navegador.' },
    ],
    relacionados: ['c07','c02','c04'],
  },

];

// ════════════════════════════════════════════════════════════════
//  ENGINE DE BUSCA — fuzzy matching com normalização
// ════════════════════════════════════════════════════════════════

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calcula score de relevância para um item dado um conjunto de tokens de busca
function calcScore(item, tokens) {
  if (!tokens.length) return 1;
  const fields = [
    normalize(item.titulo)      + ' ',
    normalize(item.resumo)      + ' ',
    normalize(item.conteudo)    + ' ',
    normalize(item.categoria)   + ' ',
    (item.palavrasChave || []).map(normalize).join(' ') + ' ',
    (item.passos        || []).map(normalize).join(' ') + ' ',
  ].join('');

  let score = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    // Título bate = muito alto
    if (normalize(item.titulo).includes(tok)) score += 10;
    // Palavra-chave exata = alto
    if ((item.palavrasChave || []).some(k => normalize(k) === tok)) score += 8;
    // Palavra-chave parcial = médio
    if ((item.palavrasChave || []).some(k => normalize(k).includes(tok))) score += 5;
    // Qualquer campo = baixo
    if (fields.includes(tok)) score += 2;
    // Primeira parte do título (prefixo)
    if (normalize(item.titulo).startsWith(tok)) score += 4;
  }
  return score;
}

// Estado global
let catAtual = 'todos';
let buscaAtual = '';

function buscarAjuda(valor) {
  buscaAtual = normalize(valor);
  renderResultados();
}

function filtrarCat(cat, el) {
  catAtual = cat;
  document.querySelectorAll('.cat-tab').forEach(t => {
    t.classList.remove('on','on-orange');
  });
  if (cat === 'Coletor') el.classList.add('on-orange');
  else el.classList.add('on');
  renderResultados();
}

function renderResultados() {
  const tokens = buscaAtual.split(' ').filter(t => t.length >= 2);
  const temBusca = tokens.length > 0;

  let itens = AJUDA_ITENS;

  // Filtrar por categoria
  if (catAtual !== 'todos') {
    itens = itens.filter(i => i.categoria === catAtual);
  }

  // Filtrar + ordenar por relevância se houver busca
  if (temBusca) {
    itens = itens
      .map(i => ({ ...i, _score: calcScore(i, tokens) }))
      .filter(i => i._score > 0)
      .sort((a, b) => b._score - a._score);
  }

  const wrap = document.getElementById('resultados-wrap');
  const emptyEl = document.getElementById('empty-busca');

  if (!itens.length) {
    wrap.innerHTML = '';
    emptyEl.classList.add('show');
    return;
  }
  emptyEl.classList.remove('show');

  if (temBusca) {
    // Modo busca: tudo em uma grade
    wrap.innerHTML = `
      <div class="sec-title">Resultados para "${buscaAtual.slice(0,40)}" — ${itens.length} encontrado(s)</div>
      <div class="cards-grid">${itens.map(i => renderCard(i, tokens)).join('')}</div>`;
  } else {
    // Modo navegação: separar por categoria
    const analista = itens.filter(i => i.categoria === 'Analista');
    const coletor  = itens.filter(i => i.categoria === 'Coletor');
    let html = '';
    if (analista.length) {
      html += `<div class="sec-title">🖥️ Analista — ${analista.length} tópicos</div>
               <div class="cards-grid">${analista.map(i => renderCard(i, [])).join('')}</div>`;
    }
    if (coletor.length) {
      html += `<div class="sec-title">📱 Coletor — ${coletor.length} tópicos</div>
               <div class="cards-grid">${coletor.map(i => renderCard(i, [])).join('')}</div>`;
    }
    wrap.innerHTML = html;
  }

  // Atualizar badges das tabs
  const total = AJUDA_ITENS.length;
  const nA    = AJUDA_ITENS.filter(i => i.categoria === 'Analista').length;
  const nC    = AJUDA_ITENS.filter(i => i.categoria === 'Coletor').length;
  document.getElementById('ct-todos').textContent    = total;
  document.getElementById('ct-analista').textContent = nA;
  document.getElementById('ct-coletor').textContent  = nC;
}

function highlight(text, tokens) {
  if (!tokens || !tokens.length) return text;
  let result = text;
  for (const tok of tokens) {
    if (!tok || tok.length < 2) continue;
    // Case-insensitive highlight, preservando acentos originais
    const regex = new RegExp(`(${tok})`, 'gi');
    result = result.replace(regex, '<span class="hl">$1</span>');
  }
  return result;
}

function renderCard(item, tokens) {
  const cls = item.categoria === 'Analista' ? 'cat-analista' : 'cat-coletor';
  const tituloHL = highlight(item.titulo, tokens);
  const resumoHL = highlight(item.resumo, tokens);
  const tags = (item.palavrasChave || []).slice(0, 4)
    .map(t => `<span class="card-tag">${t}</span>`).join('');
  return `
    <div class="card ${cls}" onclick="abrirDetalhe('${item.id}')">
      <div class="card-top">
        <div class="card-icon">${item.icon}</div>
        <span class="card-badge">${item.categoria}</span>
      </div>
      <div class="card-title">${tituloHL}</div>
      <div class="card-desc">${resumoHL}</div>
      <div class="card-tags">${tags}</div>
    </div>`;
}

// ── Modal de detalhe ────────────────────────────────────────────

function abrirDetalhe(id) {
  const item = AJUDA_ITENS.find(i => i.id === id);
  if (!item) return;

  const cls = item.categoria === 'Analista' ? 'cat-analista' : 'cat-coletor';
  const iconBg = item.categoria === 'Analista' ? 'rgba(20,82,46,.2)' : 'rgba(232,117,26,.15)';

  // Passos
  const passosHtml = item.passos && item.passos.length
    ? `<div class="modal-section">
        <div class="modal-section-title">📋 Passo a passo</div>
        <ol class="modal-steps">
          ${item.passos.map((p, i) => `<li><span class="step-num">${i+1}</span><span>${p}</span></li>`).join('')}
        </ol>
      </div>` : '';

  // Dicas
  const dicasHtml = item.dicas && item.dicas.length
    ? `<div class="modal-section">
        <div class="modal-section-title">💡 Dicas e atenções</div>
        ${item.dicas.map(d => `<div class="modal-alert ${d.tipo}" style="margin-bottom:8px">${
          d.tipo === 'tip' ? '✅' : d.tipo === 'warn' ? '⚠️' : 'ℹ️'
        } ${d.texto}</div>`).join('')}
      </div>` : '';

  // Relacionados
  const rels = (item.relacionados || [])
    .map(rid => AJUDA_ITENS.find(i => i.id === rid))
    .filter(Boolean);
  const relHtml = rels.length
    ? `<div class="modal-section">
        <div class="modal-section-title">🔗 Tópicos relacionados</div>
        <div class="related-grid">
          ${rels.map(r => `
            <div class="related-item" onclick="abrirDetalhe('${r.id}')">
              <span class="related-icon">${r.icon}</span>
              <div>
                <div class="related-txt">${r.titulo}</div>
                <div style="font-size:.65rem;color:var(--muted2);margin-top:1px">${r.categoria}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>` : '';

  const modal = document.getElementById('modal-detalhe');
  modal.className = `modal ${cls}`;
  modal.innerHTML = `
    <div class="modal-hero">
      <div class="modal-hero-top">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="modal-icon">${item.icon}</div>
          <div>
            <div class="modal-title">${item.titulo}</div>
            <span class="modal-cat-badge">${item.categoria}</span>
          </div>
        </div>
        <button class="modal-close" onclick="fecharModal()">✕</button>
      </div>
      <p style="font-size:.82rem;color:var(--text2);margin-top:10px;line-height:1.6">${item.resumo}</p>
    </div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-section-title">📖 Sobre este tópico</div>
        <div class="modal-content"><p>${item.conteudo}</p></div>
      </div>
      ${passosHtml}
      ${dicasHtml}
      ${relHtml}
    </div>`;

  document.getElementById('modal-bg').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  document.getElementById('modal-bg').classList.remove('open');
  document.body.style.overflow = '';
}

// Fechar com ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') fecharModal();
});

// Back to top
window.addEventListener('scroll', () => {
  const btn = document.getElementById('back-top');
  if (window.scrollY > 300) btn.classList.add('show');
  else btn.classList.remove('show');
});

// Init
renderResultados();
