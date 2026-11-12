// Erros do BFF. O BFF não tem regra de negócio própria: os erros de negócio vêm dos
// microserviços e são repassados (UpstreamError). Validações locais são só de orquestração.
export class DomainError extends Error {
  constructor(type, message, details = undefined) {
    super(message);
    this.name = 'DomainError';
    this.type = type; // validation | not_found | unauthorized | upstream
    this.details = details;
  }
}

export const validation = (message, details) => new DomainError('validation', message, details);
export const notFound = (message) => new DomainError('not_found', message);

/** Resposta de erro de um microserviço (ou indisponibilidade dele), repassada ao frontend. */
export class UpstreamError extends DomainError {
  constructor(service, status, body, message = `Falha ao chamar ${service}`) {
    super('upstream', message);
    this.service = service;
    this.status = status;
    this.body = body;
  }
}
