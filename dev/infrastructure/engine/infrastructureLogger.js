function createNoop() {
  return () => {};
}

function createInfrastructureLogger(logger = console) {
  const target = logger && typeof logger === 'object' ? logger : console;

  return {
    info: typeof target.info === 'function' ? target.info.bind(target) : createNoop(),
    warn: typeof target.warn === 'function' ? target.warn.bind(target) : createNoop(),
    error: typeof target.error === 'function' ? target.error.bind(target) : createNoop()
  };
}

module.exports = {
  createInfrastructureLogger
};
