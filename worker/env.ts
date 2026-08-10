export interface Env {
  APP_ENV: string;
  APP_URL: string;
  MARKETING_URL: string;
  RELEASE_COMMIT?: string;
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  AIRTABLE_ACCESS_TOKEN?: string;
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_WEBHOOK_ID?: string;
  AIRTABLE_WEBHOOK_MAC_SECRET?: string;
  AIRTABLE_WEBHOOK_PATH_SECRET?: string;
  ASSETS: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  AI?: Ai;
  JOBS?: Queue;
}
