const express = require('express');
const { authContext } = require('../middleware/authContext');
const { requireUserId } = require('../lib/requireUserId');
const { asyncHandler } = require('../middleware/asyncHandler');
const { runAnalysis } = require('../brain/runAnalysis');
const { listAnalysesByUserId } = require('../repositories/analysisRepository');
const { assertOwnsAnalysis } = require('../services/ownershipService');

const router = express.Router();

router.post(
  '/analyses',
  authContext,
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req.userId, 'analysisRoutes.POST /analyses');
    const result = await runAnalysis(req.body, userId);
    res.json(result);
  })
);

router.get(
  '/analyses/:id',
  authContext,
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req.userId, 'analysisRoutes.GET /analyses/:id');
    const analysis = await assertOwnsAnalysis(userId, req.params.id);
    res.json(analysis);
  })
);

router.get(
  '/analyses',
  authContext,
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req.userId, 'analysisRoutes.GET /analyses');
    res.json(await listAnalysesByUserId(userId));
  })
);

module.exports = router;
