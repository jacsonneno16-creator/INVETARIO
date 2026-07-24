// ═══════════════════════════════════════════════════
//  ESTADO GLOBAL
// ═══════════════════════════════════════════════════
// ── Variáveis de recontagem (declaradas cedo para uso em voltarInventarios) ──
var _recFiltroAtivo = 'todos';
var _recCarregando = false;
var _recListener = null;
var _recJaAtivouAba = false;
var _auditoriaListener = null;
var _endVerif = null; // cache de verificação Firebase do endereço atual
var APP = {
    operador: null,
    inventario: null, // metadados do inventário ativo
    base: [], // registros normalizados (com _end)
    endCapacidade: {}, // { endNorm: maxPallets }
    locaisAtivos: new Set(), // endNorm cadastrados em dt_locais (para validação)
    _locaisDoFirebase: false, // true = locaisAtivos veio do dt_locais completo (Firebase)
    contagens: [],
    contagensOutros: [],
    auditorias: [],
    recontagens: [],
    modoAcesso: 'inventario',
    modoPendente: 'inventario',
    divergenciasAtribuidas: [],
    modoRecontagem: null,
    recPalletAtual: 1,
    sessionStart: new Date(),
    sessaoId: null,
    turnoEncerrado: false, // trava para impedir novas contagens após encerrar
    capaRange: null, // { min, max } — range de capas palete do operador
    // ── Lançamento Rápido (lote) ──────────────────────────────────────
    lote: null, // null = inativo; objeto = lote em andamento
    // { endNorm, endExib, cap, gtin, codigoProduto, descricaoProduto,
    //   qtdPadrao, totalPallets, capasLidas:[],
    //   pendenciasValidade:[{capa,idx}],  // capas que ainda precisam de validade
    //   grupos:[{validade, capas:[]}],    // grupos de validade já definidos
    //   totalSalvos }
    lotePerguntaFeita: false, // por endereço — não perguntar 2x no mesmo endereço
    atual: {
        step: 1,
        endereco: '',
        _endNorm: '', // endereço normalizado para busca
        enderecoValido: false,
        capacidadeEnd: 0,
        capa: '',
        gtin: '',
        produtoAtual: null,
        produtoDivergenteEnd: false,
        validade: '',
        quantidade: 0,
        somentesDun: false,
    },
    proximoCapa: 1,
    calc: { expr: '', resultado: null },
    inventariosDisponiveis: [],
};
