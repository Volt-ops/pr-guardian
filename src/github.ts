/**
 * github.ts — Octokit wrapper for PR diff retrieval and comment posting.
 *
 * Provides a thin, typed abstraction over the GitHub REST API so that the
 * orchestrator can fetch diffs and publish review results without coupling
 * to Octokit internals.
 */

import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env["GITHUB_TOKEN"] });

/** Minimal shape of the data we need from a pull-request event payload. */
export interface PullRequestRef {
  owner: string;
  repo: string;
  pull_number: number;
}

/**
 * Fetch the unified diff for a pull request.
 *
 * Uses the `application/vnd.github.v3.diff` media type so the response body
 * is the raw diff text rather than JSON.
 */
export async function getPullRequestDiff(
  pr: PullRequestRef,
): Promise<string> {
  const { data } = await octokit.pulls.get({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pull_number,
    mediaType: { format: "diff" },
  });

  // When the diff media type is requested, `data` is the raw diff string
  // cast through the generic response type.
  return data as unknown as string;
}

/**
 * Post an issue comment containing the compiled review report.
 *
 * We use issue comments (not PR review comments) so the full Markdown
 * report appears as a single top-level comment on the PR.
 */
export async function postPRComment(
  pr: PullRequestRef,
  body: string,
): Promise<void> {
  await octokit.issues.createComment({
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.pull_number,
    body,
  });
}
