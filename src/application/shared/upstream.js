import { UpstreamError } from '../../domain/errors.js';

/** Chama o serviço e devolve o corpo JSON; resposta 4xx/5xx vira UpstreamError com o corpo original. */
export async function callJson(client, req) {
  const res = await client.request(req);
  if (res.status >= 400) throw new UpstreamError(client.name, res.status, res.body);
  return res.body;
}

/** Executa a chamada medindo o tempo, sem lançar: { status: 'ok'|'error', ms, data?, error? }. */
export async function timed(fn, clock) {
  const start = clock.now().getTime();
  try {
    const data = await fn();
    return { status: 'ok', ms: clock.now().getTime() - start, data };
  } catch (err) {
    return {
      status: 'error',
      ms: clock.now().getTime() - start,
      error: err.body?.error?.message || err.message,
      httpStatus: err.status ?? null
    };
  }
}
