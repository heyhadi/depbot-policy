const secondsPerDay = 24 * 60 * 60;
const secondsPerWeek = 7 * secondsPerDay;
// 1970-01-01 was a Thursday. Shifting by three days makes each week start on Monday 00:00 UTC.
const mondayShift = 3 * secondsPerDay;

/**
 * The reviewer on duty for a given moment: one person per Monday-to-Sunday week (UTC), in
 * rotation order. Stateless, so anyone can work it out from the date alone.
 *
 * The generated workflow runs the same formula in shell (see `reviewerScript`); keep them in step.
 */
export function reviewerFor(rotation: readonly string[], date: Date): string {
  if (rotation.length === 0) throw new Error("rotation must not be empty");
  const seconds = Math.floor(date.getTime() / 1000);
  const week = Math.floor((seconds + mondayShift) / secondsPerWeek);
  return rotation[week % rotation.length]!;
}

/** Shell version of `reviewerFor`, run in the generated workflow with GNU date. */
export const reviewerScript = [
  'read -ra reviewers <<< "$REVIEWERS"',
  // The PR's creation time, not the current time, so re-runs pick the same person.
  'created=$(date -u -d "$PR_CREATED_AT" +%s)',
  `week=$(( (created + ${mondayShift}) / ${secondsPerWeek} ))`,
  'reviewer="${reviewers[week % ${#reviewers[@]}]}"',
  'gh pr edit "$PR_URL" --add-reviewer "$reviewer"',
].join("\n");
