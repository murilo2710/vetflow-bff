// Portas do BFF (implementadas por HttpServiceClient em src/infrastructure).

/**
 * Cliente de um serviço a jusante (microserviço ou Function).
 * Devolve o status e o corpo da resposta; só lança UpstreamError quando o serviço não responde.
 * @typedef {Object} ServiceClient
 * @property {string} name
 * @property {(req: { method: string, path: string, query?: object, body?: any, correlationId?: string })
 *   => Promise<{ status: number, body: any }>} request
 */

/** @typedef {{ now: () => Date }} Clock */

export const PORTS = Object.freeze(['petsService', 'appointmentsService', 'functionsService', 'clock']);
