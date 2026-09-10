const GITHUB_API = "https://api.github.com";

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "CodeLens",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(token, url, options = {}) {
  const headers = { ...authHeaders(token), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message || `GitHub API error ${res.status}`;
    throw new GitHubError(res.status, message);
  }

  return res;
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return match ? match[1] : null;
}

// Follows GitHub's Link header pagination until every page is collected.
async function getAllPages(token, url) {
  const all = [];
  let next = url;

  while (next) {
    const res = await ghFetch(token, next);
    const data = await res.json();
    if (Array.isArray(data)) all.push(...data);
    next = nextPageUrl(res.headers.get("link"));
  }

  return all;
}

async function listRepos(token) {
  const repos = await getAllPages(
    token,
    `${GITHUB_API}/user/repos?affiliation=owner,collaborator&per_page=100&sort=updated`
  );

  return repos.map((r) => ({
    id: String(r.id),
    name: r.name,
    owner: r.owner.login,
    fullName: r.full_name,
    description: r.description,
    language: r.language,
    isPrivate: r.private,
    defaultBranch: r.default_branch,
    size: r.size,
    updatedAt: r.updated_at,
  }));
}

async function getRepo(token, owner, repo) {
  const res = await ghFetch(
    token,
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );
  const r = await res.json();

  return {
    id: String(r.id),
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    language: r.language,
    defaultBranch: r.default_branch,
    isPrivate: r.private,
    size: r.size,
    topics: r.topics || [],
    starCount: r.stargazers_count,
  };
}

async function getFileTree(token, owner, repo, branch) {
  const res = await ghFetch(
    token,
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  const data = await res.json();

  if (data.truncated) {
    console.warn(`Git tree truncated for ${owner}/${repo}@${branch}`);
  }

  return data.tree || [];
}

async function getBlobContent(token, owner, repo, sha) {
  const res = await ghFetch(
    token,
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${sha}`
  );
  const data = await res.json();
  return Buffer.from(data.content, "base64").toString("utf8");
}

module.exports = { GitHubError, listRepos, getRepo, getFileTree, getBlobContent };