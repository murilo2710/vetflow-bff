// Formato de erro: { "error": { "code", "message", "details" } }.
// Erros vindos dos microserviços são repassados com o mesmo status e corpo.
const STATUS_BY_TYPE = { validation: 400, not_found: 404, unauthorized: 401 };

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'route_not_found', message: `Rota ${req.method} ${req.path} não existe no BFF` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'upstream') {
    return res.status(err.status).json(err.body ?? { error: { code: 'upstream_error', message: err.message } });
  }
  if (err?.name === 'DomainError' && STATUS_BY_TYPE[err.type]) {
    return res.status(STATUS_BY_TYPE[err.type]).json({ error: { code: err.type, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'JSON inválido no corpo da requisição' } });
  }
  if (err?.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: { code: err.type || 'bad_request', message: err.message } });
  }
  console.error(JSON.stringify({ level: 'error', path: req.path, correlationId: req.correlationId, message: err?.message, stack: err?.stack }));
  return res.status(500).json({ error: { code: 'internal_error', message: 'Erro interno no BFF' } });
}
