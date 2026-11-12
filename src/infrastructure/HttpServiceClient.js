import { UpstreamError } from '../domain/errors.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Adaptador HTTP da porta ServiceClient. Timeout por chamada, propagação do
 * x-correlation-id e uma nova tentativa apenas para GET (operação segura de repetir).
 */
export class HttpServiceClient {
  constructor({ name, baseUrl, timeoutMs = 10000, headers = {}, retries = 1 }) {
    if (!baseUrl) throw new Error(`URL do serviço ${name} não configurada`);
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.headers = headers;
    this.retries = retries;
  }

  async request({ method = 'GET', path, query, body, correlationId }) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const attempts = method === 'GET' ? this.retries + 1 : 1;
    let lastError;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            accept: 'application/json',
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
            ...this.headers
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        const text = await res.text();
        let parsed = null;
        if (text) {
          try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
        }
        return { status: res.status, body: parsed };
      } catch (err) {
        lastError = err;
        if (i < attempts - 1) await sleep(300);
      }
    }
    const timedOut = lastError?.name === 'TimeoutError';
    throw new UpstreamError(this.name, timedOut ? 504 : 503, {
      error: { code: 'service_unavailable', message: `${this.name} ${timedOut ? 'não respondeu a tempo' : 'indisponível'}` }
    });
  }
}
