import { validation, UpstreamError } from '../../../domain/errors.js';
import { callJson } from '../../shared/upstream.js';

/**
 * Orquestração do agendamento: o frontend envia só petId, veterinário, serviço e horário.
 * O BFF busca o pet no Serviço de Prontuário (MongoDB) e completa nome do pet e e-mail do
 * tutor antes de chamar o Serviço de Agenda (Azure SQL). As regras de agenda continuam no
 * microserviço; o BFF apenas compõe as chamadas.
 */
export class CreateAppointmentHandler {
  constructor({ petsService, appointmentsService }) {
    this.petsService = petsService;
    this.appointmentsService = appointmentsService;
  }

  async execute({ body = {}, correlationId }) {
    if (!body.petId) throw validation('Agendamento inválido', { petId: 'Selecione o pet' });
    const pet = await this.petsService.request({ method: 'GET', path: `/pets/${encodeURIComponent(body.petId)}`, correlationId });
    if (pet.status === 404) throw validation('Agendamento inválido', { petId: 'Pet não encontrado no Serviço de Prontuário' });
    if (pet.status >= 400) throw new UpstreamError(this.petsService.name, pet.status, pet.body);

    return callJson(this.appointmentsService, {
      method: 'POST',
      path: '/appointments',
      correlationId,
      body: {
        petId: pet.body.id,
        petName: pet.body.name,
        tutorEmail: pet.body.tutorEmail,
        vetName: body.vetName,
        serviceId: body.serviceId,
        startsAt: body.startsAt,
        notes: body.notes
      }
    });
  }
}
