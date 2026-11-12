import { asyncRoute } from '../../http/asyncRoute.js';

/** POST /appointments (orquestra ms-pets + ms-appointments) */
export function register(router, handler) {
  router.post('/appointments', asyncRoute(async (req, res) => {
    const appointment = await handler.execute({ body: req.body ?? {}, correlationId: req.correlationId });
    res.status(201).json(appointment);
  }));
}
