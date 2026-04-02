const { all, get, run, transaction, parseJson, serializeJson } = require('../storage/db');

function mapAnalysis(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    user_id: row.user_id,
    input: parseJson(row.input, {}),
    status: row.status,
    result: parseJson(row.result, null),
    created_at: row.created_at,
    processed_at: row.processed_at || null
  };
}

async function getAnalysisById(id) {
  return mapAnalysis(get('SELECT * FROM analyses WHERE id = :id', { id }));
}

async function createAnalysis(analysis) {
  run(
    `INSERT INTO analyses (id, user_id, input, status, result, created_at, processed_at)
     VALUES (:id, :user_id, :input, :status, :result, :created_at, :processed_at)`,
    {
      id: analysis.id,
      user_id: analysis.user_id,
      input: serializeJson(analysis.input, {}),
      status: analysis.status,
      result: serializeJson(analysis.result, null),
      created_at: analysis.created_at,
      processed_at: analysis.processed_at || null
    }
  );
  return analysis;
}

const updateAnalysisTx = transaction((id, data) => {
  const row = get('SELECT * FROM analyses WHERE id = :id', { id });
  if (!row) {
    const error = new Error('Analysis not found');
    error.status = 404;
    throw error;
  }

  const existing = mapAnalysis(row);
  const updated = { ...existing, ...data, id };

  run(
    `UPDATE analyses
     SET user_id = :user_id,
         input = :input,
         status = :status,
         result = :result,
         created_at = :created_at,
         processed_at = :processed_at
     WHERE id = :id`,
    {
      id,
      user_id: updated.user_id,
      input: serializeJson(updated.input, {}),
      status: updated.status,
      result: serializeJson(updated.result, null),
      created_at: updated.created_at,
      processed_at: updated.processed_at || null
    }
  );

  return updated;
});

async function updateAnalysis(id, data) {
  return updateAnalysisTx(id, data);
}

async function listAnalyses() {
  return all('SELECT * FROM analyses ORDER BY created_at DESC, id DESC').map(mapAnalysis);
}

async function listAnalysesByUserId(userId) {
  return all('SELECT * FROM analyses WHERE user_id = :user_id ORDER BY created_at DESC, id DESC', { user_id: userId }).map(mapAnalysis);
}

module.exports = { getAnalysisById, createAnalysis, updateAnalysis, listAnalyses, listAnalysesByUserId };
