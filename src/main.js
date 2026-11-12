// Composition root do BFF: cria os clientes HTTP dos serviços e injeta nos casos de uso.
import { loadConfig, systemClock } from './infrastructure/config.js';
import { HttpServiceClient } from './infrastructure/HttpServiceClient.js';
import { GetAggregatedDataHandler } from './application/features/GetAggregatedData/handler.js';
import { CreateAppointmentHandler } from './application/features/CreateAppointment/handler.js';
import { ForwardRequestHandler } from './application/features/ForwardRequest/handler.js';
import { createApp } from './api/app.js';

const config = loadConfig();
const timeoutMs = config.timeoutMs;
const deps = {
  petsService: new HttpServiceClient({ name: 'ms-pets', baseUrl: config.petsServiceUrl, timeoutMs }),
  appointmentsService: new HttpServiceClient({ name: 'ms-appointments', baseUrl: config.appointmentsServiceUrl, timeoutMs }),
  functionsService: new HttpServiceClient({
    name: 'vetflow-functions',
    baseUrl: config.functionsUrl,
    timeoutMs,
    headers: config.functionsKey ? { 'x-functions-key': config.functionsKey } : {}
  }),
  clock: systemClock
};

const app = createApp({
  handlers: {
    getAggregatedData: new GetAggregatedDataHandler(deps),
    createAppointment: new CreateAppointmentHandler(deps),
    forwardRequest: new ForwardRequestHandler(deps)
  },
  corsOrigin: config.corsOrigin,
  gatewaySecret: config.gatewaySecret,
  gatewayPublicUrl: config.gatewayPublicUrl,
  serviceName: config.serviceName,
  info: { gatewayProtected: Boolean(config.gatewaySecret) }
});

app.listen(config.port, () => {
  console.log(`[bff] porta ${config.port} | pets=${config.petsServiceUrl} | appointments=${config.appointmentsServiceUrl} | functions=${config.functionsUrl}`);
});
