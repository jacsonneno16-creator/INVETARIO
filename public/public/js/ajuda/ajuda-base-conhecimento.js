// Central de Ajuda — DT Inventário v118
// Conteúdo conferido com as telas e permissões disponíveis no Analista e no Coletor.
'use strict';

const topico = (id, icon, titulo, categoria, resumo, palavrasChave, conteudo, passos, dicas = [], relacionados = []) => ({
  id, icon, titulo, categoria, resumo, palavrasChave, conteudo, passos, dicas, relacionados
});
const dica = (tipo, texto) => ({ tipo, texto });

const AJUDA_ITENS = [
  topico('a01','📊','Dashboard: visão geral','Analista',
    'Entenda os indicadores, filtros, gráficos e alertas do Inventário e da Auditoria.',
    ['dashboard','painel','indicadores','kpi','gráficos','progresso','inventário ativo','auditoria'],
    'O <strong>Dashboard</strong> reúne o resumo da operação. O seletor de modalidade troca os indicadores entre Inventário e Auditoria; os filtros refinam os cartões, gráficos e listas.',
    ['Abra <strong>Dashboard</strong>.','Escolha <strong>Inventário</strong> ou <strong>Auditoria</strong> no primeiro seletor.','Use os filtros de operação, rua, local, status, nível ou produto, conforme a modalidade.','Leia os cartões para conferir totais, pendências, conflitos, recontagens e percentual concluído.','Clique em uma coluna ou parte de gráfico quando houver filtro interativo; clique novamente no mesmo item para retirar o filtro.'],
    [dica('info','O Dashboard é para análise geral. Para renovar manualmente todas as bases de uma operação, use a tela Acompanhamento.'),dica('tip','Se os dados parecerem antigos, confirme a loja ativa e depois use Atualizar no Acompanhamento.')],['a04','a05','a06']),

  topico('a02','📦','Criar e configurar um inventário','Analista',
    'Passo a passo para cadastrar, editar, liberar, finalizar ou excluir um inventário.',
    ['novo inventário','criar inventario','editar inventário','publicar','liberar','finalizar','excluir inventário','loja espelho'],
    'A aba <strong>Inventários</strong> controla o ciclo completo de cada inventário, desde o cadastro até a liberação aos coletores e o encerramento.',
    ['Acesse <strong>Inventários</strong> e clique em <strong>Novo Inventário</strong>.','Preencha código, nome, responsável, setor e a loja principal. Se necessário, informe lojas espelho.','Salve o cadastro e importe/vincule a base de endereços e produtos.','Revise os dados e use <strong>Liberar/Publicar</strong> para disponibilizar a operação no Coletor.','Acompanhe a execução e finalize somente depois das conferências.','Para remover, use Excluir e confirme a operação.'],
    [dica('warn','Finalizar ou excluir muda a disponibilidade da operação. Confira pendências, conflitos e recontagens antes.'),dica('info','Os botões exibidos dependem das permissões Criar, Editar, Excluir, Importar, Exportar, Publicar e Finalizar.')],['a03','a04','a20']),

  topico('a03','📥','Importar base do inventário','Analista',
    'Como carregar a planilha oficial e conferir endereços e produtos antes da contagem.',
    ['importar inventário','planilha','excel','xlsx','csv','base oficial','colunas','upload'],
    'A importação transforma a planilha em base operacional. A estrutura do arquivo precisa corresponder ao modelo aceito pela tela.',
    ['Abra <strong>Importar / Exportar</strong> ou a ação de importação do inventário.','Selecione o arquivo indicado pela tela.','Confira o reconhecimento das colunas e o resumo da validação.','Corrija linhas inválidas ou dados obrigatórios ausentes.','Confirme a importação e aguarde a mensagem de conclusão.','Confira as abas Endereços e Produtos antes de liberar o inventário.'],
    [dica('warn','Não feche a página durante o processamento.'),dica('tip','Mantenha uma cópia da planilha original para conferência e rastreabilidade.')],['a02','a14','a15']),

  topico('a04','🎯','Acompanhamento do Inventário','Analista',
    'Atualize de uma vez contagens, pendências, conflitos e recontagens, sem consultas automáticas.',
    ['acompanhamento inventário','atualizar','manual','contagens','pendências','conflitos','gráfico rua','operador'],
    'No modo <strong>Acompanhar Inventário</strong>, os dados são atualizados somente quando o analista clica em <strong>Atualizar</strong>. O clique renova as quatro bases usadas pelas abas do Inventário.',
    ['Abra <strong>Acompanhamento</strong>.','Escolha <strong>Acompanhar Inventário</strong>.','Selecione o inventário desejado.','Clique em <strong>Atualizar</strong> e aguarde o término da rodada.','Confira os cartões, progresso, gráficos por rua e desempenho dos coletores.','Use o filtro de rua para investigar uma área específica.'],
    [dica('info','Trocar de aba, mudar filtro ou deixar a página aberta não cria novas leituras automaticamente.'),dica('warn','Se aparecer tudo zerado, confirme a loja e o inventário selecionados antes de atualizar.')],['a01','a07','a08']),

  topico('a05','🔎','Acompanhamento da Auditoria','Analista',
    'Selecione a auditoria correta, atualize manualmente e interprete auditados, divergências e pendências.',
    ['acompanhamento auditoria','auditoria zerada','atualizar auditoria','auditados','divergências auditoria','selecionar auditoria'],
    'Ao trocar para <strong>Acompanhar Auditoria</strong>, o segundo seletor passa a listar somente auditorias. O sistema procura a origem que realmente contém a base e os resultados, evitando usar uma cópia vazia.',
    ['Abra <strong>Acompanhamento</strong>.','Escolha <strong>Acompanhar Auditoria</strong>.','Aguarde a lista e selecione a auditoria.','Clique em <strong>Atualizar</strong>.','Confira total de endereços, auditados, corretos, divergentes, pendentes e vazios.','Analise os gráficos por rua e por operador.'],
    [dica('info','A auditoria escolhida permanece selecionada depois da atualização.'),dica('tip','Nos gráficos interativos, o primeiro clique filtra e o segundo clique no mesmo item remove o filtro.')],['a01','a06','c10']),

  topico('a06','🛡️','Criar e operar uma auditoria','Analista',
    'Importe a base, publique para coleta, acompanhe resultados, atualize ou exclua a auditoria.',
    ['auditoria','criar auditoria','base auditoria','publicar auditoria','finalizar auditoria','excluir auditoria','atualizar base'],
    'A aba <strong>Auditoria</strong> gerencia operações independentes do inventário e permite importar uma base, liberar a execução no Coletor e conferir o resultado.',
    ['Abra <strong>Auditoria</strong> e crie uma nova operação.','Preencha os dados solicitados e importe a planilha da auditoria.','Revise a base e publique/libere para os usuários autorizados.','Acompanhe a execução na própria aba, no Dashboard ou no Acompanhamento.','Use <strong>Atualizar base</strong> somente quando precisar substituir os dados de origem.','Finalize ou exclua conforme a necessidade e sua permissão.'],
    [dica('warn','Atualizar a base durante uma operação em andamento exige conferência para não alterar o universo auditado.')],['a05','c10','a20']),

  topico('a07','📋','Contagens','Analista',
    'Consulte todas as contagens e filtre por operação, rua, operador, tipo, status e período.',
    ['contagens','histórico contagem','normal','recontagem','filtro operador','excluir contagem','editar contagem'],
    'A aba <strong>Contagens</strong> exibe os registros recebidos dos coletores e permite investigação detalhada.',
    ['Abra <strong>Contagens</strong>.','Escolha o inventário e aplique os filtros necessários.','Use a busca para endereço, produto ou operador.','Confira tipo, status, quantidade, data e demais detalhes da linha.','Use editar, excluir ou exportar somente quando necessário e permitido.'],
    [dica('warn','Excluir ou editar uma contagem pode mudar conflitos, pendências e indicadores relacionados.')],['a04','a08','a19']),

  topico('a08','⚠️','Pendências e endereços não contados','Analista',
    'Identifique o que ainda falta, incluindo recontagens pendentes e conflitos abertos.',
    ['pendências','não contados','faltando','endereço pendente','capacidade zero','recontagem pendente'],
    'A aba <strong>Pendências</strong> compara a base de endereços com as contagens existentes e separa itens não concluídos.',
    ['Selecione o inventário.','Confira os cartões de total, contados, não contados, recontagens e conflitos.','Filtre por status, rua ou local de estoque.','Use a busca para encontrar um endereço.','Trate os itens nas abas específicas de Conflitos ou Recontagens quando necessário.'],
    [dica('tip','Use esta tela antes de finalizar um inventário para localizar áreas esquecidas.')],['a04','a09','a10']),

  topico('a09','⚠️','Conflitos e divergências','Analista',
    'Analise diferenças, selecione itens, atribua recontagens e acompanhe a decisão do analista.',
    ['conflito','divergência','diferença','faltas','sobras','atribuir','aguardando analista','persistente'],
    'A aba <strong>Recontagem</strong> concentra, em uma única tela, a comparação entre o esperado e o bipado, a atribuição do operador, a execução e o resultado.',
    ['Selecione o inventário e use os filtros rápidos ou detalhados.','Abra o item para comparar endereço, produto, operadores e quantidades.','Selecione uma ou várias linhas quando quiser uma ação em lote.','Atribua a recontagem ao operador adequado ou deixe disponível, conforme o processo.','Depois do retorno, confira se o conflito foi resolvido ou ficou persistente.'],
    [dica('warn','Confirme o inventário e os itens selecionados antes de executar uma ação em lote.')],['a10','a11','a19']),

  topico('a10','🔄','Recontagens e rodadas','Analista',
    'Crie, atribua, reatribua, acompanhe e encerre recontagens.',
    ['recontagem','rodadas','atribuir operador','reatribuir','não atribuída','concluída','persistente'],
    'Na aba <strong>Recontagem</strong>, use os filtros para localizar itens pendentes, atribuídos, concluídos ou persistentes sem trocar de tela.',
    ['Escolha o inventário.','Filtre por status da divergência, status da recontagem, operador ou rua.','Crie ou atribua a rodada para um operador quando necessário.','Acompanhe a execução pelo Coletor.','Depois do envio, confira a diferença e o status final.','Exporte a lista para conferência quando necessário.'],
    [dica('info','A seção de recontagens atribuídas foi removida de Usuários/Lojas; a gestão fica centralizada nesta aba.')],['a09','c08','a11']),

  topico('a11','📈','Relatório de Conflitos','Analista',
    'Veja faltas, sobras, resolvidos, persistentes e exporte o relatório filtrado.',
    ['relatório conflitos','rel divergências','faltas','sobras','persistentes','exportar divergências'],
    'O <strong>Relatório de Conflitos</strong> oferece visão consolidada para análise e prestação de contas.',
    ['Abra a aba e selecione o inventário.','Filtre por status, tipo, local, rua e operador.','Confira os cartões de total, abertas, em recontagem, resolvidas, persistentes, faltas e sobras.','Revise a tabela detalhada.','Use Exportar para baixar o recorte filtrado.'],
    [],['a09','a10','a17']),

  topico('a12','🪪','Capas duplicadas','Analista',
    'Localize números de Capa Pallet usados mais de uma vez ou em mais de um inventário.',
    ['capa duplicada','capa pallet duplicada','número repetido','ocorrência','mais de um inventário'],
    'A aba <strong>Capas Duplicadas</strong> ajuda a identificar reaproveitamento indevido do mesmo número de capa.',
    ['Selecione o inventário ou mantenha a visão geral.','Pesquise pelo número da capa, endereço ou inventário.','Confira o total de capas duplicadas, ocorrências e uso em múltiplos inventários.','Abra as ocorrências e corrija ou exclua somente quando autorizado.'],
    [dica('warn','Antes de excluir, confirme qual ocorrência é válida para preservar a rastreabilidade.')],['c07','a19']),

  topico('a13','🏆','Produtividade','Analista',
    'Use cartões, pódio, gráficos por operador e horário, composição e tabela detalhada.',
    ['produtividade','operador','ranking','pódio','gráfico','contagens por hora','conflitos gerados','recontagens'],
    'A aba <strong>Produtividade</strong> segue o padrão visual do Dashboard e preserva a tabela detalhada e a exportação.',
    ['Selecione inventário, rua, local e período.','Confira operadores ativos, endereços, contagens, produtos, conflitos e recontagens.','Use o pódio para identificar destaques.','Compare endereços únicos e contagens no gráfico por operador.','Analise a composição entre contagens normais, recontagens e conflitos.','Observe a distribuição por horário e confira a tabela antes de exportar.'],
    [dica('info','Produtividade por Operador foi removida da tela Coletores; a análise completa fica nesta aba.')],['a01','a16']),

  topico('a14','📍','Endereços','Analista',
    'Cadastre, edite, importe, exclua e acompanhe status, local e capacidade dos endereços.',
    ['endereços','rua','nível','posição','local estoque','capacidade','bloqueado','importar endereços','editar endereço'],
    'A aba <strong>Endereços</strong> mantém a estrutura física usada nos inventários.',
    ['Abra Endereços e confirme a loja ativa.','Use os filtros de loja, local e status ou pesquise pelo endereço.','Clique em Novo para cadastro manual ou use Importar para carga em lote.','Edite status, localização e capacidade quando necessário.','Revise os indicadores de ativos, inativos, limite atingido e capacidade zero.','Exclua somente depois de confirmar que o endereço não é necessário em operações vigentes.'],
    [dica('warn','Alterações em endereços podem afetar bases e pendências de inventários em andamento.')],['a03','a15','a20']),

  topico('a15','🏷️','Produtos','Analista',
    'Pesquise, cadastre, edite, importe e atualize produtos, famílias, DUN e GTIN.',
    ['produtos','cadastro produto','dun','gtin','família','atualizar produtos','importar produtos','sem dun'],
    'A aba <strong>Produtos</strong> mantém o catálogo usado na identificação e contagem.',
    ['Abra Produtos.','Pesquise por código, descrição, família ou GTIN e filtre por status.','Cadastre manualmente ou importe uma planilha.','Preencha corretamente código, descrição, família, DUN e GTIN aplicáveis.','Use Atualizar quando for renovar dados existentes.','Confira os indicadores de produtos sem DUN ou sem GTIN.'],
    [dica('warn','Evite criar códigos duplicados; pesquise antes de cadastrar um novo produto.')],['a03','a14','c06']),

  topico('a16','📱','Coletores e dispositivos','Analista',
    'Cadastre, aprove, bloqueie, simule ou exclua aparelhos vinculados à operação.',
    ['coletores','dispositivo','aparelho','aprovar','bloquear','simular coletor','excluir coletor','painel coletores'],
    'A aba <strong>Coletores</strong> gerencia os aparelhos. Ela mostra estado e atividade dos dispositivos, sem o antigo ranking de produtividade.',
    ['Selecione o inventário quando a tela solicitar.','Confira os cartões dos dispositivos e a última atualização do painel.','Cadastre ou simule um dispositivo quando necessário.','Aprove um aparelho reconhecido antes do uso, conforme a regra da empresa.','Bloqueie ou exclua aparelhos que não devem mais acessar.'],
    [dica('info','Para desempenho de pessoas, use a aba Produtividade. Para acesso de login, use Usuários e Permissões.')],['a13','a17','c01']),

  topico('a17','👤','Criar usuário e definir acesso','Analista',
    'Crie login, escolha Coletor/Analista, lojas permitidas e permissões detalhadas.',
    ['criar usuário','criar login','permissões','acesso coletor','acesso analista','lojas permitidas','senha','usuários'],
    'Em <strong>Usuários e Permissões</strong>, cada pessoa recebe canais de acesso, lojas e uma matriz de ações. Uma aba sem permissão <strong>Visualizar</strong> não aparece no login.',
    ['Abra Usuários e Permissões e clique em Criar Usuário.','Informe nome, login e senha de no mínimo 6 caracteres.','Escolha se a pessoa pode acessar Coletor, Analista ou ambos.','Defina acesso a todas as lojas ou marque somente as permitidas.','Se houver acesso ao Analista, marque as abas e ações necessárias.','Garanta pelo menos uma aba com Visualizar e salve.','Entregue o login e a senha à pessoa pelo canal seguro da empresa.'],
    [dica('warn','Não libere Excluir, Configurar ou Executar sem necessidade operacional.'),dica('info','Contas antigas e o administrador mestre mantêm compatibilidade; novos controles valem quando o cadastro é salvo na configuração atual.')],['a18','a20','c01']),

  topico('a18','🗑️','Editar ou excluir usuário','Analista',
    'Altere canais, lojas e permissões ou remova completamente o login do Firebase.',
    ['editar usuário','configurar usuário','excluir usuário','firebase authentication','bloquear login','remover acesso'],
    'O botão <strong>Configurar</strong> altera os acessos. O botão <strong>Excluir</strong> remove o login do Firebase Authentication, o cadastro de acesso e os registros do usuário nas lojas.',
    ['Abra Usuários e Permissões.','Localize a pessoa e use Configurar para alterar dados, canais, lojas ou permissões.','Para remover, clique em Excluir e leia a confirmação.','Confirme somente se for o usuário correto.','Aguarde a mensagem de exclusão concluída.'],
    [dica('warn','A exclusão é permanente e exige que as funções do Firebase estejam publicadas.'),dica('info','A própria conta e o administrador mestre são protegidos contra exclusão.')],['a17','a24']),

  topico('a19','🧾','Rastreabilidade','Analista',
    'Consulte o histórico formado por inventários, auditorias, contagens, conflitos e recontagens.',
    ['rastreabilidade','histórico','logs','quem fez','quando','ações','registro','trilha'],
    'A aba <strong>Rastreabilidade</strong> centraliza eventos da loja atual para investigar o que aconteceu na operação.',
    ['Confirme a loja ativa.','Abra Rastreabilidade.','Use os filtros e a busca para localizar uma operação, usuário ou evento.','Confira data, origem e detalhes.','Exporte o recorte quando precisar guardar ou analisar fora do sistema.'],
    [dica('warn','Excluir registros de rastreabilidade reduz o histórico disponível e deve ser restrito.')],['a07','a09','a10']),

  topico('a20','🏪','Lojas e troca de ambiente','Analista',
    'Cadastre lojas, altere o ambiente ativo e entenda como dados e permissões ficam separados.',
    ['lojas','gestão lojas','loja ativa','trocar ambiente','matriz','importar loja','acesso lojas'],
    'Cada loja possui seu próprio ambiente de dados. O seletor no topo troca a loja ativa; o usuário vê somente lojas liberadas em seu cadastro.',
    ['Abra Lojas para criar ou editar um cadastro.','Informe nome, código e status.','Use o seletor de loja no topo para mudar o ambiente atual.','Espere a tela recarregar os dados da loja escolhida.','Defina as lojas permitidas de cada pessoa em Usuários e Permissões.'],
    [dica('warn','Sempre confira a loja ativa antes de importar, editar, excluir ou publicar dados.')],['a17','a14','a21']),

  topico('a21','↕️','Importar, exportar e API','Analista',
    'Use arquivos, mapeamento de dados, exportações e integração externa com segurança.',
    ['importar exportar','api','webhook','endpoint','mapeamento','enviar','executar integração','csv','excel'],
    'A aba <strong>Importar / Exportar / API</strong> reúne trocas de dados com arquivos e sistemas externos.',
    ['Escolha a área adequada: importar, exportar ou integração/API.','Na importação, selecione o arquivo, revise o mapeamento e valide antes de confirmar.','Na exportação, escolha operação, filtros e formato.','Na API, configure destino e parâmetros conforme o sistema receptor.','Teste a configuração com dados controlados.','Execute o envio e confira o retorno apresentado.'],
    [dica('warn','Ações Configurar e Executar/Enviar devem ficar limitadas a responsáveis pela integração.')],['a03','a11','a24']),

  topico('a22','🔄','Sincronizar e republicar dados','Analista',
    'Entenda a diferença entre Atualizar o Acompanhamento e republicar tudo no Firebase.',
    ['sincronizar','republicar firebase','atualizar dados','botão sync','última sync','firebase'],
    '<strong>Atualizar</strong> no Acompanhamento faz uma leitura manual para renovar o painel. <strong>Sincronizar/Republicar</strong> no topo executa uma operação mais ampla de envio das bases ao Firebase.',
    ['Para apenas ver dados recentes, abra Acompanhamento e clique Atualizar.','Use Republicar/Sincronizar somente quando houver necessidade de reenviar bases.','Aguarde a conclusão e não repita cliques durante o processamento.','Depois, confirme os indicadores e a última sincronização.'],
    [dica('warn','Republicar tudo pode gerar muitas gravações. Não use como botão comum de atualização.')],['a04','a05','a24']),

  topico('a23','🔐','Como funcionam as permissões','Analista',
    'Veja todas as áreas e ações que podem ser liberadas ou bloqueadas por usuário.',
    ['matriz permissões','visualizar','criar','editar','excluir','importar','exportar','publicar','finalizar','aprovar','bloquear'],
    'A matriz possui 18 áreas: Dashboard, Inventários, Acompanhamento, Auditoria, Contagens, Pendências, Em Conflito, Rodadas, Relatório de Conflitos, Capas Duplicadas, Produtividade, Endereços, Produtos, Coletores, Usuários, Lojas, Rastreabilidade e Importar/Exportar/API.',
    ['<strong>Visualizar</strong> mostra a aba; sem ela, a aba fica oculta.','<strong>Criar, Editar e Excluir</strong> controlam manutenção de registros.','<strong>Importar e Exportar</strong> controlam entrada e saída de arquivos.','<strong>Liberar/Publicar e Finalizar</strong> controlam o ciclo das operações.','<strong>Atualizar</strong> controla renovação manual de painéis ou produtos.','<strong>Aprovar e Bloquear</strong> controlam dispositivos.','<strong>Configurar e Executar/Enviar</strong> controlam integrações.'],
    [dica('tip','Aplique o menor acesso necessário para a função da pessoa e revise periodicamente.')],['a17','a18','a20']),

  topico('a24','🚀','Atualizar GitHub e publicar Firebase','Analista',
    'Procedimento para substituir a versão, enviar ao GitHub e publicar Hosting, Functions e Rules.',
    ['github','git clone','git push','firebase deploy','publicar sistema','hosting','functions','firestore rules','ctrl shift r'],
    'O projeto deve ser atualizado dentro da pasta criada por <strong>git clone</strong>, pois um Download ZIP não possui o histórico do Git. Versões com exclusão de usuários também exigem Functions.',
    ['Na primeira vez, clone o repositório original com <code>git clone</code>.','Extraia a nova versão em outra pasta e copie seu conteúdo para dentro da pasta clonada, substituindo os arquivos.','Dentro da pasta clonada, execute <code>git status</code> e confira as alterações.','Execute <code>git add -A</code>, <code>git commit -m "Atualiza sistema"</code> e <code>git push origin main</code>.','Publique com <code>firebase deploy --only hosting,functions,firestore:rules</code>.','Abra o sistema e pressione <code>Ctrl + Shift + R</code> para carregar o cache novo.'],
    [dica('warn','Não execute git init sobre uma pasta extraída de ZIP se já existe um repositório oficial.'),dica('info','Antes do push, confirme que está dentro da pasta onde git status mostra a branch do repositório.')],['a18','a22']),

  topico('c01','🔐','Entrar no Coletor','Coletor',
    'Faça login, selecione a loja permitida e entenda os acessos por dispositivo.',
    ['login coletor','entrar','senha','loja coletor','dispositivo','sem acesso','usuário coletor'],
    'O Coletor aceita apenas usuários com o canal <strong>Coletor</strong> liberado. Depois do login, o usuário vê somente as lojas permitidas.',
    ['Abra a tela do Coletor.','Informe e-mail/login e senha.','Se houver mais de uma loja, escolha a correta.','Aguarde o carregamento das operações disponíveis.','Se o aparelho exigir aprovação, solicite ao analista responsável.'],
    [dica('warn','Nunca compartilhe a mesma conta entre operadores; a identificação é usada na produtividade e rastreabilidade.')],['a16','a17','c02']),

  topico('c02','⬇️','Baixar e abrir uma operação','Coletor',
    'Localize Inventário ou Auditoria, filtre por loja e faça o download para trabalhar.',
    ['baixar inventário','download operação','abrir inventário','lista operações','auditoria coletor','loja'],
    'Somente operações liberadas e compatíveis com a loja e o acesso do usuário aparecem no Coletor.',
    ['Entre no Coletor e confirme a loja.','Escolha Inventário ou Auditoria.','Use os filtros disponíveis para localizar a operação.','Clique para baixar/abrir e aguarde a conclusão.','Confirme o nome da operação antes de iniciar.'],
    [dica('info','Uma operação já baixada pode continuar disponível localmente para uso offline, conforme o estado do aparelho.')],['c03','c10','a02']),

  topico('c03','📴','Trabalhar offline e sincronizar','Coletor',
    'Continue contando sem internet e envie os dados quando a conexão voltar.',
    ['offline','sem internet','sincronizar','fila','pendente envio','sync','dados locais'],
    'O Coletor guarda operações e lançamentos no dispositivo para permitir trabalho sem conexão. A sincronização envia os registros pendentes ao Firebase.',
    ['Baixe a operação enquanto houver internet.','Durante a contagem, observe o indicador de conexão/sincronização.','Sem internet, continue lançando normalmente e não limpe os dados do navegador.','Quando a conexão voltar, aguarde ou acione a sincronização indicada pela tela.','Confirme que não restam itens pendentes antes de encerrar ou trocar de aparelho.'],
    [dica('warn','Não limpe cache/dados, não use modo anônimo e não desinstale o aplicativo enquanto houver envios pendentes.')],['c02','c09','a22']),

  topico('c04','📍','Escolher endereço e iniciar contagem','Coletor',
    'Selecione rua/endereço e comece uma contagem no local correto.',
    ['endereço','rua','posição','iniciar contagem','selecionar endereço','próximo endereço'],
    'O endereço identifica fisicamente onde os produtos serão lançados. Verifique o código completo antes de contar.',
    ['Abra o inventário baixado.','Filtre ou pesquise a rua/endereço.','Confirme local, rua, nível e posição exibidos.','Abra o endereço e inicie a contagem.','Finalize o endereço somente depois de revisar todos os produtos.'],
    [dica('warn','Lançar no endereço errado gera conflito e retrabalho.')],['c05','c06','a14']),

  topico('c05','🪪','Capa Pallet','Coletor',
    'Informe ou use corretamente a Capa Pallet e evite números duplicados.',
    ['capa pallet','capa','palete','7 dígitos','número capa','duplicada','faixa','range'],
    'A Capa Pallet identifica uma unidade logística e precisa permanecer única. O sistema controla faixas e pode alertar duplicidade.',
    ['Na etapa solicitada, informe/escaneie a capa conforme o padrão da operação.','Confira todos os dígitos antes de avançar.','Se o sistema alertar duplicidade, não force o uso; verifique o pallet correto.','Continue os lançamentos vinculados à capa válida.','Finalize somente depois da revisão.'],
    [dica('warn','Não reutilize capa de outro pallet ou inventário sem orientação do analista.')],['a12','c06','c07']),

  topico('c06','🏷️','Lançar produto e quantidade','Coletor',
    'Leia DUN/GTIN, selecione produto e informe quantidade com segurança.',
    ['produto','dun','gtin','código barras','quantidade','lançamento rápido','unidade','caixa'],
    'Cada lançamento relaciona produto, quantidade, operador, endereço, horário e, quando aplicável, Capa Pallet.',
    ['Escaneie ou digite o código do produto.','Confirme a descrição encontrada.','Informe a quantidade na unidade indicada pela operação.','Revise produto e quantidade antes de confirmar.','Repita para os demais itens do endereço.'],
    [dica('warn','Se o produto não for encontrado, não escolha um item parecido. Solicite correção do cadastro ao analista.')],['a15','c04','c09']),

  topico('c07','🧱','Montar e finalizar pallet','Coletor',
    'Organize lançamentos na capa correta e conclua o pallet sem perder itens.',
    ['finalizar pallet','montar pallet','fechar capa','trocar capa','itens pallet'],
    'Os produtos lançados permanecem associados à Capa Pallet atual até a conclusão ou troca permitida pelo fluxo.',
    ['Confirme a capa ativa.','Lance todos os produtos e quantidades do pallet.','Revise a lista antes de concluir.','Finalize o pallet conforme o botão da tela.','Inicie outra capa somente para outro pallet físico.'],
    [dica('warn','Finalizar uma capa incompleta pode exigir estorno ou correção posterior.')],['c05','c09']),

  topico('c08','🔄','Executar uma recontagem','Coletor',
    'Abra a rodada atribuída, conte novamente e envie o resultado.',
    ['recontagem coletor','rodada','atribuída','segunda contagem','conflito','pendente'],
    'Recontagens aparecem para operadores autorizados ou atribuídos e devem ser feitas como nova conferência, sem copiar o valor anterior.',
    ['Abra a área de recontagens/rodadas.','Escolha um item disponível ou atribuído ao seu usuário.','Vá ao endereço físico e refaça a contagem completa.','Informe o resultado encontrado.','Revise e envie.','Confirme que o item saiu da lista pendente ou ficou aguardando análise.'],
    [dica('warn','Não use o valor exibido anteriormente como referência; conte novamente o estoque físico.')],['a09','a10','c03']),

  topico('c09','↩️','Corrigir, estornar ou revisar lançamento','Coletor',
    'Saiba o que fazer ao perceber produto, quantidade, endereço ou capa incorretos.',
    ['estorno','corrigir contagem','excluir lançamento','produto errado','quantidade errada','voltar','revisar'],
    'A correção deve ser feita antes da finalização sempre que possível. As opções exibidas dependem do estágio da contagem e das regras da operação.',
    ['Pare antes de continuar novos lançamentos.','Abra a revisão do endereço, pallet ou item.','Localize o lançamento incorreto.','Use editar/remover/estornar quando a tela disponibilizar.','Refaça o lançamento correto.','Se a operação já estiver encerrada ou sincronizada sem opção de correção, avise o analista.'],
    [dica('warn','Não crie um lançamento inverso para “compensar” sem orientação; isso prejudica a rastreabilidade.')],['c06','c07','a07']),

  topico('c10','🛡️','Realizar auditoria no Coletor','Coletor',
    'Baixe a auditoria, filtre endereços e envie correto, divergente ou vazio.',
    ['auditoria coletor','auditar','correto','divergente','endereço vazio','base auditoria','resultado auditoria'],
    'A Auditoria usa sua própria base e resultados. O usuário precisa ter canal Coletor, loja permitida e a operação liberada.',
    ['Na tela inicial, escolha Auditoria.','Localize e baixe a operação correta.','Abra o endereço a ser auditado.','Confira fisicamente produto e quantidade conforme o fluxo.','Registre o resultado, inclusive endereço vazio quando aplicável.','Envie e confirme a sincronização.'],
    [dica('warn','Confira o nome da auditoria antes de lançar; Inventário e Auditoria são operações diferentes.')],['a05','a06','c03']),

  topico('c11','🧰','Problemas comuns no Coletor','Coletor',
    'Resolva operação que não aparece, login negado, dispositivo bloqueado ou sincronização pendente.',
    ['erro coletor','não aparece inventário','login negado','dispositivo bloqueado','não sincroniza','problemas'],
    'A maioria dos problemas está relacionada a canal de acesso, loja, operação não publicada, aparelho não aprovado, conexão ou dados pendentes.',
    ['Confirme internet, usuário e senha.','Verifique se o canal Coletor e a loja estão liberados no usuário.','Confirme com o analista se a operação está publicada.','Se o aparelho estiver pendente ou bloqueado, solicite aprovação na aba Coletores.','Se houver dados pendentes, mantenha a tela aberta e tente sincronizar novamente.','Não limpe os dados locais antes de confirmar que tudo foi enviado.'],
    [dica('tip','Ao pedir ajuda, informe usuário, loja, operação, aparelho e a mensagem exata exibida.')],['a16','a17','c03'])
];

let categoriaAtiva = 'todos';
let buscaAtiva = '';

function normalizarBusca(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function textoPesquisavel(item) {
  return normalizarBusca([
    item.titulo, item.categoria, item.resumo, item.conteudo,
    ...(item.palavrasChave || []), ...(item.passos || []),
    ...(item.dicas || []).map(x => x.texto)
  ].join(' '));
}

function buscarAjuda(valor) {
  buscaAtiva = normalizarBusca(valor);
  renderResultados();
}

function filtrarCat(categoria, elemento) {
  categoriaAtiva = categoria;
  document.querySelectorAll('.cat-tab').forEach(x => x.classList.remove('on', 'on-orange'));
  elemento.classList.add(categoria === 'Coletor' ? 'on-orange' : 'on');
  renderResultados();
}

function itensVisiveis() {
  const termos = buscaAtiva.split(/\s+/).filter(Boolean);
  return AJUDA_ITENS.filter(item => {
    if (categoriaAtiva !== 'todos' && item.categoria !== categoriaAtiva) return false;
    const base = textoPesquisavel(item);
    return termos.every(termo => base.includes(termo));
  });
}

function renderResultados() {
  const lista = itensVisiveis();
  const wrap = document.getElementById('resultados-wrap');
  const vazio = document.getElementById('empty-busca');
  if (!lista.length) {
    wrap.innerHTML = '';
    vazio.classList.add('show');
  } else {
    vazio.classList.remove('show');
    const grupos = categoriaAtiva === 'todos' ? ['Analista', 'Coletor'] : [categoriaAtiva];
    wrap.innerHTML = grupos.map(cat => {
      const itens = lista.filter(x => x.categoria === cat);
      if (!itens.length) return '';
      return `<div class="sec-title">${cat === 'Analista' ? '🖥️' : '📱'} ${cat} · ${itens.length} tópico${itens.length === 1 ? '' : 's'}</div>
        <div class="cards-grid">${itens.map(renderCard).join('')}</div>`;
    }).join('');
  }
  document.getElementById('ct-todos').textContent = AJUDA_ITENS.length;
  document.getElementById('ct-analista').textContent = AJUDA_ITENS.filter(x => x.categoria === 'Analista').length;
  document.getElementById('ct-coletor').textContent = AJUDA_ITENS.filter(x => x.categoria === 'Coletor').length;
}

function renderCard(item) {
  const cls = item.categoria === 'Analista' ? 'cat-analista' : 'cat-coletor';
  return `<article class="card ${cls}" onclick="abrirDetalhe('${item.id}')" tabindex="0" onkeydown="if(event.key==='Enter')abrirDetalhe('${item.id}')">
    <div class="card-top"><div class="card-icon">${item.icon}</div><span class="card-badge">${item.categoria}</span></div>
    <div class="card-title">${item.titulo}</div><div class="card-desc">${item.resumo}</div>
    <div class="card-tags">${(item.palavrasChave || []).slice(0, 4).map(x => `<span class="card-tag">${x}</span>`).join('')}</div>
  </article>`;
}

function abrirDetalhe(id) {
  const item = AJUDA_ITENS.find(x => x.id === id);
  if (!item) return;
  const cls = item.categoria === 'Analista' ? 'cat-analista' : 'cat-coletor';
  const dicasHtml = item.dicas.length ? `<div class="modal-section"><div class="modal-section-title">💡 Dicas e atenções</div>
    ${item.dicas.map(x => `<div class="modal-alert ${x.tipo}" style="margin-bottom:8px">${x.tipo === 'warn' ? '⚠️' : x.tipo === 'tip' ? '✅' : 'ℹ️'} ${x.texto}</div>`).join('')}</div>` : '';
  const relacionados = item.relacionados.map(rid => AJUDA_ITENS.find(x => x.id === rid)).filter(Boolean);
  document.getElementById('modal-detalhe').className = `modal ${cls}`;
  document.getElementById('modal-detalhe').innerHTML = `
    <div class="modal-hero"><div class="modal-hero-top"><div style="display:flex;align-items:center;gap:14px">
      <div class="modal-icon">${item.icon}</div><div><div class="modal-title">${item.titulo}</div><span class="modal-cat-badge">${item.categoria}</span></div>
    </div><button class="modal-close" onclick="fecharModal()" aria-label="Fechar">✕</button></div>
    <p style="font-size:.82rem;color:var(--text2);margin-top:10px;line-height:1.6">${item.resumo}</p></div>
    <div class="modal-body">
      <div class="modal-section"><div class="modal-section-title">📖 O que é e como funciona</div><div class="modal-content"><p>${item.conteudo}</p></div></div>
      <div class="modal-section"><div class="modal-section-title">📋 Passo a passo</div><ol class="modal-steps">
        ${item.passos.map((p, i) => `<li><span class="step-num">${i + 1}</span><span>${p}</span></li>`).join('')}
      </ol></div>${dicasHtml}
      ${relacionados.length ? `<div class="modal-section"><div class="modal-section-title">🔗 Tópicos relacionados</div><div class="related-grid">
        ${relacionados.map(x => `<div class="related-item" onclick="abrirDetalhe('${x.id}')"><span class="related-icon">${x.icon}</span><div><div class="related-txt">${x.titulo}</div><div style="font-size:.65rem;color:var(--muted2)">${x.categoria}</div></div></div>`).join('')}
      </div></div>` : ''}
    </div>`;
  document.getElementById('modal-bg').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  document.getElementById('modal-bg').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') fecharModal();
  if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault();
    document.getElementById('campo-busca')?.focus();
  }
});
window.addEventListener('scroll', () => document.getElementById('back-top')?.classList.toggle('show', window.scrollY > 300));
renderResultados();
