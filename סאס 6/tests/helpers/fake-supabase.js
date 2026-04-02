function createState() {
  return {
    jobs: [],
    analysis_results: [],
    campaign_snapshots: [],
    decision_history: [],
    recommendations: [],
    request_logs: [],
    logWrites: [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix, list) {
  return `${prefix}-${list.length + 1}`;
}

function createQuery(state, table, options = {}) {
  const ctx = { filters: [], updateValues: null, insertValues: null, selectFields: '*', mode: 'select' };
  const list = () => {
    switch (table) {
      case 'sync_jobs': return state.jobs;
      case 'request_logs': return state.request_logs;
      default: throw new Error(`Unsupported table ${table}`);
    }
  };

  const matchingRecord = () => list().find((item) => ctx.filters.every(([field, value]) => item[field] === value)) || null;

  const api = {
    select(fields = '*') { ctx.selectFields = fields; return this; },
    eq(field, value) { ctx.filters.push([field, value]); return this; },
    update(values) { ctx.mode = 'update'; ctx.updateValues = values; return this; },
    insert(values) { ctx.mode = 'insert'; ctx.insertValues = values; return this; },
    async maybeSingle() {
      if (options.queryDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.queryDelayMs));
      }
      if (table === 'sync_jobs' && ctx.mode === 'select' && ctx.filters.some(([field]) => field === 'id')) {
        const [, targetJobId] = ctx.filters.find(([field]) => field === 'id');
        if (options.failLoadJobIds?.includes(targetJobId)) {
          return { data: null, error: new Error(`load failure for ${targetJobId}`) };
        }
      }
      if (ctx.mode === 'update') {
        const record = matchingRecord();
        if (!record) return { data: null, error: null };
        const nextStatus = ctx.updateValues?.status;
        if (table === 'sync_jobs' && nextStatus === 'done' && options.failMarkDoneJobIds?.includes(record.id)) {
          return { data: null, error: new Error(`mark done failure for ${record.id}`) };
        }
        if (table === 'sync_jobs' && nextStatus === 'failed' && options.failMarkFailedJobIds?.includes(record.id)) {
          return { data: null, error: new Error(`mark failed failure for ${record.id}`) };
        }
        Object.assign(record, clone(ctx.updateValues));
        return { data: clone(record), error: null };
      }
      const record = matchingRecord();
      return { data: record ? clone(record) : null, error: null };
    },
    async single() {
      if (ctx.mode !== 'insert') throw new Error('single() only supported for insert');
      const row = { ...clone(ctx.insertValues), id: ctx.insertValues.id || makeId('job', state.jobs), created_at: new Date().toISOString() };
      list().push(row);
      return { data: clone(row), error: null };
    },
  };

  return api;
}

function createClient(state, options = {}) {
  return {
    auth: {
      async getUserFromToken(token) {
        if (options.authUsers?.[token]) return options.authUsers[token];
        throw new Error('invalid token');
      },
    },
    from(table) {
      return createQuery(state, table, options);
    },
    async rpc(name, params) {
      if (name !== 'persist_analysis_atomic') throw new Error(`Unsupported RPC ${name}`);
      if (options.rpcError) return { data: null, error: options.rpcError };
      if (options.rpcInvalidShape) return { data: { analysisId: 'bad-shape' }, error: null };
      const before = clone({
        analysis_results: state.analysis_results,
        campaign_snapshots: state.campaign_snapshots,
        decision_history: state.decision_history,
        recommendations: state.recommendations,
      });
      try {
        const payload = params.p_payload;
        const analysisId = `analysis-${state.analysis_results.length + 1}`;
        const analysis = { id: analysisId, ...clone(payload.analysis_result) };
        state.analysis_results.push(analysis);
        if (options.failMidPersistence) {
          state.campaign_snapshots.push({ id: 'snapshot-temp', analysis_result_id: analysisId, ...clone(payload.campaign_snapshot) });
          throw new Error('mid-persistence failure');
        }
        if (options.rpcDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.rpcDelayMs));
        }
        state.campaign_snapshots.push({ id: `snapshot-${state.campaign_snapshots.length + 1}`, analysis_result_id: analysisId, ...clone(payload.campaign_snapshot) });
        for (const item of payload.decisions || []) {
          state.decision_history.push({ id: `decision-${state.decision_history.length + 1}`, analysis_result_id: analysisId, ...clone(item) });
        }
        for (const item of payload.recommendations || []) {
          state.recommendations.push({ id: `recommendation-${state.recommendations.length + 1}`, analysis_result_id: analysisId, ...clone(item) });
        }
        return { data: analysisId, error: null };
      } catch (error) {
        state.analysis_results = before.analysis_results;
        state.campaign_snapshots = before.campaign_snapshots;
        state.decision_history = before.decision_history;
        state.recommendations = before.recommendations;
        return { data: null, error };
      }
    },
    async writeRequestLog(payload) {
      state.logWrites.push(payload.message);
      state.request_logs.push(clone(payload));
      return { data: payload, error: null };
    },
  };
}

function findOrphans(state) {
  const ids = new Set(state.analysis_results.map((row) => row.id));
  return {
    campaign_snapshots: state.campaign_snapshots.filter((row) => !ids.has(row.analysis_result_id)),
    decision_history: state.decision_history.filter((row) => !ids.has(row.analysis_result_id)),
    recommendations: state.recommendations.filter((row) => !ids.has(row.analysis_result_id)),
  };
}

export { createState, createClient, findOrphans };
