const { all, get, run } = require('../storage/db');

function mapCampaign(row) {
  if (!row) {
    return null;
  }

  const payload = row.payload ? JSON.parse(row.payload) : {};
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    created_at: row.created_at,
    ...payload
  };
}

async function createCampaign(campaign) {
  const { id, user_id, name, created_at, ...payload } = campaign;
  run(
    `INSERT INTO campaigns (id, user_id, name, payload, created_at)
     VALUES (:id, :user_id, :name, :payload, :created_at)`,
    {
      id,
      user_id,
      name: name || null,
      payload: JSON.stringify(payload || {}),
      created_at
    }
  );
  return campaign;
}

async function getCampaignById(id) {
  return mapCampaign(get('SELECT * FROM campaigns WHERE id = :id', { id }));
}

async function listCampaigns() {
  return all('SELECT * FROM campaigns ORDER BY created_at DESC, id DESC').map(mapCampaign);
}

async function listCampaignsByUserId(userId) {
  return all('SELECT * FROM campaigns WHERE user_id = :user_id ORDER BY created_at DESC, id DESC', { user_id: userId }).map(mapCampaign);
}

module.exports = { createCampaign, getCampaignById, listCampaigns, listCampaignsByUserId };
