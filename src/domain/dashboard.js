// Montagem da resposta agregada para a tela inicial (transformação pura de dados, sem I/O).

/** Junta à consulta os dados do pet que vêm de outro microserviço (MongoDB x Azure SQL). */
export function enrichAppointments(appointments = [], pets = []) {
  const byId = new Map(pets.map((p) => [p.id, p]));
  return appointments.map((a) => {
    const pet = byId.get(a.petId);
    return {
      ...a,
      pet: pet ? { id: pet.id, name: pet.name, species: pet.species, tutorName: pet.tutorName } : null
    };
  });
}

export function upcomingAppointments(appointments, now, limit = 5) {
  return appointments
    .filter((a) => ['SCHEDULED', 'CONFIRMED'].includes(a.status) && new Date(a.startsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}

/** Resposta única do GET /aggregated-data. Fontes que falharam aparecem em "sources" sem derrubar a tela. */
export function buildAggregatedResponse({ pets, appointments, services, indicators, notifications, sources, now, correlationId }) {
  const enriched = enrichAppointments(appointments ?? [], pets ?? []);
  return {
    generatedAt: now.toISOString(),
    correlationId,
    sources,
    summary: {
      pets: pets?.length ?? null,
      appointments: appointments?.length ?? null,
      services: services?.length ?? null,
      notifications: notifications?.length ?? null,
      degraded: Object.values(sources).some((s) => s.status !== 'ok')
    },
    upcoming: upcomingAppointments(enriched, now),
    pets: pets ?? [],
    appointments: enriched,
    services: services ?? [],
    indicators: indicators ?? null,
    notifications: notifications ?? []
  };
}
