const express = require('express');
const crypto = require('crypto');
const { authContext } = require('../middleware/authContext');
const { requireUserId } = require('../lib/requireUserId');
const { asyncHandler } = require('../middleware/asyncHandler');
const { createCampaign, listCampaignsByUserId } = require('../repositories/campaignRepository');
const { logHistory } = require('../repositories/historyRepository');
const { appendCampaignToUser } = require('../services/userLinkageService');
const { assertUserExists } = require('../services/analysisLinkageService');
const { assertOwnsCampaign } = require('../services/ownershipService');

const router = express.Router();

const SYSTEM_FIELDS = new Set(['id', 'user_id', 'created_at']);

router.post(
  '/campaigns',
  authContext,
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req.userId, 'campaignRoutes.POST /campaigns');
    await assertUserExists(userId);

    const extraPayload = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => !SYSTEM_FIELDS.has(key) && key !== 'name')
    );

    const campaign = {
      id: 'campaign_' + crypto.randomUUID(),
      user_id: userId,
      name: req.body.name || 'Untitled campaign',
      created_at: new Date().toISOString(),
      ...extraPayload
    };

    await createCampaign(campaign);
    await appendCampaignToUser(userId, campaign.id);
    await logHistory({
      action_type: 'campaign_created',
      user_id: userId,
      entity_type: 'campaign',
      entity_id: campaign.id,
      campaign_id: campaign.id,
      status: 'success',
      metadata: {
        campaign_name: campaign.name,
        body_keys: Object.keys(req.body || {})
      },
      created_at: new Date().toISOString()
    });

    res.json(campaign);
  })
);

router.get(
  '/campaigns/:id',
  authContext,
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req.userId, 'campaignRoutes.GET /campaigns/:id');
    const campaign = await assertOwnsCampaign(userId, req.params.id);
    res.json(campaign);
  })
);

router.get(
  '/campaigns',
  authContext,
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req.userId, 'campaignRoutes.GET /campaigns');
    res.json(await listCampaignsByUserId(userId));
  })
);

module.exports = router;
