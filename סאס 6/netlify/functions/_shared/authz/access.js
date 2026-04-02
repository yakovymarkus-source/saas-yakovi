const { getAdminClient } = require('../supabase');
const { AppError } = require('../errors');

const ROLE_WEIGHT = {
  member: 1,
  admin: 2,
  owner: 3,
};

function hasRequiredRole(actualRole, minRole = 'member') {
  return (ROLE_WEIGHT[actualRole] || 0) >= (ROLE_WEIGHT[minRole] || 0);
}

async function authorizeCampaignAccess({ userId, campaignId, minRole = 'member' }) {
  if (!userId) {
    throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'לא מורשה', devMessage: 'Missing userId for campaign authorization', status: 401 });
  }

  if (!campaignId) {
    return { authorized: true, role: 'owner' };
  }

  const sb = getAdminClient();
  const campaignResponse = await sb.from('campaigns').select('id,owner_user_id').eq('id', campaignId).maybeSingle();
  if (campaignResponse.error) {
    throw new AppError({
      code: 'DB_READ_FAILED',
      userMessage: 'בדיקת ההרשאה נכשלה',
      devMessage: campaignResponse.error.message,
      status: 500,
      details: { campaignId, userId },
    });
  }

  if (!campaignResponse.data) {
    throw new AppError({ code: 'FORBIDDEN', userMessage: 'אין לך הרשאה לקמפיין הזה', devMessage: `Campaign ${campaignId} not found`, status: 403, details: { campaignId, userId } });
  }

  if (campaignResponse.data.owner_user_id === userId) {
    if (!hasRequiredRole('owner', minRole)) {
      throw new AppError({ code: 'FORBIDDEN', userMessage: 'אין לך הרשאה לקמפיין הזה', devMessage: `Owner role does not satisfy ${minRole}`, status: 403, details: { campaignId, userId, minRole } });
    }
    return { authorized: true, role: 'owner', campaignId };
  }

  const membershipResponse = await sb.from('campaign_memberships').select('role').eq('campaign_id', campaignId).eq('user_id', userId).maybeSingle();
  if (membershipResponse.error) {
    throw new AppError({
      code: 'DB_READ_FAILED',
      userMessage: 'בדיקת ההרשאה נכשלה',
      devMessage: membershipResponse.error.message,
      status: 500,
      details: { campaignId, userId },
    });
  }

  const role = membershipResponse.data?.role;
  if (!role || !hasRequiredRole(role, minRole)) {
    throw new AppError({
      code: 'FORBIDDEN',
      userMessage: 'אין לך הרשאה לקמפיין הזה',
      devMessage: `User ${userId} lacks ${minRole} access to campaign ${campaignId}`,
      status: 403,
      details: { campaignId, userId, minRole, actualRole: role || null },
    });
  }

  return { authorized: true, role, campaignId };
}

module.exports = { authorizeCampaignAccess, hasRequiredRole };
