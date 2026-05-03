const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function run(context, callback) {
  return storage.run(context, callback);
}

function getContext() {
  return storage.getStore() || {};
}

function getCorrelationId() {
  return getContext().correlationId;
}

function getTenantId() {
  return getContext().tenantId;
}

function setContextValue(key, value) {
  const context = storage.getStore();
  if (context) {
    context[key] = value;
  }
}

module.exports = {
  run,
  getContext,
  getCorrelationId,
  getTenantId,
  setContextValue
};
