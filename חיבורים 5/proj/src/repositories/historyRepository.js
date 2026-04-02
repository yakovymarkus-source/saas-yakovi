const { all, run, parseJson, serializeJson } = require('../storage/db');

function mapHistory(row) {
  if (!row) {
    return null;
  }

  return {
    action_type: row.action_type,
    user_id: row.user_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    campaign_id: row.campaign_id || null,
    analysis_id: row.analysis_id || null,
    status: row.status || 'success',
    metadata: parseJson(row.metadata, {}),
    created_at: row.created_at
  };
}

async function logHistory(entry) {
  const nextEntry = {
    action_type: entry.action_type,
    user_id: entry.user_id,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    campaign_id: entry.campaign_id || null,
    analysis_id: entry.analysis_id || null,
    status: entry.status || 'success',
    metadata: entry.metadata || {},
    created_at: entry.created_at || new Date().toISOString()
  };

  run(
    `INSERT INTO history (action_type, user_id, entity_type, entity_id, campaign_id, analysis_id, status, metadata, created_at)
     VALUES (:action_type, :user_id, :entity_type, :entity_id, :campaign_id, :analysis_id, :status, :metadata, :created_at)`,
    {
      ...nextEntry,
      metadata: serializeJson(nextEntry.metadata, {})
    }
  );

  return nextEntry;
}

async function listHistory() {
  return all('SELECT * FROM history ORDER BY created_at ASC, id ASC').map(mapHistory);
}

module.exports = { logHistory, listHistory };
