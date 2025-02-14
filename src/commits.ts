import * as core from '@actions/core'
import {Octokit, RestEndpointMethodTypes} from '@octokit/rest'
import moment from 'moment'

export interface CommitInfo {
  sha: string
  summary: string
  message: string
  author: string
  date: moment.Moment
  files: RestEndpointMethodTypes['repos']['compareCommits']['response']['data']['commits'][0]['files']
}

export class Commits {
  constructor(private octokit: Octokit, private filePath?: string) {}

  async getDiff(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<CommitInfo[]> {
    const commits: CommitInfo[] = await this.getDiffRemote(
      owner,
      repo,
      base,
      head
    )
    return this.sortCommits(commits)
  }

  private async getDiffRemote(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<CommitInfo[]> {
    // Fetch comparisons recursively until we don't find any commits
    // This is because the GitHub API limits the number of commits returned in a single response.
    let commits: RestEndpointMethodTypes['repos']['compareCommits']['response']['data']['commits'] =
      []
    let compareHead = head
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const compareResult = await this.octokit.repos.compareCommitsWithBasehead(
        {
          owner,
          repo,
          basehead: `${base}...${compareHead}`
        }
      )
      if (compareResult.data.total_commits === 0) {
        break
      }

      if (
        this.filePath &&
        compareResult.data.files?.some(file =>
          file.filename.startsWith(this.filePath as string)
        )
      ) {
        for (const commit of compareResult.data.commits) {
          const commitInfo = await this.octokit.repos.getCommit({
            owner,
            repo,
            ref: commit.sha
          })
          commits.push(commitInfo.data)
        }
      } else {
        commits = compareResult.data.commits.concat(commits)
      }
      compareHead = `${commits[0].sha}^`
    }

    core.info(
      `ℹ️ Found ${commits.length} commits from the GitHub API for ${owner}/${repo}`
    )

    return commits
      .filter(commit => commit.sha)
      .map(commit => ({
        sha: commit.sha || '',
        summary: commit.commit.message.split('\n')[0],
        message: commit.commit.message,
        date: moment(commit.commit.committer?.date),
        author: commit.commit.author?.name || '',
        prNumber: undefined,
        files: commit.files
      }))
  }

  private sortCommits(commits: CommitInfo[]): CommitInfo[] {
    const commitsResult = []
    const shas: {[key: string]: boolean} = {}

    for (const commit of commits) {
      if (shas[commit.sha]) {
        continue
      }
      shas[commit.sha] = true
      commitsResult.push(commit)
    }

    commitsResult.sort((a, b) => {
      if (a.date.isBefore(b.date)) {
        return -1
      } else if (b.date.isBefore(a.date)) {
        return 1
      }
      return 0
    })

    return commitsResult
  }
}

/**
 * Filters out all commits which match the exclude pattern
 */
export function filterCommits(
  commits: CommitInfo[],
  excludeMergeBranches: string[],
  filePath?: string
): CommitInfo[] {
  const filteredCommits = []

  for (const commit of commits) {
    if (excludeMergeBranches) {
      let matched = false
      for (const excludeMergeBranch of excludeMergeBranches) {
        if (commit.summary.includes(excludeMergeBranch)) {
          matched = true
          break
        }
      }
      if (matched) {
        continue
      }
    }
    filteredCommits.push(commit)
  }

  if (filePath) {
    return filteredCommits.filter(
      commit =>
        commit.files &&
        commit.files.some(file => file.filename?.startsWith(filePath))
    )
  }

  return filteredCommits
}
