export interface TimedItem { name: string; status: string; conclusion: string | null; started_at: string | null; completed_at: string | null }
export interface TimedJob extends TimedItem { steps: TimedItem[] }
export interface WorkflowRun { id: number; run_attempt: number; run_started_at: string; created_at?: string; updated_at?: string }
export interface TimingGithub { rest: { actions: { listJobsForWorkflowRunAttempt: unknown } }; paginate(endpoint: unknown, parameters: {owner: string; repo: string; run_id: number; attempt_number: number; per_page: number}): Promise<TimedJob[]> }

// Collect the triggering attempt, never a mixture of jobs from multiple reruns.
export async function collectTimings(github: TimingGithub, repo: {owner: string; repo: string}, run: WorkflowRun) {
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
    ...repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100,
  });
  return { run, jobs };
}

export function duration(start: string | null, end: string | null) {
  const milliseconds = Date.parse(end as string) - Date.parse(start as string);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
}

export function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return '—';
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function text(value: unknown) {
  return String(value).replace(/[\\`*_[\]<>|\r\n]/g, character => `&#${character.charCodeAt(0)};`);
}

function completedDuration(item: TimedItem) {
  return item.status === 'completed' && item.conclusion !== 'skipped'
    ? duration(item.started_at, item.completed_at) : null;
}

export function renderTimings({ run, jobs }: {run: WorkflowRun; jobs: TimedJob[]}) {
  const measured = jobs.map(job => ({ job, milliseconds: completedDuration(job) }));
  const steps = jobs.flatMap(job => job.steps.map(step => ({
    name: `${job.name} / ${step.name}`, status: step.conclusion || step.status,
    milliseconds: completedDuration(step),
  }))).filter(step => step.milliseconds !== null).sort((a, b) => (b.milliseconds as number) - (a.milliseconds as number));
  // updated_at is not a completion timestamp. Use the latest completed job instead.
  const end = measured.filter(item => item.milliseconds !== null)
    .map(item => Date.parse(item.job.completed_at as string));
  const elapsed = end.length ? duration(run.run_started_at, new Date(Math.max(...end)).toISOString()) : null;
  const accumulated = measured.reduce((sum, item) => sum + (item.milliseconds ?? 0), 0);
  const lines = [
    '', '### CI timings', '',
    `Attempt ${run.run_attempt}. Elapsed from attempt start, including job scheduling and dependencies: **${formatDuration(elapsed)}**. Accumulated job time: **${formatDuration(accumulated)}**.`,
    '', 'Jobs can run in parallel; accumulated job time is not elapsed time. Skipped and unfinished work has no measured duration.',
    '', '| Job | Status | Duration |', '| --- | --- | ---: |',
    ...measured.map(({ job, milliseconds }) => `| ${text(job.name)} | ${text(job.conclusion || job.status)} | ${formatDuration(milliseconds)} |`),
    '', '**Slowest completed steps**', '', '| Step | Status | Duration |', '| --- | --- | ---: |',
    ...steps.slice(0, 5).map(step => `| ${text(step.name)} | ${text(step.status)} | ${formatDuration(step.milliseconds)} |`),
    '', '<details><summary>All step timings</summary>', '', '| Step | Status | Duration |', '| --- | --- | ---: |',
    ...steps.map(step => `| ${text(step.name)} | ${text(step.status)} | ${formatDuration(step.milliseconds)} |`),
    '', '</details>', '',
  ];
  return lines.join('\n');
}
