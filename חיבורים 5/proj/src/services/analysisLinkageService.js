const crypto = require('crypto');
const analysisRepo = require('../repositories/analysisRepository');
const historyRepo = require('../repositories/historyRepository');
const userRepo = require('../repositories/userRepository');
const { requireUserId } = require('../lib/requireUserId');
const { appendAnalysisToUser, syncUserLinkageSummary } = require('./userLinkageService');
const { assertOwnsAnalysis } = require('./ownershipService');

function createId() {
  return 'analysis_' + crypto.randomUUID();
}

async function assertUserExists(userId) {
  const user = await userRepo.getUserById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  return user;
}

async function createAnalysis(input, userId) {
  const requiredUserId = requireUserId(userId, 'analysisLinkageService.createAnalysis');
  await assertUserExists(requiredUserId);

  const analysis = {
    id: createId(),
    user_id: requiredUserId,
    input,
    status: 'created',
    created_at: new Date().toISOString()
  };

  await analysisRepo.createAnalysis(analysis);
  await appendAnalysisToUser(requiredUserId, analysis.id);
  await historyRepo.logHistory({
    action_type: 'analysis_created',
    user_id: requiredUserId,
    entity_type: 'analysis',
    entity_id: analysis.id,
    analysis_id: analysis.id,
    status: 'success',
    metadata: {
      phase: 'create',
      input_keys: Object.keys(input || {})
    },
    created_at: new Date().toISOString()
  });
  await syncUserLinkageSummary(requiredUserId);

  return analysis;
}

async function processAnalysis(analysisId, userId, data) {
  const requiredUserId = requireUserId(userId, 'analysisLinkageService.processAnalysis');
  await assertUserExists(requiredUserId);

  let ownedAnalysis = null;

  try {
    ownedAnalysis = await assertOwnsAnalysis(requiredUserId, analysisId);

    const analysis = await analysisRepo.updateAnalysis(analysisId, {
      user_id: ownedAnalysis.user_id,
      status: 'processed',
      result: data,
      processed_at: new Date().toISOString()
    });

    await appendAnalysisToUser(requiredUserId, analysisId);
    await historyRepo.logHistory({
      action_type: 'analysis_processed',
      user_id: ownedAnalysis.user_id,
      entity_type: 'analysis',
      entity_id: analysisId,
      analysis_id: analysisId,
      status: 'success',
      metadata: {
        phase: 'process',
        result_keys: Object.keys(data || {})
      },
      created_at: new Date().toISOString()
    });
    await syncUserLinkageSummary(requiredUserId);

    return analysis;
  } catch (error) {
    await historyRepo.logHistory({
      action_type: 'analysis_failed',
      user_id: ownedAnalysis ? ownedAnalysis.user_id : requiredUserId,
      entity_type: 'analysis',
      entity_id: analysisId,
      analysis_id: analysisId,
      status: 'failed',
      metadata: {
        phase: 'process',
        error_message: error.message,
        attempted_result_keys: Object.keys(data || {})
      },
      created_at: new Date().toISOString()
    });
    throw error;
  }
}

module.exports = { createAnalysis, processAnalysis, assertUserExists };
