// Heuristic filter: keeps text source/config/documentation files and drops
// binaries, images, media, archives, lockfiles, and build/vendor output.
const SKIP_DIRECTORY = /(^|\/)(node_modules|dist|build|coverage|\.git|\.next|\.cache|out|target|__pycache__|venv|\.venv|vendor)(\/|$)/;

const SKIP_EXTENSIONS = new Set([
  // images
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "avif", "bmp", "tiff",
  // binaries / compiled
  "exe", "dll", "so", "dylib", "class", "jar", "wasm", "a", "o", "pyc", "pyo", "node",
  // archives
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
  // fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // media
  "mp3", "wav", "ogg", "mp4", "mov", "avi", "webm",
  // other binary
  "pdf", "db", "sqlite", "map",
  "lock",
]);

const SKIP_FILENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "PDM.lock",
  "poetry.lock", "Pipfile.lock", "Cargo.lock", "go.sum",
  "composer.lock", "pubspec.lock", "Gemfile.lock", "flake.lock",
]);

const KEEP_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java",
  "c", "cc", "cpp", "h", "hpp", "cs", "php", "swift", "kt", "kts",
  "sh", "bash", "zsh", "ps1", "html", "htm", "css", "scss", "less", "sass",
  "json", "jsonc", "yml", "yaml", "toml", "xml", "sql", "graphql", "proto",
  "md", "mdx", "txt", "ini", "cfg", "conf", "properties", "gitignore",
  "editorconfig", "prettierrc", "eslintrc", "babelrc",
]);

const KEEP_FILENAMES = new Set([
  "Dockerfile", "Makefile", "docker-compose", "docker-compose.yml",
  "docker-compose.yaml", ".dockerignore", ".gitignore", ".gitattributes",
  ".gitmodules", ".env.example", ".npmrc", ".prettierrc", ".eslintrc",
]);

function basename(path) {
  return path.split("/").pop();
}

function extname(path) {
  const base = basename(path);
  const idx = base.lastIndexOf(".");
  return idx === -1 || idx === base.length - 1 ? "" : base.slice(idx + 1).toLowerCase();
}

// Returns filtered blob entries annotated with a sha so the caller can fetch content.
function filterRepoFiles(entries) {
  return entries
    .filter((e) => e.type === "blob")
    .filter((e) => !SKIP_DIRECTORY.test(e.path))
    .filter((e) => {
      const name = basename(e.path);
      if (KEEP_FILENAMES.has(name)) return true;
      if (SKIP_FILENAMES.has(name)) return false;
      const ext = extname(e.path);
      if (SKIP_EXTENSIONS.has(ext)) return false;
      return KEEP_EXTENSIONS.has(ext);
    })
    .map((e) => ({ path: e.path, type: "file", size: e.size || 0, sha: e.sha }));
}

module.exports = { filterRepoFiles, extname, basename };