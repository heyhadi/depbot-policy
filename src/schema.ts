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

// GitHub's username rules: alphanumerics and single hyphens, no leading/trailing hyphen, max 39 chars.
const githubHandlePattern = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** Flags every item whose key was already seen earlier in the array. */
function unique<T>(key: (item: T) => string, describe: (item: T) => string) {
  return (items: T[], ctx: z.RefinementCtx) => {
    const firstIndexByKey = new Map<string, number>();
    items.forEach((item, index) => {
      const firstIndex = firstIndexByKey.get(key(item));
      if (firstIndex === undefined) {
        firstIndexByKey.set(key(item), index);
        return;
      }
      ctx.addIssue({
        code: "custom",
        path: [index],
        message: `${describe(item)} is already listed at index ${firstIndex}`,
      });
    });
  };
}

const ecosystemSchema = z.strictObject({
  type: z.enum(ecosystemTypes),
  directory: z
    .string()
    .startsWith("/", 'Must start with "/" (paths are relative to the repository root)'),
  schedule: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
});

const updateTypeSchema = z.enum(["patch", "minor"], {
  error: (issue) =>
    issue.input === "major"
      ? "Major updates are never auto-merged; they always need a human review"
      : undefined,
});

const autoMergeSchema = z.strictObject({
  updateTypes: z
    .array(updateTypeSchema)
    .min(1)
    .superRefine(unique((type) => type, (type) => `"${type}"`))
    .default(["patch"]),
  dependencyTypes: z
    .array(z.enum(["development", "production"]))
    .min(1)
    .superRefine(unique((type) => type, (type) => `"${type}"`))
    .default(["development", "production"]),
});

const blockEntrySchema = z.strictObject({
  // Exact package name or a glob such as `@types/*`.
  name: z.string().min(1),
  // Required so the block list explains itself and can be pruned later.
  reason: z.string().min(1),
  // Limits the block to these ecosystems. Omitted means every ecosystem.
  ecosystems: z
    .array(z.enum(ecosystemTypes))
    .min(1)
    .superRefine(unique((type) => type, (type) => `"${type}"`))
    .optional(),
});

const reviewSchema = z.strictObject({
  rotation: z
    .array(
      z.string().regex(githubHandlePattern, {
        error: (issue) =>
          typeof issue.input === "string" && issue.input.startsWith("@")
            ? 'Write GitHub usernames without the leading "@"'
            : "Not a valid GitHub username",
      }),
    )
    .min(1)
    // GitHub usernames are case-insensitive.
    .superRefine(unique((handle) => handle.toLowerCase(), (handle) => `"${handle}"`)),
});

export const policySchema = z.strictObject({
  version: z.literal(1),
  ecosystems: z
    .array(ecosystemSchema)
    .min(1)
    .superRefine(
      unique(
        (ecosystem) => `${ecosystem.type}:${ecosystem.directory}`,
        (ecosystem) => `${ecosystem.type} in "${ecosystem.directory}"`,
      ),
    ),
  autoMerge: autoMergeSchema.default({
    updateTypes: ["patch"],
    dependencyTypes: ["development", "production"],
  }),
  block: z
    .array(blockEntrySchema)
    .superRefine(unique((entry) => entry.name, (entry) => `"${entry.name}"`))
    .default([]),
  review: reviewSchema.optional(),
}).superRefine((policy, ctx) => {
  const configured = new Set(policy.ecosystems.map((ecosystem) => ecosystem.type));
  policy.block.forEach((entry, blockIndex) => {
    entry.ecosystems?.forEach((type, typeIndex) => {
      if (configured.has(type)) return;
      ctx.addIssue({
        code: "custom",
        path: ["block", blockIndex, "ecosystems", typeIndex],
        message: `No "${type}" ecosystem is configured in this policy`,
      });
    });
  });
});

/** A validated policy with defaults applied. */
export type Policy = z.output<typeof policySchema>;
