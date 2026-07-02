/* Minimal structured logger. Swap for pino/winston in production if desired. */
function ts() {
  return new Date().toISOString();
}

module.exports = {
  info: (...args) => console.log(`[INFO ${ts()}]`, ...args),
  warn: (...args) => console.warn(`[WARN ${ts()}]`, ...args),
  error: (...args) => console.error(`[ERROR ${ts()}]`, ...args),
};
