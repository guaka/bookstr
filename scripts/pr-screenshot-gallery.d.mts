export interface GithubGallery {
    rest: {
        git: {
            getRef(parameters: Record<string, unknown>): Promise<{
                data: {
                    object: {
                        sha: string;
                    };
                };
            }>;
            createRef(parameters: Record<string, unknown>): Promise<{
                data: {
                    object: {
                        sha: string;
                    };
                };
            }>;
        };
        repos: {
            get(parameters: Record<string, unknown>): Promise<{
                data: {
                    default_branch: string;
                };
            }>;
            getContent(parameters: Record<string, unknown>): Promise<{
                data: {
                    content?: string;
                    sha?: string;
                } | unknown[];
            }>;
            createOrUpdateFileContents(parameters: Record<string, unknown>): Promise<{
                data: {
                    commit: {
                        sha: string;
                    };
                };
            }>;
        };
        issues: {
            listComments: unknown;
            updateComment(parameters: Record<string, unknown>): Promise<unknown>;
            createComment(parameters: Record<string, unknown>): Promise<unknown>;
        };
    };
    paginate(endpoint: unknown, parameters: Record<string, unknown>): Promise<Array<{
        id: number;
        body?: string;
    }>>;
}
export interface GalleryOptions {
    github: GithubGallery;
    owner: string;
    repo: string;
    pullRequests: Array<{
        number: number;
    }>;
    workflowName: string;
    runId: string | number;
    runUrl: string;
    screenshotRoot: string;
    branch?: string;
}
export declare function selectScreenshots(root: string, perArtifact?: number): Promise<{
    artifact: string;
    path: string;
    relativePath: string;
}[]>;
export declare function renderGallery({ workflowName, runUrl, marker, images }: {
    workflowName: string;
    runUrl: string;
    marker: string;
    images: Array<{
        label: string;
        url: string;
    }>;
}): string;
export declare function publishScreenshotGallery({ github, owner, repo, pullRequests, workflowName, runId, runUrl, screenshotRoot, branch, }: GalleryOptions): Promise<number>;
