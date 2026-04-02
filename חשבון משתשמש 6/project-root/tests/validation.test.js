const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requireEmail,
  validatePassword,
  validateName,
  validateDeleteConfirmation
} = require('../netlify/functions/_shared/validation');

test('requireEmail normalizes valid email', () => {
  assert.equal(requireEmail(' TeSt@Example.com '), 'test@example.com');
});

test('validatePassword accepts strong password', () => {
  assert.equal(validatePassword('Strong123'), 'Strong123');
});

test('validateName rejects short values', () => {
  assert.throws(() => validateName('א'), /Full name/);
});

test('validateDeleteConfirmation enforces exact phrase', () => {
  assert.throws(() => validateDeleteConfirmation('delete'), /Delete confirmation/);
});
