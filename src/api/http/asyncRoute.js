/** Encaminha erros de handlers assíncronos para o tratador de erros do Express. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
