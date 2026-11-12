import { asyncRoute } from '../../http/asyncRoute.js';

/**
 * Rotas de CRUD que o BFF repassa aos serviços. O frontend só conhece o BFF;
 * os endereços reais dos microserviços e da Function ficam escondidos aqui.
 * [método, rota no BFF, serviço, rota no serviço]
 */
export const ROUTES = [
  ['get', '/pets', 'pets', () => '/pets'],
  ['post', '/pets', 'pets', () => '/pets'],
  ['get', '/pets/:id', 'pets', (p) => `/pets/${p.id}`],
  ['put', '/pets/:id', 'pets', (p) => `/pets/${p.id}`],
  ['delete', '/pets/:id', 'pets', (p) => `/pets/${p.id}`],
  ['post', '/pets/:id/records', 'pets', (p) => `/pets/${p.id}/records`],
  ['get', '/appointments', 'appointments', () => '/appointments'],
  ['get', '/appointments/:id', 'appointments', (p) => `/appointments/${p.id}`],
  ['put', '/appointments/:id', 'appointments', (p) => `/appointments/${p.id}`],
  ['patch', '/appointments/:id/confirm', 'appointments', (p) => `/appointments/${p.id}/confirm`],
  ['patch', '/appointments/:id/cancel', 'appointments', (p) => `/appointments/${p.id}/cancel`],
  ['delete', '/appointments/:id', 'appointments', (p) => `/appointments/${p.id}`],
  ['get', '/services', 'appointments', () => '/services'],
  ['get', '/events', 'appointments', () => '/events'],
  ['get', '/notifications', 'functions', () => '/notificacoes']
];

export function register(router, handler) {
  for (const [method, route, service, target] of ROUTES) {
    router[method](route, asyncRoute(async (req, res) => {
      const params = Object.fromEntries(Object.entries(req.params).map(([k, v]) => [k, encodeURIComponent(v)]));
      const upstream = await handler.execute({
        service,
        method: method.toUpperCase(),
        path: target(params),
        query: req.query,
        body: ['post', 'put', 'patch'].includes(method) ? (req.body ?? {}) : undefined,
        correlationId: req.correlationId
      });
      if (upstream.status === 204 || upstream.body === null) return res.status(upstream.status).end();
      return res.status(upstream.status).json(upstream.body);
    }));
  }
}
