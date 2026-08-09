import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("programloom"),
  environment: z.string(),
  requestId: z.string(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const roleSchema = z.enum(["owner", "admin", "reviewer", "speaker"]);
export type Role = z.infer<typeof roleSchema>;
