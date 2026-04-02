const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { resetDatabase, closeDb } = require('../src/storage/db');
const { createUser, getUserById } = require('../src/repositories/userRepository');
const { runAnalysis } = require('../src/brain/runAnalysis');
const { createCampaign } = require('../src/repositories/campaignRepository');
const { appendCampaignToUser, syncUserLinkageSummary } = require('../src/services/userLinkageService');
const analysisRepository = require('../src/repositories/analysisRepository');
const { logHistory, listHistory } = require('../src/repositories/historyRepository');

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function startServer() {
  return await new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, path, options = {}) {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  let body = null;
  const text = await response.text();
  if (text) {
    body = JSON.parse(text);
  }
  return { response, body };
}

test.beforeEach(() => {
  resetDatabase();
});

test.after(() => {
  closeDb();
});

test('analysis flow keeps history and user linkage connected', async () => {
  const userId = uniqueId('user');
  await createUser({ id: userId, email: `${userId}@test.com` });

  const result = await runAnalysis({ source: 'test' }, userId);
  const user = await getUserById(userId);
  const history = await listHistory();

  assert.equal(result.user_id, userId);
  assert.equal(result.status, 'processed');
  assert.ok(user.analysis_history.includes(result.id));
  assert.ok(history.some((entry) => entry.analysis_id === result.id && entry.action_type === 'analysis_created'));
  assert.ok(history.some((entry) => entry.analysis_id === result.id && entry.action_type === 'analysis_processed'));
});

test('campaign flow can link campaign and write history', async () => {
  const userId = uniqueId('user');
  const campaignId = uniqueId('campaign');
  await createUser({ id: userId, email: `${userId}@test.com` });

  await createCampaign({ id: campaignId, user_id: userId, name: 'Smoke Test Campaign', created_at: new Date().toISOString() });
  await appendCampaignToUser(userId, campaignId);
  await logHistory({
    action_type: 'campaign_created',
    user_id: userId,
    entity_type: 'campaign',
    entity_id: campaignId,
    campaign_id: campaignId,
    status: 'success',
    metadata: { source: 'test' }
  });
  await syncUserLinkageSummary(userId);

  const user = await getUserById(userId);
  const history = await listHistory();

  assert.ok(user.campaigns.includes(campaignId));
  assert.ok(user.linkage_summary.campaigns_count >= 1);
  assert.ok(history.some((entry) => entry.campaign_id === campaignId && entry.action_type === 'campaign_created'));
});

test('route returns 401 when userId is missing', async () => {
  const server = await startServer();
  try {
    const { response, body } = await request(server, '/api/analyses');
    assert.equal(response.status, 401);
    assert.match(body.error, /Missing required userId/);
  } finally {
    server.close();
  }
});

test('analysis routes enforce ownership isolation', async () => {
  const ownerId = uniqueId('owner');
  const otherId = uniqueId('other');
  await createUser({ id: ownerId, email: `${ownerId}@test.com` });
  await createUser({ id: otherId, email: `${otherId}@test.com` });
  const analysis = await runAnalysis({ source: 'owner-only' }, ownerId);

  const server = await startServer();
  try {
    const forbidden = await request(server, `/api/analyses/${analysis.id}`, {
      headers: { 'x-user-id': otherId }
    });
    assert.equal(forbidden.response.status, 403);

    const ownerList = await request(server, '/api/analyses', {
      headers: { 'x-user-id': ownerId }
    });
    const otherList = await request(server, '/api/analyses', {
      headers: { 'x-user-id': otherId }
    });

    assert.equal(ownerList.response.status, 200);
    assert.equal(otherList.response.status, 200);
    assert.equal(ownerList.body.length, 1);
    assert.equal(otherList.body.length, 0);
    assert.equal(ownerList.body[0].id, analysis.id);
  } finally {
    server.close();
  }
});

test('campaign routes enforce ownership isolation', async () => {
  const ownerId = uniqueId('owner');
  const otherId = uniqueId('other');
  await createUser({ id: ownerId, email: `${ownerId}@test.com` });
  await createUser({ id: otherId, email: `${otherId}@test.com` });

  const server = await startServer();
  try {
    const created = await request(server, '/api/campaigns', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': ownerId
      },
      body: JSON.stringify({ name: 'Owner Campaign' })
    });

    assert.equal(created.response.status, 200);

    const forbidden = await request(server, `/api/campaigns/${created.body.id}`, {
      headers: { 'x-user-id': otherId }
    });
    assert.equal(forbidden.response.status, 403);

    const ownerList = await request(server, '/api/campaigns', {
      headers: { 'x-user-id': ownerId }
    });
    const otherList = await request(server, '/api/campaigns', {
      headers: { 'x-user-id': otherId }
    });

    assert.equal(ownerList.body.length, 1);
    assert.equal(otherList.body.length, 0);
    assert.equal(ownerList.body[0].id, created.body.id);
  } finally {
    server.close();
  }
});

test('failed analysis flow writes analysis_failed history correctly', async () => {
  const userId = uniqueId('user');
  await createUser({ id: userId, email: `${userId}@test.com` });

  const originalUpdate = analysisRepository.updateAnalysis;
  analysisRepository.updateAnalysis = async () => {
    const error = new Error('Forced update failure');
    error.status = 500;
    throw error;
  };

  const server = await startServer();
  try {
    const result = await request(server, '/api/analyses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId
      },
      body: JSON.stringify({ source: 'test-failure' })
    });

    assert.equal(result.response.status, 500);
    const history = await listHistory();
    const failedEntry = history.find((entry) => entry.action_type === 'analysis_failed');

    assert.ok(failedEntry);
    assert.equal(failedEntry.user_id, userId);
    assert.equal(failedEntry.status, 'failed');
    assert.equal(failedEntry.metadata.phase, 'process');
    assert.equal(failedEntry.metadata.error_message, 'Forced update failure');
    assert.deepEqual(failedEntry.metadata.attempted_result_keys, ['source']);
  } finally {
    analysisRepository.updateAnalysis = originalUpdate;
    server.close();
  }
});
