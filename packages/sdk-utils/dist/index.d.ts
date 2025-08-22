import { z } from "zod";
export declare const env: (k: string, req?: boolean) => string;
export declare const Bump: z.ZodEnum<["major", "minor", "patch", "none"]>;
export type Bump = z.infer<typeof Bump>;
