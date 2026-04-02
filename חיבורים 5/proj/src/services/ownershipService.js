const { getAnalysisById } = require('../repositories/analysisRepository');
const { getCampaignById } = require('../repositories/campaignRepository');

function buildForbidden(message) {
  const error = new Error(message);
  error.status = 403;
  error.code = 'FORBIDDEN';
  return error;
}

async function assertOwnsAnalysis(userId, analysisId) {
  const analysis = await getAnalysisById(analysisId);
  if (!analysis) {
    const error = new Error('Analysis not found');
    error.status = 404;
    throw error;
  }
  if (analysis.user_id !== userId) {
    throw buildForbidden('Forbidden analysis access');
  }
  return analysis;
}

async function assertOwnsCampaign(userId, campaignId) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  if (campaign.user_id !== userId) {
    throw buildForbidden('Forbidden campaign access');
  }
  return campaign;
}

module.exports = { assertOwnsAnalysis, assertOwnsCampaign };
