export interface Env {
  APP_ENV: string;
  APP_URL: string;
  MARKETING_URL: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ASSETS: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  AI?: Ai;
  JOBS?: Queue;
}
