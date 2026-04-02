const DOMAIN_SCHEMA_VERSION = '1.0.0';

const dataPointFields = {
  key: { type: 'string', required: true, minLength: 1 },
  value: { type: 'number', required: true, finite: true },
  source: { type: 'string', required: true, minLength: 1 },
  captured_at: { type: 'string', required: true, isoDate: true }
};

const providerResultFields = {
  provider: { type: 'string', required: true, minLength: 1 },
  status: { type: 'string', required: true, enum: ['ok', 'skipped', 'error'] },
  retry_count: { type: 'number', required: true, integer: true, min: 0 },
  data_points: { type: 'array', required: true, items: { type: 'object', fields: dataPointFields } },
  warnings: { type: 'array', required: true, items: { type: 'string' } }
};

const outputSchema = {
  schema_version: { type: 'string', required: true, equals: DOMAIN_SCHEMA_VERSION },
  request_id: { type: 'string', required: true, minLength: 1 },
  generated_at: { type: 'string', required: true, isoDate: true },
  cache_hit: { type: 'boolean', required: true },
  duration_ms: { type: 'number', required: true, finite: true, min: 0 },
  retry_count: { type: 'number', required: true, integer: true, min: 0 },
  status: { type: 'string', required: true, enum: ['ok', 'partial', 'error'] },
  providers: { type: 'array', required: true, items: { type: 'object', fields: providerResultFields } },
  summary: {
    type: 'object',
    required: true,
    fields: {
      total_points: { type: 'number', required: true, integer: true, min: 0 },
      providers_ok: { type: 'number', required: true, integer: true, min: 0 },
      providers_skipped: { type: 'number', required: true, integer: true, min: 0 },
      providers_error: { type: 'number', required: true, integer: true, min: 0 }
    }
  }
};

module.exports = {
  DOMAIN_SCHEMA_VERSION,
  dataPointFields,
  providerResultFields,
  outputSchema
};
