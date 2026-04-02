const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealTestDb } = require('../helpers/sqlite-test-db.js');

const accessPath = require.resolve('../../netlify/functions/_shared/authz/access.js');
const supabasePath = require.resolve('../../netlify/functions/_shared/supabase.js');

const originalSupabase = require.cache[supabasePath];

function loadAccess(client) {
  delete require.cache[accessPath];
  require.cache[supabasePath] = { exports: { getAdminClient: () => client } };
  return require(accessPath);
}

function restore(db) {
  delete require.cache[accessPath];
  if (originalSupabase) require.cache[supabasePath] = originalSupabase; else delete require.cache[supabasePath];
  db?.close();
}

test('authorizeCampaignAccess allows owner access with real ownership validation', async () => {
  const db = createRealTestDb();
  db.seedUser({ id: 'owner-1' });
  db.seedCampaign({ id: 'camp-1', ownerUserId: 'owner-1' });
  const { authorizeCampaignAccess } = loadAccess(db.client);

  const result = await authorizeCampaignAccess({ userId: 'owner-1', campaignId: 'camp-1', minRole: 'admin' });
  assert.equal(result.authorized, true);
  assert.equal(result.role, 'owner');

  restore(db);
});

test('authorizeCampaignAccess rejects non-owner access when membership is missing', async () => {
  const db = createRealTestDb();
  db.seedUser({ id: 'owner-1' });
  db.seedUser({ id: 'user-2' });
  db.seedCampaign({ id: 'camp-1', ownerUserId: 'owner-1' });
  const { authorizeCampaignAccess } = loadAccess(db.client);

  await assert.rejects(
    () => authorizeCampaignAccess({ userId: 'user-2', campaignId: 'camp-1', minRole: 'member' }),
    (error) => {
      assert.equal(error.code, 'FORBIDDEN');
      return true;
    },
  );

  restore(db);
});
