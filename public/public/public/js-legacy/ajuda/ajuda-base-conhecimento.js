var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
// ════════════════════════════════════════════════════════════════
//  BASE DE CONHECIMENTO — DT Inventário
// ════════════════════════════════════════════════════════════════
var AJUDA_ITENS = [
    // ── ANALISTA ────────────────────────────────────────────────
    {
        id: 'a01',
        icon: '📊',
        titulo: 'Dashboard',
        categoria: 'Analista',
        resumo: 'Visão geral em tempo real de todos os inventários, KPIs de progresso e alertas do sistema.',
        palavrasChave: ['dashboard', 'painel', 'visão geral', 'kpi', 'progresso', 'resumo', 'inicio', 'home'],
        conteudo: "O <strong>Dashboard</strong> \u00E9 a tela inicial do Analista e exibe uma vis\u00E3o consolidada de todo o sistema.",
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
        relacionados: ['a02', 'a03', 'a04', 'a09'],
    },
    {
        id: 'a02',
        icon: '📥',
        titulo: 'Importação de Inventário',
        categoria: 'Analista',
        resumo: 'Como importar a base de endereços e itens para iniciar um novo inventário no sistema.',
        palavrasChave: ['importar', 'importação', 'upload', 'arquivo', 'excel', 'xlsx', 'csv', 'base', 'planilha', 'carregar', 'subir'],
        conteudo: "A <strong>Importa\u00E7\u00E3o</strong> alimenta o sistema com a lista de endere\u00E7os e produtos que ser\u00E3o contados.",
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
        relacionados: ['a01', 'a03', 'a08'],
    },
    {
        id: 'a03',
        icon: '📤',
        titulo: 'Exportação de Inventário',
        categoria: 'Analista',
        resumo: 'Gere relatórios e exporte os dados de contagem para Excel, CSV ou via API.',
        palavrasChave: ['exportar', 'exportação', 'download', 'baixar', 'relatório', 'excel', 'csv', 'resultado', 'dados', 'api', 'enviar'],
        conteudo: "A <strong>Exporta\u00E7\u00E3o</strong> permite baixar os resultados do invent\u00E1rio ou envi\u00E1-los para sistemas externos.",
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
        relacionados: ['a07', 'a08', 'a01'],
    },
    {
        id: 'a04',
        icon: '🎯',
        titulo: 'Acompanhamento em Tempo Real',
        categoria: 'Analista',
        resumo: 'Monitore o progresso das contagens ao vivo, endereço por endereço, operador por operador.',
        palavrasChave: ['acompanhamento', 'tempo real', 'progresso', 'monitorar', 'monitor', 'live', 'ao vivo', 'situação', 'status'],
        conteudo: "O <strong>Acompanhamento</strong> mostra o estado atual do invent\u00E1rio com atualiza\u00E7\u00E3o autom\u00E1tica.",
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
        relacionados: ['a01', 'a05', 'a09'],
    },
    {
        id: 'a05',
        icon: '⚠️',
        titulo: 'Divergências',
        categoria: 'Analista',
        resumo: 'Gerencie e resolva diferenças entre a quantidade esperada e a quantidade contada.',
        palavrasChave: ['divergência', 'diferença', 'erro', 'quantidade', 'incorreta', 'resolver', 'analisar', 'conferir', 'ajuste'],
        conteudo: "Uma <strong>Diverg\u00EAncia</strong> ocorre quando a quantidade contada \u00E9 diferente da quantidade esperada para um endere\u00E7o.",
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
        relacionados: ['a04', 'a06', 'a01'],
    },
    {
        id: 'a06',
        icon: '🔄',
        titulo: 'Recontagens',
        categoria: 'Analista',
        resumo: 'Solicite que endereços específicos sejam recontados pelos operadores no coletor.',
        palavrasChave: ['recontagem', 'recontar', 'rever', 'segunda contagem', 'verificar novamente', 'pendente', 'devolver'],
        conteudo: "A <strong>Recontagem</strong> permite devolver um endere\u00E7o para o coletor realizar uma nova contagem.",
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
        relacionados: ['a05', 'a04', 'c05'],
    },
    {
        id: 'a07',
        icon: '🔗',
        titulo: 'Integração / API',
        categoria: 'Analista',
        resumo: 'Envie dados de inventário para sistemas externos via webhook ou API REST.',
        palavrasChave: ['api', 'webhook', 'integração', 'endpoint', 'enviar', 'erp', 'sistema externo', 'url', 'rest', 'http', 'post', 'fila'],
        conteudo: "A <strong>Integra\u00E7\u00E3o via API</strong> permite exportar os resultados do invent\u00E1rio diretamente para outros sistemas.",
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
        relacionados: ['a03', 'a08'],
    },
    {
        id: 'a08',
        icon: '📜',
        titulo: 'Logs & Auditoria',
        categoria: 'Analista',
        resumo: 'Histórico completo de todas as ações realizadas no sistema — contagens, exportações, alterações.',
        palavrasChave: ['log', 'auditoria', 'histórico', 'rastro', 'ação', 'registro', 'quem fez', 'quando', 'evento', 'trilha'],
        conteudo: "Os <strong>Logs de Auditoria</strong> registram automaticamente cada a\u00E7\u00E3o realizada no sistema.",
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
        relacionados: ['a01', 'a05', 'a07'],
    },
    {
        id: 'a09',
        icon: '🏷️',
        titulo: 'Gestão de Capa Pallet',
        categoria: 'Analista',
        resumo: 'Visualize e controle os blocos de números de Capa Pallet reservados por operador.',
        palavrasChave: ['capa', 'pallet', 'palete', 'range', 'bloco', 'numero', '7 digitos', 'reservar', 'liberar', 'gestão', 'faixa', 'operador'],
        conteudo: "O painel de <strong>Capa Pallet</strong> permite ao Analista visualizar e controlar os n\u00FAmeros reservados por cada operador.",
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
        relacionados: ['c04', 'c05', 'a08'],
    },
    {
        id: 'a10',
        icon: '📋',
        titulo: 'Progresso de Contagem',
        categoria: 'Analista',
        resumo: 'Acompanhe o andamento do inventário por rua, local de estoque e por operador.',
        palavrasChave: ['progresso', 'porcentagem', 'conclusão', 'andamento', 'rua', 'local', 'operador', 'produtividade', 'quanto falta', 'avançar'],
        conteudo: "O <strong>Progresso de Contagem</strong> \u00E9 vis\u00EDvel no Dashboard e na tela de Acompanhamento.",
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
        relacionados: ['a01', 'a04', 'a05'],
    },
    {
        id: 'a11',
        icon: '🔑',
        titulo: 'Controle de Operadores',
        categoria: 'Analista',
        resumo: 'Crie, edite e gerencie os acessos dos operadores ao sistema de coleta.',
        palavrasChave: ['operador', 'usuário', 'login', 'senha', 'criar', 'cadastrar', 'acesso', 'coletor', 'credencial', 'conta'],
        conteudo: "A tela de <strong>Operadores</strong> permite ao Analista gerenciar quem tem acesso ao sistema de coleta.",
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
        relacionados: ['a01', 'c01'],
    },
    // ── COLETOR ─────────────────────────────────────────────────
    {
        id: 'c01',
        icon: '👤',
        titulo: 'Login do Operador no Coletor',
        categoria: 'Coletor',
        resumo: 'Como fazer login no aplicativo coletor para iniciar a contagem de inventário.',
        palavrasChave: ['login', 'entrar', 'acessar', 'senha', 'usuário', 'autenticar', 'coletor', 'operador', 'início', 'abrir'],
        conteudo: "O <strong>Login</strong> identifica o operador e conecta o coletor ao invent\u00E1rio ativo.",
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
        relacionados: ['c02', 'c03', 'a11'],
    },
    {
        id: 'c02',
        icon: '📥',
        titulo: 'Download do Inventário no Coletor',
        categoria: 'Coletor',
        resumo: 'Baixe a base de dados do inventário para o dispositivo antes de começar a contar.',
        palavrasChave: ['download', 'baixar', 'carregar', 'sincronizar', 'base', 'dados', 'inventário', 'preparar', 'offline', 'iniciar'],
        conteudo: "O <strong>Download do Invent\u00E1rio</strong> carrega a base de endere\u00E7os e produtos para o dispositivo, permitindo uso offline.",
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
        relacionados: ['c01', 'c03', 'c08'],
    },
    {
        id: 'c03',
        icon: '📋',
        titulo: 'Contagem de Endereço',
        categoria: 'Coletor',
        resumo: 'Como realizar a contagem de um endereço de estoque no aplicativo coletor.',
        palavrasChave: ['contar', 'contagem', 'endereço', 'local', 'produto', 'quantidade', 'registrar', 'lançar', 'confirmar'],
        conteudo: "A <strong>Contagem</strong> \u00E9 a a\u00E7\u00E3o principal do coletor \u2014 registrar o que foi encontrado em cada endere\u00E7o.",
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
        relacionados: ['c04', 'c05', 'c07'],
    },
    {
        id: 'c04',
        icon: '🏷️',
        titulo: 'Criação de Capa Pallet no Coletor',
        categoria: 'Coletor',
        resumo: 'Como gerar automaticamente o número de Capa Pallet durante a contagem.',
        palavrasChave: ['capa', 'pallet', 'palete', 'criar', 'gerar', 'número', '7 dígitos', 'reservar', 'range', 'automático', 'faixa'],
        conteudo: "O <strong>Capa Pallet</strong> \u00E9 um n\u00FAmero de 7 d\u00EDgitos que identifica cada palete contado. O coletor reserva automaticamente uma faixa de 200 n\u00FAmeros para cada operador.",
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
        relacionados: ['c05', 'a09', 'c03'],
    },
    {
        id: 'c05',
        icon: '✅',
        titulo: 'Validação de Capa Pallet',
        categoria: 'Coletor',
        resumo: 'Como o sistema valida o número de Capa Pallet e o que fazer se aparecer erro.',
        palavrasChave: ['validar', 'validação', 'capa', 'pallet', 'erro', 'inválido', 'repetido', 'duplicado', '7 dígitos', 'formato', 'já usada'],
        conteudo: "A <strong>Valida\u00E7\u00E3o de Capa Pallet</strong> garante que cada n\u00FAmero seja \u00FAnico e esteja no formato correto.",
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
        relacionados: ['c04', 'a09', 'c03'],
    },
    {
        id: 'c06',
        icon: '↩️',
        titulo: 'Estorno de Contagem',
        categoria: 'Coletor',
        resumo: 'Como corrigir ou desfazer uma contagem realizada incorretamente.',
        palavrasChave: ['estorno', 'corrigir', 'desfazer', 'recontar', 'erro', 'cancelar', 'contagem errada', 'voltar', 'excluir contagem'],
        conteudo: "O <strong>Estorno</strong> permite desfazer uma contagem realizada com erro, liberando o endere\u00E7o para nova contagem.",
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
        relacionados: ['c03', 'a06', 'a05'],
    },
    {
        id: 'c07',
        icon: '🔄',
        titulo: 'Sincronização de Contagens',
        categoria: 'Coletor',
        resumo: 'Como as contagens são enviadas para o sistema e o que fazer se o envio falhar.',
        palavrasChave: ['sincronizar', 'sync', 'enviar', 'upload', 'fila', 'pendente', 'conectar', 'transmitir', 'salvar', 'internet'],
        conteudo: "A <strong>Sincroniza\u00E7\u00E3o</strong> envia as contagens realizadas no coletor para o servidor em tempo real.",
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
        relacionados: ['c08', 'c02', 'c03'],
    },
    {
        id: 'c08',
        icon: '📡',
        titulo: 'Funcionamento Offline',
        categoria: 'Coletor',
        resumo: 'Use o coletor sem internet — entenda como funciona o modo offline e suas limitações.',
        palavrasChave: ['offline', 'sem internet', 'conexão', 'rede', 'funcionar sem wifi', 'sem sinal', 'modo local', 'cache', 'fila'],
        conteudo: "O coletor foi projetado para funcionar <strong>sem conex\u00E3o com a internet</strong> durante a coleta.",
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
        relacionados: ['c07', 'c02', 'c04'],
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
    if (!tokens.length)
        return 1;
    var fields = [
        normalize(item.titulo) + ' ',
        normalize(item.resumo) + ' ',
        normalize(item.conteudo) + ' ',
        normalize(item.categoria) + ' ',
        (item.palavrasChave || []).map(normalize).join(' ') + ' ',
        (item.passos || []).map(normalize).join(' ') + ' ',
    ].join('');
    var score = 0;
    var _loop_1 = function (tok) {
        if (!tok)
            return "continue";
        // Título bate = muito alto
        if (normalize(item.titulo).includes(tok))
            score += 10;
        // Palavra-chave exata = alto
        if ((item.palavrasChave || []).some(function (k) { return normalize(k) === tok; }))
            score += 8;
        // Palavra-chave parcial = médio
        if ((item.palavrasChave || []).some(function (k) { return normalize(k).includes(tok); }))
            score += 5;
        // Qualquer campo = baixo
        if (fields.includes(tok))
            score += 2;
        // Primeira parte do título (prefixo)
        if (normalize(item.titulo).startsWith(tok))
            score += 4;
    };
    for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
        var tok = tokens_1[_i];
        _loop_1(tok);
    }
    return score;
}
// Estado global
var catAtual = 'todos';
var buscaAtual = '';
function buscarAjuda(valor) {
    buscaAtual = normalize(valor);
    renderResultados();
}
function filtrarCat(cat, el) {
    catAtual = cat;
    document.querySelectorAll('.cat-tab').forEach(function (t) {
        t.classList.remove('on', 'on-orange');
    });
    if (cat === 'Coletor')
        el.classList.add('on-orange');
    else
        el.classList.add('on');
    renderResultados();
}
function renderResultados() {
    var tokens = buscaAtual.split(' ').filter(function (t) { return t.length >= 2; });
    var temBusca = tokens.length > 0;
    var itens = AJUDA_ITENS;
    // Filtrar por categoria
    if (catAtual !== 'todos') {
        itens = itens.filter(function (i) { return i.categoria === catAtual; });
    }
    // Filtrar + ordenar por relevância se houver busca
    if (temBusca) {
        itens = itens
            .map(function (i) { return (__assign(__assign({}, i), { _score: calcScore(i, tokens) })); })
            .filter(function (i) { return i._score > 0; })
            .sort(function (a, b) { return b._score - a._score; });
    }
    var wrap = document.getElementById('resultados-wrap');
    var emptyEl = document.getElementById('empty-busca');
    if (!itens.length) {
        wrap.innerHTML = '';
        emptyEl.classList.add('show');
        return;
    }
    emptyEl.classList.remove('show');
    if (temBusca) {
        // Modo busca: tudo em uma grade
        wrap.innerHTML = "\n      <div class=\"sec-title\">Resultados para \"".concat(buscaAtual.slice(0, 40), "\" \u2014 ").concat(itens.length, " encontrado(s)</div>\n      <div class=\"cards-grid\">").concat(itens.map(function (i) { return renderCard(i, tokens); }).join(''), "</div>");
    }
    else {
        // Modo navegação: separar por categoria
        var analista = itens.filter(function (i) { return i.categoria === 'Analista'; });
        var coletor = itens.filter(function (i) { return i.categoria === 'Coletor'; });
        var html = '';
        if (analista.length) {
            html += "<div class=\"sec-title\">\uD83D\uDDA5\uFE0F Analista \u2014 ".concat(analista.length, " t\u00F3picos</div>\n               <div class=\"cards-grid\">").concat(analista.map(function (i) { return renderCard(i, []); }).join(''), "</div>");
        }
        if (coletor.length) {
            html += "<div class=\"sec-title\">\uD83D\uDCF1 Coletor \u2014 ".concat(coletor.length, " t\u00F3picos</div>\n               <div class=\"cards-grid\">").concat(coletor.map(function (i) { return renderCard(i, []); }).join(''), "</div>");
        }
        wrap.innerHTML = html;
    }
    // Atualizar badges das tabs
    var total = AJUDA_ITENS.length;
    var nA = AJUDA_ITENS.filter(function (i) { return i.categoria === 'Analista'; }).length;
    var nC = AJUDA_ITENS.filter(function (i) { return i.categoria === 'Coletor'; }).length;
    document.getElementById('ct-todos').textContent = total;
    document.getElementById('ct-analista').textContent = nA;
    document.getElementById('ct-coletor').textContent = nC;
}
function highlight(text, tokens) {
    if (!tokens || !tokens.length)
        return text;
    var result = text;
    for (var _i = 0, tokens_2 = tokens; _i < tokens_2.length; _i++) {
        var tok = tokens_2[_i];
        if (!tok || tok.length < 2)
            continue;
        // Case-insensitive highlight, preservando acentos originais
        var regex = new RegExp("(".concat(tok, ")"), 'gi');
        result = result.replace(regex, '<span class="hl">$1</span>');
    }
    return result;
}
function renderCard(item, tokens) {
    var cls = item.categoria === 'Analista' ? 'cat-analista' : 'cat-coletor';
    var tituloHL = highlight(item.titulo, tokens);
    var resumoHL = highlight(item.resumo, tokens);
    var tags = (item.palavrasChave || []).slice(0, 4)
        .map(function (t) { return "<span class=\"card-tag\">".concat(t, "</span>"); }).join('');
    return "\n    <div class=\"card ".concat(cls, "\" onclick=\"abrirDetalhe('").concat(item.id, "')\">\n      <div class=\"card-top\">\n        <div class=\"card-icon\">").concat(item.icon, "</div>\n        <span class=\"card-badge\">").concat(item.categoria, "</span>\n      </div>\n      <div class=\"card-title\">").concat(tituloHL, "</div>\n      <div class=\"card-desc\">").concat(resumoHL, "</div>\n      <div class=\"card-tags\">").concat(tags, "</div>\n    </div>");
}
// ── Modal de detalhe ────────────────────────────────────────────
function abrirDetalhe(id) {
    var item = AJUDA_ITENS.find(function (i) { return i.id === id; });
    if (!item)
        return;
    var cls = item.categoria === 'Analista' ? 'cat-analista' : 'cat-coletor';
    var iconBg = item.categoria === 'Analista' ? 'rgba(20,82,46,.2)' : 'rgba(232,117,26,.15)';
    // Passos
    var passosHtml = item.passos && item.passos.length
        ? "<div class=\"modal-section\">\n        <div class=\"modal-section-title\">\uD83D\uDCCB Passo a passo</div>\n        <ol class=\"modal-steps\">\n          ".concat(item.passos.map(function (p, i) { return "<li><span class=\"step-num\">".concat(i + 1, "</span><span>").concat(p, "</span></li>"); }).join(''), "\n        </ol>\n      </div>") : '';
    // Dicas
    var dicasHtml = item.dicas && item.dicas.length
        ? "<div class=\"modal-section\">\n        <div class=\"modal-section-title\">\uD83D\uDCA1 Dicas e aten\u00E7\u00F5es</div>\n        ".concat(item.dicas.map(function (d) { return "<div class=\"modal-alert ".concat(d.tipo, "\" style=\"margin-bottom:8px\">").concat(d.tipo === 'tip' ? '✅' : d.tipo === 'warn' ? '⚠️' : 'ℹ️', " ").concat(d.texto, "</div>"); }).join(''), "\n      </div>") : '';
    // Relacionados
    var rels = (item.relacionados || [])
        .map(function (rid) { return AJUDA_ITENS.find(function (i) { return i.id === rid; }); })
        .filter(Boolean);
    var relHtml = rels.length
        ? "<div class=\"modal-section\">\n        <div class=\"modal-section-title\">\uD83D\uDD17 T\u00F3picos relacionados</div>\n        <div class=\"related-grid\">\n          ".concat(rels.map(function (r) { return "\n            <div class=\"related-item\" onclick=\"abrirDetalhe('".concat(r.id, "')\">\n              <span class=\"related-icon\">").concat(r.icon, "</span>\n              <div>\n                <div class=\"related-txt\">").concat(r.titulo, "</div>\n                <div style=\"font-size:.65rem;color:var(--muted2);margin-top:1px\">").concat(r.categoria, "</div>\n              </div>\n            </div>"); }).join(''), "\n        </div>\n      </div>") : '';
    var modal = document.getElementById('modal-detalhe');
    modal.className = "modal ".concat(cls);
    modal.innerHTML = "\n    <div class=\"modal-hero\">\n      <div class=\"modal-hero-top\">\n        <div style=\"display:flex;align-items:center;gap:14px\">\n          <div class=\"modal-icon\">".concat(item.icon, "</div>\n          <div>\n            <div class=\"modal-title\">").concat(item.titulo, "</div>\n            <span class=\"modal-cat-badge\">").concat(item.categoria, "</span>\n          </div>\n        </div>\n        <button class=\"modal-close\" onclick=\"fecharModal()\">\u2715</button>\n      </div>\n      <p style=\"font-size:.82rem;color:var(--text2);margin-top:10px;line-height:1.6\">").concat(item.resumo, "</p>\n    </div>\n    <div class=\"modal-body\">\n      <div class=\"modal-section\">\n        <div class=\"modal-section-title\">\uD83D\uDCD6 Sobre este t\u00F3pico</div>\n        <div class=\"modal-content\"><p>").concat(item.conteudo, "</p></div>\n      </div>\n      ").concat(passosHtml, "\n      ").concat(dicasHtml, "\n      ").concat(relHtml, "\n    </div>");
    document.getElementById('modal-bg').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function fecharModal() {
    document.getElementById('modal-bg').classList.remove('open');
    document.body.style.overflow = '';
}
// Fechar com ESC
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape')
        fecharModal();
});
// Back to top
window.addEventListener('scroll', function () {
    var btn = document.getElementById('back-top');
    if (window.scrollY > 300)
        btn.classList.add('show');
    else
        btn.classList.remove('show');
});
// Init
renderResultados();
