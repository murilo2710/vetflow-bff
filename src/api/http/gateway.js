import { timingSafeEqual } from 'node:crypto';

/**
 * Exige que as chamadas venham pelo API Gateway: o gateway injeta o cabeçalho
 * x-gateway-secret e o BFF recusa (401) quem tentar chamar o BFF diretamente.
 * Desligado quando GATEWAY_SECRET não está definido (desenvolvimento local).
 */
export function requireGateway(secret, { open = ['/health', '/docs'] } = {}) {
  if (!secret) return (req, res, next) => next();
  const expected = Buffer.from(secret);
  return (req, res, next) => {
    const isOpen = req.path === '/' || open.some((p) => req.path === p || req.path.startsWith(`${p}/`));
    if (req.method === 'OPTIONS' || isOpen) return next();
    const got = Buffer.from(String(req.get('x-gateway-secret') ?? ''));
    if (got.length === expected.length && timingSafeEqual(got, expected)) return next();
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Acesse o VetFlow pelo API Gateway' } });
  };
}
