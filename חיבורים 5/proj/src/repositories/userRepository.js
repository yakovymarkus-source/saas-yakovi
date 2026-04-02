const { all, get, run, transaction, parseJson, serializeJson } = require('../storage/db');

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    analysis_history: parseJson(row.analysis_history, []),
    campaigns: parseJson(row.campaigns, []),
    linkage_summary: parseJson(row.linkage_summary, {
      analyses_count: 0,
      campaigns_count: 0,
      last_activity_at: null
    })
  };
}

async function getUserById(id) {
  return mapUser(get('SELECT * FROM users WHERE id = :id', { id }));
}

const upsertUserTx = transaction((user) => {
  const nextUser = {
    ...user,
    analysis_history: user.analysis_history || [],
    campaigns: user.campaigns || [],
    linkage_summary: user.linkage_summary || {
      analyses_count: (user.analysis_history || []).length,
      campaigns_count: (user.campaigns || []).length,
      last_activity_at: null
    }
  };

  run(
    `INSERT INTO users (id, email, analysis_history, campaigns, linkage_summary)
     VALUES (:id, :email, :analysis_history, :campaigns, :linkage_summary)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       analysis_history = excluded.analysis_history,
       campaigns = excluded.campaigns,
       linkage_summary = excluded.linkage_summary`,
    {
      id: nextUser.id,
      email: nextUser.email || null,
      analysis_history: serializeJson(nextUser.analysis_history, []),
      campaigns: serializeJson(nextUser.campaigns, []),
      linkage_summary: serializeJson(nextUser.linkage_summary, {
        analyses_count: 0,
        campaigns_count: 0,
        last_activity_at: null
      })
    }
  );

  return nextUser;
});

async function createUser(user) {
  return upsertUserTx(user);
}

async function updateUser(id, data) {
  const existing = await getUserById(id);
  if (!existing) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const updated = {
    ...existing,
    ...data,
    analysis_history: data.analysis_history || existing.analysis_history || [],
    campaigns: data.campaigns || existing.campaigns || [],
    linkage_summary: data.linkage_summary || existing.linkage_summary || {
      analyses_count: 0,
      campaigns_count: 0,
      last_activity_at: null
    }
  };

  return upsertUserTx({ ...updated, id });
}

async function listUsers() {
  return all('SELECT * FROM users ORDER BY id ASC').map(mapUser);
}

module.exports = { getUserById, createUser, updateUser, listUsers };
