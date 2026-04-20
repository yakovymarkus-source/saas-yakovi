// Netlify: env vars come from process.env directly (no dotenv needed)
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().optional().default(''),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  META_ACCESS_TOKEN: z.string().optional().default(''),
  META_AD_ACCOUNT_ID: z.string().optional().default(''),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional().default(''),
  GOOGLE_ADS_CUSTOMER_ID: z.string().optional().default(''),
  GOOGLE_ADS_ACCESS_TOKEN: z.string().optional().default(''),
  GA4_PROPERTY_ID: z.string().optional().default(''),
  GA4_ACCESS_TOKEN: z.string().optional().default(''),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_JWKS_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});

export const env = envSchema.parse(process.env);
