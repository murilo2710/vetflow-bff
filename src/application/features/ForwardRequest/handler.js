import { validation } from '../../../domain/errors.js';

/**
 * Proxy das operações de CRUD: repassa a chamada ao serviço correto e devolve status e corpo
 * como vieram (inclusive erros 400/404/409 de regra de negócio). A lista de rotas permitidas
 * fica na camada API; aqui só se escolhe o cliente pelo nome lógico do serviço.
 */
export class ForwardRequestHandler {
  constructor({ petsService, appointmentsService, functionsService }) {
    this.clients = { pets: petsService, appointments: appointmentsService, functions: functionsService };
  }

  async execute({ service, method, path, query, body, correlationId }) {
    const client = this.clients[service];
    if (!client) throw validation(`Serviço desconhecido: ${service}`);
    return client.request({ method, path, query, body, correlationId });
  }
}
