import { z } from "zod";

export const env = (k: string, req = true) => {
  const v = process.env[k];
  if (!v && req) throw new Error(`Missing env: ${k}`);
  return v || "";
};

export const Bump = z.enum(["major", "minor", "patch", "none"]);
export type Bump = z.infer<typeof Bump>;
