(function (global) {
    var AuditoriaService = {
        resumirAuditorias: function (auditorias) {
            return (auditorias || []).reduce(function (acc, item) {
                var status = String((item === null || item === void 0 ? void 0 : item.status) || 'PENDENTE').toUpperCase();
                acc.total += 1;
                acc[status] = (acc[status] || 0) + 1;
                return acc;
            }, { total: 0 });
        }
    };
    global.AnalistaAuditoriaService = AuditoriaService;
})(window);
