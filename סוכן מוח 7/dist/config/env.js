"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    PORT: zod_1.z.coerce.number().default(3000),
    APP_BASE_URL: zod_1.z.string().url().default('http://localhost:3000'),
    DATABASE_URL: zod_1.z.string().min(1),
    CACHE_TTL_SECONDS: zod_1.z.coerce.number().int().positive().default(300),
    REQUEST_TIMEOUT_MS: zod_1.z.coerce.number().int().positive().default(15000),
    META_ACCESS_TOKEN: zod_1.z.string().optional().default(''),
    META_AD_ACCOUNT_ID: zod_1.z.string().optional().default(''),
    GOOGLE_ADS_DEVELOPER_TOKEN: zod_1.z.string().optional().default(''),
    GOOGLE_ADS_CUSTOMER_ID: zod_1.z.string().optional().default(''),
    GOOGLE_ADS_ACCESS_TOKEN: zod_1.z.string().optional().default(''),
    GA4_PROPERTY_ID: zod_1.z.string().optional().default(''),
    GA4_ACCESS_TOKEN: zod_1.z.string().optional().default(''),
    SUPABASE_URL: zod_1.z.string().url().optional().or(zod_1.z.literal('')).default(''),
    SUPABASE_ANON_KEY: zod_1.z.string().optional().default(''),
    SUPABASE_JWKS_TTL_SECONDS: zod_1.z.coerce.number().int().positive().default(300)
});
exports.env = envSchema.parse(process.env);
