export interface Env {
  APP_ENV: string;
  APP_URL: string;
  MARKETING_URL: string;
  ASSETS: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  AI?: Ai;
  JOBS?: Queue;
}
