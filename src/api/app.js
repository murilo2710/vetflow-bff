import express from 'express';
import { cors, requestLog } from './http/middlewares.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { registerDocs } from './http/docs.js';
import { requireGateway } from './http/gateway.js';
import { openapi } from './openapi.js';
import * as GetAggregatedData from './features/GetAggregatedData/endpoint.js';
import * as CreateAppointment from './features/CreateAppointment/endpoint.js';
import * as ForwardRequest from './features/ForwardRequest/endpoint.js';

/** Monta o BFF com os casos de uso recebidos do composition root (src/main.js). */
export function createApp({ handlers, corsOrigin = '*', gatewaySecret = '', gatewayPublicUrl = '', serviceName = 'vetflow-bff', info = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLog(serviceName));
  app.use(cors(corsOrigin));
  app.get('/health', (req, res) => res.json({ status: 'ok', service: serviceName, ...info }));
  app.use(requireGateway(gatewaySecret));
  app.use(express.json({ limit: '100kb' }));
  // Com o gateway configurado, o "Try it out" do Swagger chama pelo API Gateway.
  const servers = gatewayPublicUrl
    ? [{ url: gatewayPublicUrl, description: 'API Gateway (Azure API Management)' }, ...openapi.servers]
    : openapi.servers;
  registerDocs(app, { ...openapi, servers });

  const router = express.Router();
  GetAggregatedData.register(router, handlers.getAggregatedData);
  CreateAppointment.register(router, handlers.createAppointment);
  ForwardRequest.register(router, handlers.forwardRequest);
  app.use(router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
