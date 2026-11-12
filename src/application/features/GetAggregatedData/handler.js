import { buildAggregatedResponse } from '../../../domain/dashboard.js';
import { callJson, timed } from '../../shared/upstream.js';

/**
 * Caso de uso obrigatório do BFF: GET /aggregated-data.
 * Consulta em paralelo o Microserviço 1 (MongoDB), o Microserviço 2 (Azure SQL) e a
 * Azure Function, e devolve tudo em um único JSON. A Function de indicadores recebe as
 * consultas do Microserviço 2 (enriquecimento/cálculo). Uma fonte fora do ar não derruba
 * a resposta: ela aparece com status "error" em "sources".
 */
export class GetAggregatedDataHandler {
  constructor({ petsService, appointmentsService, functionsService, clock }) {
    this.petsService = petsService;
    this.appointmentsService = appointmentsService;
    this.functionsService = functionsService;
    this.clock = clock;
  }

  async execute({ correlationId } = {}) {
    const get = (client, path, query) => callJson(client, { method: 'GET', path, query, correlationId });

    const [pets, appointments, services, notifications] = await Promise.all([
      timed(() => get(this.petsService, '/pets'), this.clock),
      timed(() => get(this.appointmentsService, '/appointments'), this.clock),
      timed(() => get(this.appointmentsService, '/services'), this.clock),
      timed(() => get(this.functionsService, '/notificacoes', { limit: 10 }), this.clock)
    ]);

    const indicators = appointments.status === 'ok'
      ? await timed(() => callJson(this.functionsService, {
        method: 'POST', path: '/indicadores', body: { appointments: appointments.data }, correlationId
      }), this.clock)
      : { status: 'skipped', ms: 0, error: 'Sem consultas: ms-appointments indisponível' };

    const describe = (r, extra) => ({ status: r.status, ms: r.ms, ...(r.error ? { error: r.error } : {}), ...extra });
    const sources = {
      'ms-pets (MongoDB)': describe(pets, { endpoint: 'GET /pets' }),
      'ms-appointments (Azure SQL)': describe(appointments, { endpoint: 'GET /appointments' }),
      'ms-appointments servicos': describe(services, { endpoint: 'GET /services' }),
      'function indicadores': describe(indicators, { endpoint: 'POST /api/indicadores' }),
      'function notificacoes': describe(notifications, { endpoint: 'GET /api/notificacoes' })
    };

    return buildAggregatedResponse({
      pets: pets.data,
      appointments: appointments.data,
      services: services.data,
      indicators: indicators.data,
      notifications: notifications.data,
      sources,
      now: this.clock.now(),
      correlationId
    });
  }
}
