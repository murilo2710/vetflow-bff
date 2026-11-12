// OpenAPI do BFF (Swagger em /docs). O frontend só conversa com estas rotas.
const json = (schema) => ({ 'application/json': { schema } });
const obj = { type: 'object', additionalProperties: true };
const arr = { type: 'array', items: obj };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const ok = (description, schema = obj) => ({ 200: { description, content: json(schema) } });
const errors = { 400: { description: 'Validação (repassada do microserviço)' }, 404: { description: 'Não encontrado' }, 409: { description: 'Regra de negócio violada' }, 503: { description: 'Serviço a jusante indisponível' } };

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'VetFlow - BFF (Backend for Frontend)',
    version: '1.0.0',
    description: 'Ponto único de acesso do microfrontend. Agrega o Serviço de Prontuário (MongoDB), o Serviço de Agenda ' +
      '(Azure SQL) e a Azure Function, e repassa as operações de CRUD. Em produção é acessado pelo API Gateway ' +
      '(Azure API Management). Autores: Bernardo Vieira e Murilo Regnier.'
  },
  servers: [{ url: '/', description: 'Este servidor (ou o API Gateway)' }],
  tags: [{ name: 'Agregação' }, { name: 'Pets (ms-pets / MongoDB)' }, { name: 'Consultas (ms-appointments / Azure SQL)' }, { name: 'Function' }, { name: 'Health' }],
  paths: {
    '/aggregated-data': {
      get: {
        tags: ['Agregação'],
        summary: 'Dados agregados: ms-pets + ms-appointments + Azure Function em um único JSON',
        description: 'Chama em paralelo GET /pets (MongoDB), GET /appointments e GET /services (Azure SQL), ' +
          'GET /api/notificacoes (Function) e depois POST /api/indicadores (Function) com as consultas. ' +
          'Cada fonte aparece em "sources" com status e tempo de resposta.',
        responses: ok('Resposta agregada', {
          type: 'object',
          properties: {
            generatedAt: { type: 'string', format: 'date-time' },
            correlationId: { type: 'string' },
            sources: { type: 'object', additionalProperties: { type: 'object', properties: { status: { type: 'string' }, ms: { type: 'integer' }, endpoint: { type: 'string' } } } },
            summary: obj, upcoming: arr, pets: arr, appointments: arr, services: arr, indicators: obj, notifications: arr
          }
        })
      }
    },
    '/pets': {
      get: { tags: ['Pets (ms-pets / MongoDB)'], summary: 'Listar pets', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'species', in: 'query', schema: { type: 'string' } }], responses: ok('Pets', arr) },
      post: { tags: ['Pets (ms-pets / MongoDB)'], summary: 'Cadastrar pet', requestBody: { content: json({ type: 'object', example: { name: 'Thor', species: 'DOG', breed: 'Golden Retriever', birthDate: '2021-03-10', weightKg: 28.5, tutorName: 'Ana Souza', tutorEmail: 'ana@email.com' } }) }, responses: { 201: { description: 'Criado' }, ...errors } }
    },
    '/pets/{id}': {
      get: { tags: ['Pets (ms-pets / MongoDB)'], summary: 'Ficha do pet com prontuário', parameters: [id], responses: { ...ok('Pet'), ...errors } },
      put: { tags: ['Pets (ms-pets / MongoDB)'], summary: 'Atualizar pet', parameters: [id], requestBody: { content: json(obj) }, responses: { ...ok('Pet'), ...errors } },
      delete: { tags: ['Pets (ms-pets / MongoDB)'], summary: 'Remover pet', parameters: [id], responses: { 204: { description: 'Removido' }, ...errors } }
    },
    '/pets/{id}/records': {
      post: { tags: ['Pets (ms-pets / MongoDB)'], summary: 'Registrar atendimento no prontuário', parameters: [id], requestBody: { content: json({ type: 'object', example: { vetName: 'Dra. Carla Mendes', diagnosis: 'Otite externa leve', prescription: 'Limpeza auricular por 7 dias', weightKg: 29 } }) }, responses: { 201: { description: 'Registrado' }, ...errors } }
    },
    '/appointments': {
      get: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Agenda', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'petId', in: 'query', schema: { type: 'string' } }], responses: ok('Consultas', arr) },
      post: {
        tags: ['Consultas (ms-appointments / Azure SQL)'],
        summary: 'Agendar (orquestração: busca o pet no ms-pets e cria no ms-appointments)',
        requestBody: { content: json({ type: 'object', required: ['petId', 'vetName', 'serviceId', 'startsAt'], example: { petId: '6733a1f0c2b4e5a1d2f3a4b5', vetName: 'Dra. Carla Mendes', serviceId: 'consulta-clinica', startsAt: '2026-11-20T14:00:00-03:00', notes: 'Coçando a orelha' } }) },
        responses: { 201: { description: 'Agendada (publica AppointmentBooked)' }, ...errors }
      }
    },
    '/appointments/{id}': {
      get: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Consultar', parameters: [id], responses: { ...ok('Consulta'), ...errors } },
      put: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Reagendar', parameters: [id], requestBody: { content: json({ type: 'object', example: { startsAt: '2026-11-21T10:00:00-03:00' } }) }, responses: { ...ok('Consulta'), ...errors } },
      delete: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Excluir', parameters: [id], responses: { 204: { description: 'Excluída' }, ...errors } }
    },
    '/appointments/{id}/confirm': { patch: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Confirmar (pagamento aprovado)', parameters: [id], responses: { ...ok('Consulta'), ...errors } } },
    '/appointments/{id}/cancel': { patch: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Cancelar com motivo', parameters: [id], requestBody: { content: json({ type: 'object', example: { reason: 'Tutor viajou' } }) }, responses: { ...ok('Consulta'), ...errors } } },
    '/services': { get: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Tabela de serviços e preços', responses: ok('Serviços', arr) } },
    '/events': { get: { tags: ['Consultas (ms-appointments / Azure SQL)'], summary: 'Eventos de domínio do outbox (status de publicação no Service Bus)', responses: ok('Eventos', arr) } },
    '/notifications': { get: { tags: ['Function'], summary: 'Notificações geradas pela Azure Function a partir dos eventos', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: ok('Notificações', arr) } },
    '/health': { get: { tags: ['Health'], summary: 'Saúde do BFF', responses: ok('OK') } }
  }
};
