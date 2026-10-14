(function(){
  var ok = /(^|\.)redalyc\.org$/.test(location.hostname) && /busquedaArticulo/.test(location.pathname);
  if (!ok) {
    if (confirm('Este marcador funciona en la página de resultados de búsqueda de Redalyc. ¿Abrir el buscador de Redalyc?')) location.href = 'https://www.redalyc.org/busquedaArticuloFiltros.oa?q=';
    return;
  }
  /*CORE*/
  window.__redalycExporter && window.__redalycExporter.open();
})();
