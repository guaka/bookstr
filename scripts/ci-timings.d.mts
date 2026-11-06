export interface TimedItem {
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
}
export interface TimedJob extends TimedItem {
    steps: TimedItem[];
}
export interface WorkflowRun {
    id: number;
    run_attempt: number;
    run_started_at: string;
    created_at?: string;
    updated_at?: string;
}
export interface TimingGithub {
    rest: {
        actions: {
            listJobsForWorkflowRunAttempt: unknown;
        };
    };
    paginate(endpoint: unknown, parameters: {
        owner: string;
        repo: string;
        run_id: number;
        attempt_number: number;
        per_page: number;
    }): Promise<TimedJob[]>;
}
export declare function collectTimings(github: TimingGithub, repo: {
    owner: string;
    repo: string;
}, run: WorkflowRun): Promise<{
    run: WorkflowRun;
    jobs: TimedJob[];
}>;
export declare function duration(start: string | null, end: string | null): number | null;
export declare function formatDuration(milliseconds: number | null): string;
export declare function renderTimings({ run, jobs }: {
    run: WorkflowRun;
    jobs: TimedJob[];
}): string;
