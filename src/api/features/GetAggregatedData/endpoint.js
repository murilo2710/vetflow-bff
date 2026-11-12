import { asyncRoute } from '../../http/asyncRoute.js';

/** GET /aggregated-data (endpoint obrigatório do BFF) */
export function register(router, handler) {
  router.get('/aggregated-data', asyncRoute(async (req, res) => {
    res.json(await handler.execute({ correlationId: req.correlationId }));
  }));
}
