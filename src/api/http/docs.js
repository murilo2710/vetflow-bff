/**
 * Publica a documentação OpenAPI (Swagger UI) em /docs e o JSON em /docs/openapi.json.
 * A interface do Swagger UI é carregada do CDN, então o serviço não precisa de dependência extra.
 */
export function registerDocs(app, openapi) {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${openapi.info.title} - Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    const base = location.href.split(/[?#]/)[0].replace(/\\/?$/, '/');
    window.ui = SwaggerUIBundle({ url: base + 'openapi.json', dom_id: '#swagger', deepLinking: true });
  </script>
</body>
</html>`;

  app.get('/docs/openapi.json', (req, res) => res.json(openapi));
  // O Express trata /docs e /docs/ como a mesma rota; o redirect garante a barra final
  // para que o caminho relativo do openapi.json funcione também atrás do API Gateway.
  app.get('/docs', (req, res) => {
    if (req.originalUrl.split('?')[0].endsWith('/')) return res.type('html').send(html);
    return res.redirect(301, 'docs/');
  });
  app.get('/', (req, res) => res.redirect('docs/'));
}
