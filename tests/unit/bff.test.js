// Testes do BFF com clientes falsos (sem rede): agregação, falha parcial, orquestração e proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetAggregatedDataHandler } from '../../src/application/features/GetAggregatedData/handler.js';
import { CreateAppointmentHandler } from '../../src/application/features/CreateAppointment/handler.js';
import { ForwardRequestHandler } from '../../src/application/features/ForwardRequest/handler.js';
import { enrichAppointments, upcomingAppointments } from '../../src/domain/dashboard.js';
import { UpstreamError } from '../../src/domain/errors.js';
import { requireGateway } from '../../src/api/http/gateway.js';

const now = new Date('2026-11-12T12:00:00Z');
const clock = { now: () => now };

const pets = [{ id: 'p1', name: 'Thor', species: 'DOG', tutorName: 'Ana', tutorEmail: 'ana@email.com' }];
const appointments = [
  { id: 'a1', petId: 'p1', status: 'SCHEDULED', startsAt: '2026-11-13T14:00:00Z', priceCents: 15000, vetName: 'Dra. Carla' },
  { id: 'a2', petId: 'p9', status: 'CANCELLED', startsAt: '2026-11-13T15:00:00Z', priceCents: 9000, vetName: 'Dr. Paulo' }
];

/** Cliente falso: responde por "MÉTODO caminho" e registra as chamadas. */
function fakeClient(name, routes) {
  const calls = [];
  return {
    name,
    calls,
    async request(req) {
      calls.push(req);
      const r = routes[`${req.method} ${req.path}`];
      if (r instanceof Error) throw r;
      if (!r) return { status: 404, body: { error: { code: 'not_found', message: 'nada' } } };
      return typeof r === 'function' ? r(req) : r;
    }
  };
}

function services(overrides = {}) {
  return {
    petsService: fakeClient('ms-pets', { 'GET /pets': { status: 200, body: pets }, 'GET /pets/p1': { status: 200, body: pets[0] }, ...overrides.pets }),
    appointmentsService: fakeClient('ms-appointments', {
      'GET /appointments': { status: 200, body: appointments },
      'GET /services': { status: 200, body: [{ id: 'consulta-clinica' }] },
      'POST /appointments': (req) => ({ status: 201, body: { id: 'new', ...req.body } }),
      ...overrides.appointments
    }),
    functionsService: fakeClient('vetflow-functions', {
      'GET /notificacoes': { status: 200, body: [{ id: 'n1' }] },
      'POST /indicadores': (req) => ({ status: 200, body: { totalConsultas: req.body.appointments.length } }),
      ...overrides.functions
    }),
    clock
  };
}

test('aggregated-data junta ms-pets, ms-appointments e Function em um único JSON', async () => {
  const deps = services();
  const r = await new GetAggregatedDataHandler(deps).execute({ correlationId: 'c1' });
  assert.equal(r.pets.length, 1);
  assert.equal(r.appointments.length, 2);
  assert.equal(r.appointments[0].pet.name, 'Thor');
  assert.equal(r.appointments[1].pet, null);
  assert.equal(r.indicators.totalConsultas, 2);
  assert.equal(r.notifications.length, 1);
  assert.equal(r.summary.degraded, false);
  assert.ok(Object.values(r.sources).every((s) => s.status === 'ok'));
  assert.equal(deps.functionsService.calls.find((c) => c.path === '/indicadores').body.appointments.length, 2);
  assert.ok(deps.petsService.calls.every((c) => c.correlationId === 'c1'));
});

test('aggregated-data continua respondendo quando um serviço cai (falha parcial)', async () => {
  const deps = services({ pets: { 'GET /pets': new UpstreamError('ms-pets', 503, { error: { message: 'ms-pets indisponível' } }) } });
  const r = await new GetAggregatedDataHandler(deps).execute({});
  assert.equal(r.sources['ms-pets (MongoDB)'].status, 'error');
  assert.equal(r.sources['ms-pets (MongoDB)'].error, 'ms-pets indisponível');
  assert.equal(r.summary.degraded, true);
  assert.equal(r.appointments.length, 2);
  assert.equal(r.indicators.totalConsultas, 2);
});

test('sem consultas, a Function de indicadores não é chamada', async () => {
  const deps = services({ appointments: { 'GET /appointments': { status: 500, body: { error: { message: 'SQL fora' } } } } });
  const r = await new GetAggregatedDataHandler(deps).execute({});
  assert.equal(r.sources['function indicadores'].status, 'skipped');
  assert.equal(r.indicators, null);
  assert.equal(deps.functionsService.calls.some((c) => c.path === '/indicadores'), false);
});

test('agendamento pelo BFF completa nome do pet e e-mail do tutor a partir do ms-pets', async () => {
  const deps = services();
  const created = await new CreateAppointmentHandler(deps).execute({
    body: { petId: 'p1', vetName: 'Dra. Carla', serviceId: 'consulta-clinica', startsAt: '2026-11-13T14:00:00Z', petName: 'ignorado' }
  });
  assert.equal(created.petName, 'Thor');
  assert.equal(created.tutorEmail, 'ana@email.com');
});

test('agendamento com pet inexistente é recusado antes de chamar o ms-appointments', async () => {
  const deps = services();
  await assert.rejects(new CreateAppointmentHandler(deps).execute({ body: { petId: 'zz' } }), (e) => e.type === 'validation');
  assert.equal(deps.appointmentsService.calls.length, 0);
});

test('erro de regra de negócio do microserviço é repassado com o mesmo status (409)', async () => {
  const deps = services({ appointments: { 'POST /appointments': { status: 409, body: { error: { code: 'conflict' } } } } });
  await assert.rejects(new CreateAppointmentHandler(deps).execute({ body: { petId: 'p1' } }), (e) => e.type === 'upstream' && e.status === 409);
});

test('ForwardRequest escolhe o serviço pelo nome lógico', async () => {
  const deps = services();
  const r = await new ForwardRequestHandler(deps).execute({ service: 'functions', method: 'GET', path: '/notificacoes' });
  assert.equal(r.status, 200);
  await assert.rejects(new ForwardRequestHandler(deps).execute({ service: 'x', method: 'GET', path: '/' }), (e) => e.type === 'validation');
});

test('dashboard: próximas consultas só futuras e ativas; pet de outro serviço é anexado', () => {
  const enriched = enrichAppointments(appointments, pets);
  assert.equal(enriched[0].pet.species, 'DOG');
  assert.deepEqual(upcomingAppointments(enriched, now).map((a) => a.id), ['a1']);
});

test('API Gateway: sem o segredo o BFF responde 401; health e docs ficam abertos', () => {
  const mw = requireGateway('s3gr3d0');
  const run = (path, header) => {
    let status = 200;
    let passed = false;
    const req = { method: 'GET', path, get: () => header };
    const res = { status: (s) => { status = s; return res; }, json: () => res };
    mw(req, res, () => { passed = true; });
    return passed ? 'next' : status;
  };
  assert.equal(run('/aggregated-data', undefined), 401);
  assert.equal(run('/aggregated-data', 'errado'), 401);
  assert.equal(run('/aggregated-data', 's3gr3d0'), 'next');
  assert.equal(run('/health', undefined), 'next');
  assert.equal(run('/docs/openapi.json', undefined), 'next');
});
