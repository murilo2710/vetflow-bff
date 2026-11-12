// Configuração do BFF por variáveis de ambiente.
export function loadConfig(env = process.env) {
  const config = {
    serviceName: 'vetflow-bff',
    port: Number(env.PORT || 3000),
    nodeEnv: env.NODE_ENV || 'development',
    petsServiceUrl: env.PETS_SERVICE_URL || 'http://localhost:3001',
    appointmentsServiceUrl: env.APPOINTMENTS_SERVICE_URL || 'http://localhost:3002',
    functionsUrl: env.FUNCTIONS_URL || 'http://localhost:7071/api',
    functionsKey: env.FUNCTIONS_KEY || '',
    gatewaySecret: env.GATEWAY_SECRET || '',
    gatewayPublicUrl: env.GATEWAY_PUBLIC_URL || '',
    corsOrigin: env.CORS_ORIGIN || '*',
    timeoutMs: Number(env.UPSTREAM_TIMEOUT_MS || 10000)
  };
  if (config.nodeEnv === 'production') {
    for (const key of ['petsServiceUrl', 'appointmentsServiceUrl', 'functionsUrl']) {
      if (/localhost|127\.0\.0\.1/.test(config[key])) throw new Error(`${key} aponta para localhost em produção`);
    }
  }
  return config;
}

export const systemClock = { now: () => new Date() };
