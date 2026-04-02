const { randomUUID } = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function delay(ms = 0) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeValue(value) {
  if (value === undefined) return null;
  return clone(value);
}

function roleRank(role) {
  return { owner: 3, admin: 2, member: 1 }[role] || 0;
}

class Mutex {
  constructor() {
    this.queue = Promise.resolve();
  }

  async run(task) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

class QueryBuilder {
  constructor(client, table, mode = 'select') {
    this.client = client;
    this.table = table;
    this.mode = mode;
    this.filters = [];
    this.selectedColumns = '*';
    this.insertPayload = null;
    this.updatePayload = null;
    this.ordering = null;
    this.limitValue = null;
  }

  select(columns = '*') {
    this.selectedColumns = columns || '*';
    return this;
  }

  insert(payload) {
    this.mode = 'insert';
    this.insertPayload = Array.isArray(payload) ? payload.map(clone) : [clone(payload)];
    return this;
  }

  update(payload) {
    this.mode = 'update';
    this.updatePayload = clone(payload || {});
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value: normalizeValue(value) });
    return this;
  }

  order(field, { ascending = true } = {}) {
    this.ordering = { field, ascending };
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  async single() {
    const result = await this.execute();
    if (result.error) return result;
    if (Array.isArray(result.data)) {
      if (result.data.length !== 1) return { data: null, error: new Error('Expected single row') };
      return { data: result.data[0], error: null };
    }
    if (!result.data) return { data: null, error: new Error('Expected single row') };
    return { data: result.data, error: null };
  }

  async maybeSingle() {
    const result = await this.execute();
    if (result.error) return result;
    if (Array.isArray(result.data)) {
      if (result.data.length === 0) return { data: null, error: null };
      if (result.data.length > 1) return { data: null, error: new Error('Expected at most one row') };
      return { data: result.data[0], error: null };
    }
    return { data: result.data ?? null, error: null };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    try {
      if (this.mode === 'select') return { data: await this.executeSelect(), error: null };
      if (this.mode === 'insert') return { data: await this.executeInsert(), error: null };
      if (this.mode === 'update') return { data: await this.executeUpdate(), error: null };
      throw new Error(`Unsupported mode: ${this.mode}`);
    } catch (error) {
      return { data: null, error };
    }
  }

  async executeSelect() {
    await delay(this.client.options.queryDelayMs);
    if (this.table === 'sync_jobs') {
      const idFilter = this.filters.find((item) => item.field === 'id');
      if (idFilter && this.client.options.failLoadJobIds?.includes(idFilter.value)) {
        throw new Error(`forced load failure for ${idFilter.value}`);
      }
    }
    const rows = this.client.selectRows(this.table, this.filters);
    return this.projectRows(rows);
  }

  async executeInsert() {
    await delay(this.client.options.queryDelayMs);
    return this.client.writeMutex.run(async () => {
      const inserted = [];
      for (const rawItem of this.insertPayload) {
        const item = clone(rawItem) || {};
        if (!item.id) item.id = randomUUID();
        if (this.table === 'sync_jobs') {
          item.created_at ||= nowIso();
          item.updated_at ||= item.created_at;
        }
        inserted.push(this.client.insertRow(this.table, item));
      }
      return this.projectRows(inserted);
    });
  }

  async executeUpdate() {
    await delay(this.client.options.queryDelayMs);
    return this.client.writeMutex.run(async () => {
      const idFilter = this.filters.find((item) => item.field === 'id');
      if (this.table === 'sync_jobs' && idFilter) {
        if (this.updatePayload.status === 'done' && this.client.options.failMarkDoneJobIds?.includes(idFilter.value)) {
          throw new Error(`forced mark done failure for ${idFilter.value}`);
        }
        if (this.updatePayload.status === 'failed' && this.client.options.failMarkFailedJobIds?.includes(idFilter.value)) {
          throw new Error(`forced mark failed failure for ${idFilter.value}`);
        }
      }
      const rows = this.client.updateRows(this.table, this.filters, this.updatePayload);
      return this.projectRows(rows);
    });
  }

  projectRows(rows) {
    let projected = rows.map((row) => clone(row));
    if (this.ordering) {
      const { field, ascending } = this.ordering;
      projected.sort((a, b) => {
        if (a[field] === b[field]) return 0;
        return (a[field] < b[field] ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (Number.isInteger(this.limitValue)) projected = projected.slice(0, this.limitValue);
    if (this.selectedColumns !== '*') {
      const columns = this.selectedColumns.split(',').map((item) => item.trim()).filter(Boolean);
      projected = projected.map((row) => {
        const picked = {};
        for (const column of columns) picked[column] = row[column];
        return picked;
      });
    }
    if ((this.mode === 'insert' || this.mode === 'update') && projected.length === 1) {
      return projected[0];
    }
    return projected;
  }
}

class PostgresCompatibleTestClient {
  constructor(state, options = {}) {
    this.state = state;
    this.options = options;
    this.writeMutex = new Mutex();
    this.auth = {
      getUserFromToken: async (token) => ({ id: options.tokenMap?.[token] || 'user-1' }),
    };
  }

  from(table) {
    return new QueryBuilder(this, table, 'select');
  }

  table(table) {
    const rows = this.state.tables[table];
    if (!rows) throw new Error(`Unsupported table ${table}`);
    return rows;
  }

  matchFilters(row, filters = []) {
    return filters.every(({ field, value }) => {
      const actual = row[field] === undefined ? null : row[field];
      return JSON.stringify(actual) === JSON.stringify(value);
    });
  }

  selectRows(table, filters = []) {
    return this.table(table).filter((row) => this.matchFilters(row, filters));
  }

  insertRow(table, payload) {
    const row = clone(payload);
    this.validateInsert(table, row);
    this.table(table).push(row);
    return clone(row);
  }

  updateRows(table, filters = [], payload = {}) {
    const rows = this.table(table);
    const matched = [];
    for (const row of rows) {
      if (!this.matchFilters(row, filters)) continue;
      Object.assign(row, clone(payload || {}));
      if (table === 'sync_jobs') row.updated_at = row.updated_at || nowIso();
      matched.push(clone(row));
    }
    return matched;
  }

  validateInsert(table, row) {
    if (table === 'campaigns' && !this.state.tables.users.some((item) => item.id === row.owner_user_id)) {
      throw new Error(`campaign owner ${row.owner_user_id} does not exist`);
    }
    if (['campaign_memberships', 'analysis_results', 'campaign_snapshots', 'decision_history', 'recommendations', 'sync_jobs'].includes(table)) {
      const userId = row.user_id;
      if (userId && !this.state.tables.users.some((item) => item.id === userId)) {
        throw new Error(`user ${userId} does not exist`);
      }
    }
    if (table === 'campaign_memberships' && !this.state.tables.campaigns.some((item) => item.id === row.campaign_id)) {
      throw new Error(`campaign ${row.campaign_id} does not exist`);
    }
    if (table === 'sync_jobs' && row.campaign_id && !row.user_id) {
      throw new Error('sync job missing user_id');
    }
  }

  async writeRequestLog(payload) {
    const entry = { ...clone(payload), id: randomUUID(), created_at: nowIso(), metadata: clone(payload?.metadata || {}) };
    await this.writeMutex.run(async () => {
      this.table('request_logs').push(entry);
    });
    return entry;
  }

  async rpc(name, params) {
    await delay(this.options.rpcDelayMs);
    if (name !== 'persist_analysis_atomic') {
      return { data: null, error: new Error(`Unsupported RPC: ${name}`) };
    }
    if (this.options.rpcError) return { data: null, error: this.options.rpcError };

    return this.writeMutex.run(async () => {
      const snapshot = clone(this.state.tables);
      try {
        const payload = clone(params?.p_payload || {});
        const analysis = payload.analysis_result || {};
        const analysisId = randomUUID();
        this.insertRow('analysis_results', {
          id: analysisId,
          user_id: normalizeValue(analysis.user_id),
          campaign_id: normalizeValue(analysis.campaign_id),
          request_id: normalizeValue(analysis.request_id),
          timestamp: normalizeValue(analysis.timestamp) || nowIso(),
          version: normalizeValue(analysis.version),
          raw_snapshot: normalizeValue(analysis.raw_snapshot) || {},
          metrics: normalizeValue(analysis.metrics) || {},
          scores: normalizeValue(analysis.scores) || {},
          bottlenecks: normalizeValue(analysis.bottlenecks) || [],
          confidence: normalizeValue(analysis.confidence),
          created_at: nowIso(),
        });
        if (this.options.failMidPersistence) {
          throw new Error('mid-persistence failure');
        }
        this.insertRow('campaign_snapshots', {
          id: randomUUID(),
          analysis_result_id: analysisId,
          user_id: normalizeValue(payload.campaign_snapshot?.user_id),
          campaign_id: normalizeValue(payload.campaign_snapshot?.campaign_id),
          timestamp: normalizeValue(payload.campaign_snapshot?.timestamp) || nowIso(),
          version: normalizeValue(payload.campaign_snapshot?.version),
          raw_metrics_snapshot: normalizeValue(payload.campaign_snapshot?.raw_metrics_snapshot) || {},
          computed_scores: normalizeValue(payload.campaign_snapshot?.computed_scores) || {},
          created_at: nowIso(),
        });
        for (const item of payload.decisions || []) {
          this.insertRow('decision_history', {
            id: randomUUID(),
            analysis_result_id: analysisId,
            user_id: normalizeValue(item.user_id),
            campaign_id: normalizeValue(item.campaign_id),
            timestamp: normalizeValue(item.timestamp) || nowIso(),
            version: normalizeValue(item.version),
            verdict: normalizeValue(item.verdict),
            reason: normalizeValue(item.reason),
            confidence: normalizeValue(item.confidence),
            created_at: nowIso(),
          });
        }
        for (const item of payload.recommendations || []) {
          this.insertRow('recommendations', {
            id: randomUUID(),
            analysis_result_id: analysisId,
            user_id: normalizeValue(item.user_id),
            campaign_id: normalizeValue(item.campaign_id),
            timestamp: normalizeValue(item.timestamp) || nowIso(),
            version: normalizeValue(item.version),
            issue: normalizeValue(item.issue),
            root_cause: normalizeValue(item.root_cause),
            action: normalizeValue(item.action),
            expected_impact: normalizeValue(item.expected_impact),
            urgency: normalizeValue(item.urgency),
            effort: normalizeValue(item.effort),
            confidence: normalizeValue(item.confidence),
            priority_score: normalizeValue(item.priority_score),
            created_at: nowIso(),
          });
        }
        if (this.options.rpcInvalidShape) return { data: { invalid: true }, error: null };
        return { data: analysisId, error: null };
      } catch (error) {
        this.state.tables = snapshot;
        return { data: null, error };
      }
    });
  }
}

function createRealTestDb(options = {}) {
  const state = {
    tables: {
      users: [],
      campaigns: [],
      campaign_memberships: [],
      analysis_results: [],
      campaign_snapshots: [],
      decision_history: [],
      recommendations: [],
      sync_jobs: [],
      request_logs: [],
    },
  };

  const client = new PostgresCompatibleTestClient(state, options);

  function seedUser({ id, email = `${id}@example.com` }) {
    state.tables.users.push({ id, email });
  }

  function seedCampaign({ id, ownerUserId, name = id }) {
    const ts = nowIso();
    client.insertRow('campaigns', { id, owner_user_id: ownerUserId, name, created_at: ts, updated_at: ts });
  }

  function seedMembership({ campaignId, userId, role = 'member' }) {
    state.tables.campaign_memberships.push({ id: randomUUID(), campaign_id: campaignId, user_id: userId, role, created_at: nowIso() });
  }

  function seedJob({ id, userId, campaignId, status = 'queued', payload = {} }) {
    const ts = nowIso();
    state.tables.sync_jobs.push({
      id,
      user_id: userId,
      campaign_id: campaignId,
      status,
      payload: clone(payload),
      result_payload: null,
      error_message: null,
      started_at: null,
      finished_at: null,
      created_at: ts,
      updated_at: ts,
    });
  }

  function count(table) {
    return state.tables[table].length;
  }

  function getJob(id) {
    return clone(state.tables.sync_jobs.find((row) => row.id === id) || null);
  }

  function getLogMessages() {
    return state.tables.request_logs.map((row) => row.message);
  }

  function findOrphans() {
    const ids = new Set(state.tables.analysis_results.map((row) => row.id));
    return {
      campaign_snapshots: state.tables.campaign_snapshots.filter((row) => !ids.has(row.analysis_result_id)).map((row) => row.id),
      decision_history: state.tables.decision_history.filter((row) => !ids.has(row.analysis_result_id)).map((row) => row.id),
      recommendations: state.tables.recommendations.filter((row) => !ids.has(row.analysis_result_id)).map((row) => row.id),
    };
  }

  function getCounts() {
    return {
      analysis_results: count('analysis_results'),
      campaign_snapshots: count('campaign_snapshots'),
      decision_history: count('decision_history'),
      recommendations: count('recommendations'),
      sync_jobs: count('sync_jobs'),
      request_logs: count('request_logs'),
    };
  }

  function close() {}

  return {
    client,
    seedUser,
    seedCampaign,
    seedMembership,
    seedJob,
    count,
    getJob,
    getCounts,
    getLogMessages,
    findOrphans,
    close,
    roleRank,
  };
}

module.exports = { createRealTestDb, roleRank };
