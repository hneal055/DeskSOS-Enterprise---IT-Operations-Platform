import { z } from "zod";
import { SEVERITIES, STATUSES } from "./db";

const text = (max: number) => z.string().trim().min(1, "is required").max(max, `must be at most ${max} characters`);
const optionalText = (max: number) =>
  z.string().trim().max(max, `must be at most ${max} characters`).optional()
    .transform((v) => (v ? v : undefined));

export const incidentIdParams = z.object({
  id: z.coerce.number({ invalid_type_error: "must be a number" }).int().positive("must be a positive integer"),
});

// The dashboard sends parseFloat() of free-text inputs, which becomes null in
// JSON when the field isn't a number; treat that as "not provided".
const coordinate = (min: number, max: number) =>
  z.number().min(min, `must be between ${min} and ${max}`).max(max, `must be between ${min} and ${max}`)
    .nullish().transform((v) => (v == null ? undefined : v));

export const createIncidentBody = z.object({
  title: text(255),
  description: text(20000),
  category: optionalText(100),
  severity: z.enum(SEVERITIES as [string, ...string[]], { errorMap: () => ({ message: `must be one of ${SEVERITIES.join(", ")}` }) }).optional(),
  status: z.enum(STATUSES as [string, ...string[]], { errorMap: () => ({ message: `must be one of ${STATUSES.join(", ")}` }) }).optional(),
  location: z.object({ latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) }).optional(),
  assignedTo: optionalText(100),
});

export const updateIncidentBody = z.object({
  status: z.enum(STATUSES as [string, ...string[]], { errorMap: () => ({ message: `must be one of ${STATUSES.join(", ")}` }) }),
});

export const loginBody = z.object({
  email: z.string({ required_error: "is required" }).trim().min(1, "is required").max(254),
  password: z.string({ required_error: "is required" }).min(1, "is required").max(256),
});

export const changePasswordBody = z.object({
  currentPassword: z.string({ required_error: "is required" }).min(1, "is required").max(256),
  newPassword: z.string({ required_error: "is required" }).max(256),
});
