// GitHub identifier validation, enforced BEFORE any GitHub API call or DB query.
//
// Owner (username): GitHub allows only alphanumerics and hyphens; a username may
// not start or end with a hyphen, and is at most 39 characters.
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

// Repository name: only alphanumerics, hyphens, underscores, and periods; kept
// reasonable by GitHub's practical limits (no leading/trailing/consecutive dots).
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;
const CONSECUTIVE_DOTS_RE = /\.{2,}/;

function validateOwnerRepo(owner, repo) {
  if (typeof owner !== "string" || typeof repo !== "string") {
    return { error: "owner and repo must be provided as strings" };
  }

  const o = owner.trim();
  const r = repo.trim();

  if (!o || !r) return { error: "owner and repo are required" };

  if (!OWNER_RE.test(o)) {
    return {
      error:
        "Invalid owner: GitHub usernames use letters, numbers, and hyphens, cannot start or end with a hyphen, and are at most 39 characters.",
    };
  }

  if (
    !REPO_RE.test(r) ||
    CONSECUTIVE_DOTS_RE.test(r) ||
    r.startsWith(".") ||
    r.endsWith(".")
  ) {
    return {
      error:
        "Invalid repository name: use letters, numbers, hyphens, underscores, and periods (no consecutive or leading/trailing dots), up to 100 characters.",
    };
  }

  return { owner: o, repo: r };
}

module.exports = { validateOwnerRepo };