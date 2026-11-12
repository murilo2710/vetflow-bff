import { randomUUID } from 'node:crypto';

/** CORS simples, sem dependência extra. */
export function cors(origin = '*') {
  return (req, res, next) => {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-correlation-id');
    res.set('Access-Control-Expose-Headers', 'x-correlation-id');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  };
}

/**
 * Correlation id + log estruturado. O BFF envia o x-correlation-id, então a mesma
 * requisição do usuário pode ser seguida nos logs do BFF e de cada microserviço.
 */
export function requestLog(serviceName) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    req.correlationId = req.get('x-correlation-id') || randomUUID();
    res.set('x-correlation-id', req.correlationId);
    res.on('finish', () => {
      if (req.path === '/health') return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(JSON.stringify({
        level: 'info', service: serviceName, correlationId: req.correlationId,
        method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(ms)
      }));
    });
    next();
  };
}
