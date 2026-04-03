const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { runAnalysis } = require('../../src/engine/pipeline');
const { resetAndSeed } = require('../helpers/testSetup');
const {
  state,
  seedUser,
  createCampaign,
  listHistory,
  listAnalysesByUser,
  getUser,
  getAnalysis,
  deleteAnalysis,
  syncUserLinkageSummary
} = require('../../src/repositories/db');

describe('Pipeline', () => {

function createPrng(seed) {
  let value = seed >>> 0;
  return function next() {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function snapshotState() {
  return {
    analyses: [...state.analyses.values()]
      .map((item) => ({
        id: item.id,
        user_id: item.user_id,
        campaign_id: item.campaign_id,
        status: item.status,
        verdict: item.output ? item.output.summary.verdict : null,
        severity: item.output ? item.output.summary.severity : null,
        score: item.input ? item.input.score : null
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    campaigns: [...state.campaigns.values()]
      .map((item) => ({ id: item.id, user_id: item.user_id, name: item.name }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    history: state.history.map((entry) => ({
      action_type: entry.action_type,
      user_id: entry.user_id,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      analysis_id: entry.analysis_id,
      campaign_id: entry.campaign_id,
      status: entry.status,
      metadata: entry.metadata
    })),
    users: [...state.users.values()]
      .map((user) => ({
        id: user.id,
        analysis_history: [...user.analysis_history],
        campaign_history: [...user.campaign_history]
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
}

function assertStateIntegrity(userIds = ['userA', 'userB', 'userC']) {
  for (const userId of userIds) {
    const analysisIds = listAnalysesByUser(userId).map((item) => item.id);
    assert.deepEqual(getUser(userId).analysis_history, analysisIds);
    assert.ok(listAnalysesByUser(userId).every((item) => item.user_id === userId));

    const campaignIds = [...state.campaigns.values()]
      .filter((item) => item.user_id === userId)
      .map((item) => item.id);
    assert.deepEqual(getUser(userId).campaign_history, campaignIds);
  }

  for (const entry of state.history) {
    assert.ok(entry.entity_type === 'analysis');
    if (entry.analysis_id !== null) {
      const live = getAnalysis(entry.analysis_id);
      assert.ok(!live || live.user_id === entry.user_id);
    }
  }
}

async function runDeterministicScenario() {
  seedUser('userC');
  const ownedCampaigns = {
    userA: createCampaign({ userId: 'userA', name: 'repeat-A' }).id,
    userB: createCampaign({ userId: 'userB', name: 'repeat-B' }).id,
    userC: createCampaign({ userId: 'userC', name: 'repeat-C' }).id
  };
  syncUserLinkageSummary('userA');
  syncUserLinkageSummary('userB');
  syncUserLinkageSummary('userC');
  const active = { userA: [], userB: [], userC: [] };

  for (let index = 0; index < 18; index += 1) {
    const userId = ['userA', 'userB', 'userC'][index % 3];
    if (index % 5 === 4 && active[userId].length) {
      deleteAnalysis(active[userId].shift());
      syncUserLinkageSummary(userId);
    }

    const result = await runAnalysis({
      score: 40 + index,
      ctr: 1 + (index % 3),
      cpc: 0.6 + ((index % 4) * 0.2),
      convRate: 2 + (index % 4),
      ...(index % 2 === 0
        ? { campaignId: ownedCampaigns[userId] }
        : { campaignName: `${userId}-repeat-${index}` })
    }, { id: userId });

    active[userId].push(result.analysisId);
    assertStateIntegrity(['userA', 'userB', 'userC']);
  }

  return snapshotState();
}

  beforeEach(() => {
    resetAndSeed();
  });

  test('runs full pipeline successfully with persistence, linkage and history', async () => {
    const result = await runAnalysis({ score: 45, ctr: 2.4, cpc: 1.1, convRate: 1.5, campaignName: 'Alpha' }, { id: 'userA' });

    assert.equal(result.userId, 'userA');
    assert.equal(result.summary.verdict, 'Landing page issue');
    assert.equal(listAnalysesByUser('userA').length, 1);
    assert.equal(state.campaigns.size, 1);

    const history = listHistory({ user_id: 'userA' });
    assert.deepEqual(history.map((x) => x.action_type), ['analysis_created', 'analysis_processed']);
    assert.deepEqual(getUser('userA').analysis_history, [result.analysisId]);
    assert.equal(getUser('userA').campaign_history.length, 1);
    assert.equal(history[0].entity_type, 'analysis');
    assert.equal(history[0].entity_id, result.analysisId);
    assert.equal(history[0].campaign_id, result.campaignId);
    assert.equal(history[0].status, 'created');
    assert.deepEqual(history[0].metadata, { score: 45 });
    assert.ok(history[0].created_at);
    assert.ok(getAnalysis(result.analysisId));
  });

  test('supports existing campaign owned by authenticated user', async () => {
    const campaign = createCampaign({ userId: 'userA', name: 'Retargeting' });
    const result = await runAnalysis({ score: 85, ctr: 3, cpc: 0.8, convRate: 5, campaignId: campaign.id }, { id: 'userA' });

    assert.equal(result.campaignId, campaign.id);
    assert.equal(result.summary.verdict, 'Healthy campaign');
    const history = listHistory({ user_id: 'userA', analysis_id: result.analysisId });
    assert.equal(history.length, 2);
    assert.ok(history.every((entry) => entry.campaign_id === campaign.id));
    assert.deepEqual(getUser('userA').campaign_history, [campaign.id]);
  });

  test('rejects missing or foreign campaignId before analysis creation', async () => {
    const foreignCampaign = createCampaign({ userId: 'userB', name: 'Foreign' });

    await assert.rejects(() => runAnalysis({ score: 55, campaignId: 'campaign_999' }, { id: 'userA' }), /Campaign not found/);
    await assert.rejects(() => runAnalysis({ score: 55, campaignId: foreignCampaign.id }, { id: 'userA' }), /Campaign not found/);

    const history = listHistory({ user_id: 'userA' });
    assert.equal(history.length, 0);
    assert.equal(listAnalysesByUser('userA').length, 0);
    assert.deepEqual(getUser('userA').analysis_history, []);
  });

  test('failure after analysis creation writes analysis_failed and leaves no orphan records', async () => {
    const campaign = createCampaign({ userId: 'userA', name: 'Broken' });

    await assert.rejects(
      () => runAnalysis({ score: Infinity, ctr: 2, cpc: 1, convRate: 4, campaignId: campaign.id }, { id: 'userA' }),
      /Invalid numeric field: score/
    );

    assert.equal(listAnalysesByUser('userA').length, 0);
    const history = listHistory({ user_id: 'userA' });
    assert.deepEqual(history.map((x) => x.action_type), ['analysis_created', 'analysis_failed']);
    assert.ok(history.every((entry) => entry.campaign_id === campaign.id));
    assert.equal(history[0].status, 'created');
    assert.equal(history[1].status, 'failed');
    assert.equal(history[1].entity_type, 'analysis');
    assert.equal(history[1].entity_id, history[0].analysis_id);
    assert.equal(history[1].metadata.code, 'ERROR');
    assert.deepEqual(getUser('userA').analysis_history, []);
    assert.deepEqual(getUser('userA').campaign_history, [campaign.id]);
  });

  test('rejects unauthorized execution before any state is written', async () => {
    await assert.rejects(() => runAnalysis({ score: 40 }, null), /User is required/);
    assert.equal(state.analyses.size, 0);
    assert.equal(state.history.length, 0);
  });

  test('failure after analysis creation without campaign keeps null linkage in failure history', async () => {
    await assert.rejects(
      () => runAnalysis({ score: Infinity, ctr: 2, cpc: 1, convRate: 4 }, { id: 'userA' }),
      /Invalid numeric field: score/
    );

    const history = listHistory({ user_id: 'userA' });
    assert.deepEqual(history.map((entry) => entry.action_type), ['analysis_created', 'analysis_failed']);
    assert.equal(history[0].campaign_id, null);
    assert.equal(history[1].campaign_id, null);
  });

  test('rejects user objects that exist but have no id', async () => {
    await assert.rejects(() => runAnalysis({ score: 40 }, {}), /User is required/);
    assert.equal(state.analyses.size, 0);
    assert.equal(state.history.length, 0);
  });

  test('uses fallback ERROR code for failures before analysis creation when error.code is missing', async () => {
    const input = {
      get score() {
        throw new Error('pre-create explosion');
      }
    };

    await assert.rejects(() => runAnalysis(input, { id: 'userA' }), /pre-create explosion/);

    const history = listHistory({ user_id: 'userA' });
    assert.deepEqual(history.map((entry) => entry.action_type), ['analysis_failed']);
    assert.equal(history[0].analysis_id, null);
    assert.equal(history[0].metadata.code, 'ERROR');
  });

  test('preserves explicit error codes for failures after analysis creation', async () => {
    let reads = 0;
    const input = {
      get score() {
        reads += 1;
        if (reads === 1) return 55;
        const error = new Error('score accessor exploded');
        error.code = 'SCORE_READ_FAIL';
        throw error;
      }
    };

    await assert.rejects(() => runAnalysis(input, { id: 'userA' }), /score accessor exploded/);

    const history = listHistory({ user_id: 'userA' });
    assert.deepEqual(history.map((entry) => entry.action_type), ['analysis_failed']);
    assert.equal(history[0].metadata.code, 'SCORE_READ_FAIL');
    assert.equal(history[0].analysis_id !== null, true);
    assert.equal(listAnalysesByUser('userA').length, 0);
  });

  test('rejects invalid shapes according to current validation behavior', async () => {
    await assert.rejects(() => runAnalysis(null, { id: 'userA' }), /Invalid analysis input/);
    await assert.rejects(() => runAnalysis([], { id: 'userA' }), /score is required/);
    await assert.rejects(() => runAnalysis({ score: '42' }, { id: 'userA' }), /score is required/);

    const history = listHistory({ user_id: 'userA' });
    assert.equal(history.length, 3);
    assert.ok(history.every((entry) => entry.action_type === 'analysis_failed'));
    assert.ok(history.every((entry) => entry.analysis_id === null));
  });

  test('treats truthy primitive input as invalid without creating campaign side effects', async () => {
    await assert.rejects(() => runAnalysis('hello', { id: 'userA' }), /Invalid analysis input/);
    assert.equal(state.campaigns.size, 0);
    const history = listHistory({ user_id: 'userA' });
    assert.equal(history.length, 1);
    assert.equal(history[0].campaign_id, null);
  });

  test('state remains isolated across sequential multi-user operations', async () => {
    seedUser('userC');
    const campaignA = createCampaign({ userId: 'userA', name: 'A-campaign' });
    const campaignB = createCampaign({ userId: 'userB', name: 'B-campaign' });

    const resultA = await runAnalysis({ score: 81, campaignId: campaignA.id }, { id: 'userA' });
    const resultB = await runAnalysis({ score: 35, ctr: 0.8, cpc: 2.5, convRate: 1.5, campaignId: campaignB.id }, { id: 'userB' });

    assert.deepEqual(listAnalysesByUser('userA').map((x) => x.id), [resultA.analysisId]);
    assert.deepEqual(listAnalysesByUser('userB').map((x) => x.id), [resultB.analysisId]);
    assert.deepEqual(getUser('userA').analysis_history, [resultA.analysisId]);
    assert.deepEqual(getUser('userB').analysis_history, [resultB.analysisId]);
    assert.deepEqual(getUser('userC').analysis_history, []);
    assert.deepEqual(listHistory({ user_id: 'userA' }).map((x) => x.analysis_id), [resultA.analysisId, resultA.analysisId]);
    assert.deepEqual(listHistory({ user_id: 'userB' }).map((x) => x.analysis_id), [resultB.analysisId, resultB.analysisId]);
  });

  test('supports concurrent analysis creation without overwrite or cross-user leakage', async () => {
    seedUser('userC');

    const jobs = [
      runAnalysis({ score: 82, ctr: 2.8, cpc: 0.9, convRate: 5, campaignName: 'A1' }, { id: 'userA' }),
      runAnalysis({ score: 37, ctr: 0.9, cpc: 2.4, convRate: 1.2, campaignName: 'B1' }, { id: 'userB' }),
      runAnalysis({ score: 61, ctr: 1.8, cpc: 1.4, convRate: 2.1, campaignName: 'A2' }, { id: 'userA' }),
      runAnalysis({ score: 90, ctr: 3.2, cpc: 0.7, convRate: 5.3, campaignName: 'C1' }, { id: 'userC' })
    ];

    const results = await Promise.all(jobs);
    const ids = results.map((result) => result.analysisId);
    assert.equal(new Set(ids).size, results.length);
    assert.equal(state.analyses.size, 4);
    assert.equal(state.campaigns.size, 4);
    assert.deepEqual(listAnalysesByUser('userA').map((item) => item.id).sort(), ids.filter((id) => getAnalysis(id).user_id === 'userA').sort());
    assert.deepEqual(listAnalysesByUser('userB').map((item) => item.id), ids.filter((id) => getAnalysis(id).user_id === 'userB'));
    assert.deepEqual(listAnalysesByUser('userC').map((item) => item.id), ids.filter((id) => getAnalysis(id).user_id === 'userC'));
    assert.ok(results.every((result) => getAnalysis(result.analysisId).campaign_id === result.campaignId));
    assert.ok(listHistory({}).every((entry) => entry.user_id === getAnalysis(entry.analysis_id).user_id));
    assert.deepEqual(getUser('userA').analysis_history.slice().sort(), listAnalysesByUser('userA').map((item) => item.id).sort());
    assert.deepEqual(getUser('userB').analysis_history, listAnalysesByUser('userB').map((item) => item.id));
    assert.deepEqual(getUser('userC').analysis_history, listAnalysesByUser('userC').map((item) => item.id));
  });

  test('remains consistent when delete and create happen at the same time', async () => {
    const existing = await runAnalysis({ score: 71, ctr: 2.4, cpc: 1.1, convRate: 4.2, campaignName: 'existing' }, { id: 'userA' });
    const analysisBeforeDelete = getAnalysis(existing.analysisId);
    assert.ok(analysisBeforeDelete);

    const deleteTask = Promise.resolve().then(() => deleteAnalysis(existing.analysisId));
    const createTask = Promise.resolve().then(() => runAnalysis({ score: 88, ctr: 3, cpc: 0.8, convRate: 5.4, campaignName: 'replacement' }, { id: 'userA' }));

    const [, created] = await Promise.all([deleteTask, createTask]);

    assert.equal(getAnalysis(existing.analysisId), null);
    assert.ok(getAnalysis(created.analysisId));
    assert.equal(state.analyses.size, 1);
    assert.deepEqual(listAnalysesByUser('userA').map((item) => item.id), [created.analysisId]);
    assert.deepEqual(getUser('userA').analysis_history, [created.analysisId]);
    assert.ok(listHistory({ user_id: 'userA' }).some((entry) => entry.analysis_id === existing.analysisId));
    assert.ok(listHistory({ user_id: 'userA' }).some((entry) => entry.analysis_id === created.analysisId));
  });

  test('stays stable under mixed sequential multi-user load', async () => {
    seedUser('userC');
    const ownedCampaigns = {
      userA: createCampaign({ userId: 'userA', name: 'owned-A' }).id,
      userB: createCampaign({ userId: 'userB', name: 'owned-B' }).id,
      userC: createCampaign({ userId: 'userC', name: 'owned-C' }).id
    };
    const activeByUser = { userA: [], userB: [], userC: [] };
    const decisions = [];

    for (let index = 0; index < 72; index += 1) {
      const userId = ['userA', 'userB', 'userC'][index % 3];
      if (index % 6 === 5 && activeByUser[userId].length) {
        const removed = activeByUser[userId].shift();
        deleteAnalysis(removed);
      }

      const useExistingCampaign = index % 4 === 0;
      const payload = {
        score: 30 + (index % 50),
        ctr: 0.8 + (index % 5),
        cpc: 0.5 + ((index % 4) * 0.3),
        convRate: 1 + (index % 6),
        ...(useExistingCampaign
          ? { campaignId: ownedCampaigns[userId] }
          : { campaignName: `${userId}-campaign-${index}` })
      };

      const output = await runAnalysis(payload, { id: userId });
      decisions.push(JSON.stringify(output.decision));
      activeByUser[userId].push(output.analysisId);

      assert.deepEqual(listAnalysesByUser(userId).map((item) => item.id), activeByUser[userId]);
      assert.deepEqual(getUser(userId).analysis_history, activeByUser[userId]);
      assert.ok(listHistory({ user_id: userId }).every((entry) => entry.analysis_id === null || activeByUser[userId].includes(entry.analysis_id) || !getAnalysis(entry.analysis_id)));
    }

    assert.equal(new Set(decisions).size <= decisions.length, true);
    assert.deepEqual(getUser('userA').analysis_history, listAnalysesByUser('userA').map((item) => item.id));
    assert.deepEqual(getUser('userB').analysis_history, listAnalysesByUser('userB').map((item) => item.id));
    assert.deepEqual(getUser('userC').analysis_history, listAnalysesByUser('userC').map((item) => item.id));
    assert.ok(listAnalysesByUser('userA').every((item) => item.user_id === 'userA'));
    assert.ok(listAnalysesByUser('userB').every((item) => item.user_id === 'userB'));
    assert.ok(listAnalysesByUser('userC').every((item) => item.user_id === 'userC'));
    assert.ok(state.history.every((entry) => entry.analysis_id === null || entry.user_id === null || !getAnalysis(entry.analysis_id) || getAnalysis(entry.analysis_id).user_id === entry.user_id));
    assert.equal(listHistory({ action_type: 'analysis_failed' }).length, 0);
  });


  test('keeps consistent final state during interleaved create delete and same-entity update race', async () => {
    const initial = await runAnalysis({ score: 76, ctr: 2.2, cpc: 1.1, convRate: 4.1, campaignName: 'race-base' }, { id: 'userA' });
    const liveBeforeRace = getAnalysis(initial.analysisId);
    assert.ok(liveBeforeRace);

    const createPromise = Promise.resolve().then(() => runAnalysis({
      score: 83,
      ctr: 2.9,
      cpc: 0.9,
      convRate: 5,
      campaignName: 'race-new'
    }, { id: 'userA' }));

    const updatePromise = new Promise((resolve) => {
      setImmediate(() => {
        const live = getAnalysis(initial.analysisId);
        if (live) {
          live.status = 'updated-during-race';
          live.output = {
            ...live.output,
            summary: { ...live.output.summary, verdict: 'Race touched' }
          };
        }
        syncUserLinkageSummary('userA');
        resolve(live ? live.id : null);
      });
    });

    const deletePromise = new Promise((resolve) => {
      setImmediate(() => {
        deleteAnalysis(initial.analysisId);
        syncUserLinkageSummary('userA');
        resolve(true);
      });
    });

    const [created, touchedId] = await Promise.all([createPromise, updatePromise, deletePromise]).then((results) => [results[0], results[1]]);

    assert.equal(touchedId, initial.analysisId);
    assert.equal(getAnalysis(initial.analysisId), null);
    assert.ok(getAnalysis(created.analysisId));
    assert.deepEqual(listAnalysesByUser('userA').map((item) => item.id), [created.analysisId]);
    assert.deepEqual(getUser('userA').analysis_history, [created.analysisId]);
    assert.equal(state.analyses.size, 1);
    assert.ok(state.history.some((entry) => entry.analysis_id === initial.analysisId && entry.action_type === 'analysis_processed'));
    assert.ok(state.history.some((entry) => entry.analysis_id === created.analysisId && entry.action_type === 'analysis_processed'));
    assertStateIntegrity(['userA']);
  });

  test('survives deterministic chaos mix of valid invalid create and delete operations without inconsistent state', async () => {
    seedUser('userC');
    const prng = createPrng(1337);
    const ownedCampaigns = {
      userA: createCampaign({ userId: 'userA', name: 'chaos-A' }).id,
      userB: createCampaign({ userId: 'userB', name: 'chaos-B' }).id,
      userC: createCampaign({ userId: 'userC', name: 'chaos-C' }).id
    };
    syncUserLinkageSummary('userA');
    syncUserLinkageSummary('userB');
    syncUserLinkageSummary('userC');
    const active = { userA: [], userB: [], userC: [] };
    const failures = [];

    for (let step = 0; step < 80; step += 1) {
      const userId = ['userA', 'userB', 'userC'][Math.floor(prng() * 3)];
      const action = Math.floor(prng() * 3);

      if (action === 2 && active[userId].length) {
        const targetIndex = Math.floor(prng() * active[userId].length);
        const [targetId] = active[userId].splice(targetIndex, 1);
        deleteAnalysis(targetId);
        syncUserLinkageSummary(userId);
      } else {
        const invalidMode = Math.floor(prng() * 5) === 0;
        const payload = invalidMode
          ? [null, [], { score: '42' }, { campaignId: 'missing', score: 55 }, { score: Infinity }][Math.floor(prng() * 5)]
          : {
              score: 30 + Math.floor(prng() * 70),
              ctr: 0.5 + (Math.floor(prng() * 30) / 10),
              cpc: 0.5 + (Math.floor(prng() * 20) / 10),
              convRate: 1 + Math.floor(prng() * 5),
              ...(Math.floor(prng() * 2) === 0
                ? { campaignId: ownedCampaigns[userId] }
                : { campaignName: `${userId}-chaos-${step}` })
            };

        try {
          const result = await runAnalysis(payload, { id: userId });
          active[userId].push(result.analysisId);
        } catch (error) {
          failures.push(error.code || 'ERROR');
        }
      }

      assertStateIntegrity(['userA', 'userB', 'userC']);
      assert.ok([...state.analyses.keys()].every((analysisId) => state.history.some((entry) => entry.analysis_id === analysisId && entry.action_type === 'analysis_processed')));
    }

    assert.ok(failures.length > 0);
    assert.ok(state.history.every((entry) => entry.analysis_id === null || entry.entity_id === entry.analysis_id));
    assert.ok(state.history.every((entry) => entry.analysis_id === null || entry.user_id === null || !getAnalysis(entry.analysis_id) || getAnalysis(entry.analysis_id).user_id === entry.user_id));
    assert.equal(listHistory({ action_type: 'analysis_failed' }).every((entry) => entry.status === 'failed'), true);
  });

  test('preserves created then processed or failed history order under concurrent load', async () => {
    seedUser('userC');
    const ownedCampaign = createCampaign({ userId: 'userA', name: 'timeline-A' });

    const settled = await Promise.allSettled([
      runAnalysis({ score: 91, ctr: 3.1, cpc: 0.8, convRate: 5.2, campaignId: ownedCampaign.id }, { id: 'userA' }),
      runAnalysis({ score: 62, ctr: 1.7, cpc: 1.5, convRate: 2.3, campaignName: 'timeline-new' }, { id: 'userA' }),
      runAnalysis({ score: Infinity, ctr: 2, cpc: 1, convRate: 4, campaignId: ownedCampaign.id }, { id: 'userA' }),
      runAnalysis({ score: 'bad' }, { id: 'userA' })
    ]);

    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 2);
    assert.equal(settled.filter((item) => item.status === 'rejected').length, 2);

    const byAnalysis = new Map();
    for (const entry of listHistory({ user_id: 'userA' })) {
      const key = entry.analysis_id === null ? `null-${entry.metadata.message}` : entry.analysis_id;
      const arr = byAnalysis.get(key) || [];
      arr.push(entry);
      byAnalysis.set(key, arr);
    }

    for (const [key, entries] of byAnalysis.entries()) {
      if (String(key).startsWith('null-')) {
        assert.deepEqual(entries.map((entry) => entry.action_type), ['analysis_failed']);
        continue;
      }
      assert.equal(entries[0].action_type, 'analysis_created');
      assert.ok(['analysis_processed', 'analysis_failed'].includes(entries[1].action_type));
      assert.equal(entries[0].entity_id, entries[1].entity_id);
      assert.equal(entries[0].analysis_id, entries[1].analysis_id);
      assert.equal(entries[0].campaign_id, entries[1].campaign_id);
      assert.ok(Date.parse(entries[0].created_at) <= Date.parse(entries[1].created_at));
    }
  });

  test('produces identical snapshots across repeated full runs in the same process', async () => {
    const snapshots = [];

    for (let run = 0; run < 3; run += 1) {
      resetAndSeed();
      snapshots.push(await runDeterministicScenario());
    }

    assert.deepEqual(snapshots[0], snapshots[1]);
    assert.deepEqual(snapshots[1], snapshots[2]);
  });

  test('returned output structure is stable', async () => {
    const result = await runAnalysis({ score: 92, ctr: 3.1, cpc: 0.9, convRate: 5.2 }, { id: 'userA' });
    assert.deepEqual(Object.keys(result).sort(), ['analysisId', 'campaignId', 'decision', 'summary', 'userId'].sort());
    assert.equal(typeof result.decision.priority, 'number');
    assert.equal(typeof result.summary.severity, 'string');
    assert.equal(result.campaignId, null);
  });
});
