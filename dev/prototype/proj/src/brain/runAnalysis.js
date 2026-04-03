const { requireUserId } = require("../lib/requireUserId");
const { createAnalysis, processAnalysis } = require("../services/analysisLinkageService");

async function runAnalysis(input, userId) {
  const requiredUserId = requireUserId(userId, "brain.runAnalysis");
  const analysis = await createAnalysis(input, requiredUserId);
  return processAnalysis(analysis.id, requiredUserId, input);
}

module.exports = { runAnalysis };
