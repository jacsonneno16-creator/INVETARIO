ROLLBACK DO LOADING GLOBAL V12/V13

Objetivo:
- remover o loading global aplicado em todo o sistema;
- restaurar os loadings nativos anteriores;
- manter somente o loading específico da Análise Completa do Inventário da V11;
- preservar as permissões da Análise de Inventários usando a versão V8 do 37-usuarios-permissoes.js;
- neutralizar js/shared/dt-loading-brand.js para evitar efeitos caso algum HTML antigo em cache ainda tente carregá-lo.

Deploy: Hosting.
