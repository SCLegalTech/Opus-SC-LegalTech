// Centraliza el acceso a secretos sensibles para no tener fallbacks publicos
// regados por la codebase. Importar desde aqui en vez de leer process.env directo.
//
// Diseño: si una variable requerida falta, este modulo lanza al ser importado.
// Como server.js valida JWT_SECRET al boot antes de cargar otros modulos, en
// runtime normal este throw nunca se ejecuta — funciona como red de seguridad
// para scripts CLI o tests que no pasan por server.js.

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[secrets] ${name} es requerido. Generar con: openssl rand -hex 32`);
  }
  return value;
}

module.exports = {
  JWT_SECRET: requireEnv('JWT_SECRET'),
};
