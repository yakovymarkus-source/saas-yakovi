const userRepo = require("../repositories/userRepository");

async function syncUserLinkageSummary(userId) {
  const user = await userRepo.getUserById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const linkageSummary = {
    analyses_count: (user.analysis_history || []).length,
    campaigns_count: (user.campaigns || []).length,
    last_activity_at: new Date().toISOString()
  };

  return userRepo.updateUser(userId, {
    ...user,
    linkage_summary: linkageSummary
  });
}

async function appendAnalysisToUser(userId, analysisId) {
  const user = await userRepo.getUserById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const analysisHistory = user.analysis_history || [];
  if (!analysisHistory.includes(analysisId)) {
    analysisHistory.push(analysisId);
  }

  const updatedUser = await userRepo.updateUser(userId, {
    ...user,
    analysis_history: analysisHistory
  });

  await syncUserLinkageSummary(userId);
  return updatedUser;
}

async function appendCampaignToUser(userId, campaignId) {
  const user = await userRepo.getUserById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const campaigns = user.campaigns || [];
  if (!campaigns.includes(campaignId)) {
    campaigns.push(campaignId);
  }

  const updatedUser = await userRepo.updateUser(userId, {
    ...user,
    campaigns
  });

  await syncUserLinkageSummary(userId);
  return updatedUser;
}

module.exports = { appendAnalysisToUser, appendCampaignToUser, syncUserLinkageSummary };
