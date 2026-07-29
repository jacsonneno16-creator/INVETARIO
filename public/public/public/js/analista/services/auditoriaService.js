(function(global){
  const AuditoriaService = {
    resumirAuditorias(auditorias){
      return (auditorias || []).reduce((acc, item) => {
        const status = String(item?.status || 'PENDENTE').toUpperCase();
        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, { total: 0 });
    }
  };
  global.AnalistaAuditoriaService = AuditoriaService;
})(window);
