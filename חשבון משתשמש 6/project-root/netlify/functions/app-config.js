const { loadEnv } = require('./_shared/env');
const { json } = require('./_shared/response');
const { toResponse } = require('./_shared/errors');

exports.handler = async () => {
  try {
    const env = loadEnv();
    return json(200, {
      success: true,
      config: {
        supabaseUrl: env.supabaseUrl,
        supabaseAnonKey: env.supabaseAnonKey,
        siteUrl: env.siteUrl || ''
      }
    });
  } catch (error) {
    const response = toResponse(error);
    return {
      ...response,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    };
  }
};
