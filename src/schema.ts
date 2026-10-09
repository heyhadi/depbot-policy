import { z } from "zod";

// Values Dependabot accepts for `package-ecosystem`.
export const ecosystemTypes = [
  "bundler",
  "cargo",
  "composer",
  "docker",
  "github-actions",
  "gomod",
  "gradle",
  "maven",
  "mix",
  "npm",
  "nuget",
  "pip",
  "pub",
  "swift",
  "terraform",
] as const;

const ecosystemSchema = z.strictObject({
  type: z.enum(ecosystemTypes),
  directory: z.string().min(1),
  schedule: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
});

// Major updates are never auto-merged, so they aren't an option here.
const autoMergeSchema = z.strictObject({
  updateTypes: z.array(z.enum(["patch", "minor"])).min(1).default(["patch"]),
  dependencyTypes: z
    .array(z.enum(["development", "production"]))
    .min(1)
    .default(["development", "production"]),
});

const blockEntrySchema = z.strictObject({
  // Exact package name or a glob such as `@types/*`.
  name: z.string().min(1),
  // Required so the block list explains itself and can be pruned later.
  reason: z.string().min(1),
});

const reviewSchema = z.strictObject({
  rotation: z.array(z.string().min(1)).min(1),
});

export const policySchema = z.strictObject({
  version: z.literal(1),
  ecosystems: z.array(ecosystemSchema).min(1),
  autoMerge: autoMergeSchema.default({
    updateTypes: ["patch"],
    dependencyTypes: ["development", "production"],
  }),
  block: z.array(blockEntrySchema).default([]),
  review: reviewSchema.optional(),
});

/** A validated policy with defaults applied. */
export type Policy = z.output<typeof policySchema>;
