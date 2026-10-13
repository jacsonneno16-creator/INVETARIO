# DT Print Agent
Serviço local para impressão pelo Coletor na mesma rede/Wi-Fi.

1. Instale Node.js no PC/servidor que enxerga as impressoras.
2. Execute `node server.js`.
3. Libere a porta 9101 no firewall da rede local.
4. No Analista > Configurações > Impressoras, cadastre `http://IP_DO_PC:9101`.
5. O Analista anexa o PDF à NF na Carga; o arquivo fica neste agente. O Coletor mostra 🖨️ quando todos os produtos têm NF e existe PDF anexado.

No Windows, o agente usa a impressão padrão do visualizador PDF. Em Linux usa `lp`. Para ambientes específicos, defina `PRINT_COMMAND` com `{file}` e `{printer}`.
