// Collect the triggering attempt, never a mixture of jobs from multiple reruns.
export async function collectTimings(github, repo, run) {
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
        ...repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100,
    });
    return { run, jobs };
}
export function duration(start, end) {
    const milliseconds = Date.parse(end) - Date.parse(start);
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
}
export function formatDuration(milliseconds) {
    if (milliseconds === null)
        return '—';
    const seconds = Math.round(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
function text(value) {
    return String(value).replace(/[\\`*_[\]<>|\r\n]/g, character => `&#${character.charCodeAt(0)};`);
}
function completedDuration(item) {
    return item.status === 'completed' && item.conclusion !== 'skipped'
        ? duration(item.started_at, item.completed_at) : null;
}
export function renderTimings({ run, jobs }) {
    const measured = jobs.map(job => ({ job, milliseconds: completedDuration(job) }));
    const steps = jobs.flatMap(job => job.steps.map(step => ({
        name: `${job.name} / ${step.name}`, status: step.conclusion || step.status,
        milliseconds: completedDuration(step),
    }))).filter(step => step.milliseconds !== null).sort((a, b) => b.milliseconds - a.milliseconds);
    // updated_at is not a completion timestamp. Use the latest completed job instead.
    const end = measured.filter(item => item.milliseconds !== null)
        .map(item => Date.parse(item.job.completed_at));
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
