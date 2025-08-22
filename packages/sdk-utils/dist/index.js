import { z } from "zod";
export const env = (k, req = true) => {
    const v = process.env[k];
    if (!v && req)
        throw new Error(`Missing env: ${k}`);
    return v || "";
};
export const Bump = z.enum(["major", "minor", "patch", "none"]);
