const test = require('node:test');
const assert = require('node:assert/strict');
const { getActorKey } = require('../netlify/functions/_shared/request');

test('user actor keys are deterministic', () => {
  assert.equal(getActorKey({ userId: 'abc', scope: 'login' }), 'user:abc:login');
});

test('anonymous actor keys differ by email', () => {
  const a = getActorKey({ email: 'a@example.com', scope: 'signup' });
  const b = getActorKey({ email: 'b@example.com', scope: 'signup' });
  assert.notEqual(a, b);
});
