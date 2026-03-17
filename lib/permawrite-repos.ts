import { supabase } from "./supabase";
import ArweaveGateway from "./arweave";
import type { ArweaveTag, UploadMethod } from "./wallet-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RepoFile {
  path: string;
  tx_id: string;
  size: number;
  content_type: string;
}

export interface Repo {
  id: string;
  user_id: string;
  slug: string;
  display_name: string;
  description: string | null;
  visibility: "private" | "public";
  latest_commit_tx: string | null;
  commit_count: number;
  total_size: number;
  created_at: string;
  updated_at: string;
}

export interface RepoCommit {
  id: string;
  user_id: string;
  repo_id: string;
  message: string;
  parent_commit_id: string | null;
  manifest_tx: string | null;
  files: RepoFile[];
  total_size: number;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Slug helpers                                                       */
/* ------------------------------------------------------------------ */

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* ------------------------------------------------------------------ */
/*  Repo CRUD                                                          */
/* ------------------------------------------------------------------ */

export async function createRepo(opts: {
  slug?: string;
  displayName: string;
  description?: string;
  visibility?: "private" | "public";
}): Promise<Repo> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const slug = opts.slug ? slugify(opts.slug) : generateSlug();

  const { data, error } = await supabase
    .from("permawrite_repos")
    .insert({
      user_id: userId,
      slug,
      display_name: opts.displayName,
      description: opts.description || null,
      visibility: opts.visibility ?? "private",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Repo;
}

export async function getMyRepos(): Promise<Repo[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return [];

  const { data } = await supabase
    .from("permawrite_repos")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  return (data ?? []) as Repo[];
}

export async function getRepo(id: string): Promise<Repo | null> {
  const { data } = await supabase
    .from("permawrite_repos")
    .select("*")
    .eq("id", id)
    .single();

  return (data as Repo) ?? null;
}

export async function updateRepo(
  id: string,
  updates: Partial<Pick<Repo, "display_name" | "description" | "visibility">>,
): Promise<Repo> {
  const { data, error } = await supabase
    .from("permawrite_repos")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Repo;
}

export async function deleteRepo(id: string): Promise<void> {
  const { error } = await supabase
    .from("permawrite_repos")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/*  Commits                                                            */
/* ------------------------------------------------------------------ */

export async function getCommits(repoId: string): Promise<RepoCommit[]> {
  const { data } = await supabase
    .from("permawrite_repo_commits")
    .select("*")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false });

  return (data ?? []) as RepoCommit[];
}

export async function getLatestCommit(repoId: string): Promise<RepoCommit | null> {
  const { data } = await supabase
    .from("permawrite_repo_commits")
    .select("*")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (data as RepoCommit) ?? null;
}

/**
 * Commit files to a repo:
 * 1. Upload each file to Arweave (tagged with repo slug)
 * 2. Build a manifest JSON listing all files + tx IDs
 * 3. Upload the manifest to Arweave
 * 4. Insert a commit row in Supabase pointing to the manifest tx
 * 5. Update the repo's latest_commit_tx, commit_count, total_size
 */
export async function commitFiles(opts: {
  repo: Repo;
  files: File[];
  message: string;
  jwk: JsonWebKey;
  preferredMethod?: UploadMethod;
  onFileProgress?: (idx: number, total: number, fileName: string) => void;
}): Promise<RepoCommit> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const gw = new ArweaveGateway();
  const { repo, files, message, jwk, preferredMethod = "turbo" } = opts;

  const parentCommit = await getLatestCommit(repo.id);

  const uploadedFiles: RepoFile[] = [];
  let totalSize = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    opts.onFileProgress?.(i, files.length, file.name);

    const fileTags: ArweaveTag[] = [
      { name: "Content-Type", value: file.type || "application/octet-stream" },
      { name: "App-Name", value: "PermaWrite" },
      { name: "App-Version", value: "1.0" },
      { name: "PermaWrite-Type", value: "repo-file" },
      { name: "Repo-Slug", value: repo.slug },
      { name: "Repo-Id", value: repo.id },
      { name: "File-Path", value: file.webkitRelativePath || file.name },
    ];

    const result = await gw.smartUploadFile(file, fileTags, jwk, preferredMethod, file.name);
    if (result.status !== 200) throw new Error(`Upload failed for ${file.name}`);

    uploadedFiles.push({
      path: file.webkitRelativePath || file.name,
      tx_id: result.txId,
      size: file.size,
      content_type: file.type || "application/octet-stream",
    });
    totalSize += file.size;
  }

  opts.onFileProgress?.(files.length, files.length, "manifest");

  const manifest = {
    type: "permawrite-repo-commit",
    version: "1.0",
    repo_slug: repo.slug,
    repo_id: repo.id,
    repo_name: repo.display_name,
    message,
    parent_commit: parentCommit?.manifest_tx ?? null,
    timestamp: new Date().toISOString(),
    files: uploadedFiles,
  };

  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  const manifestTags: ArweaveTag[] = [
    { name: "Content-Type", value: "application/json" },
    { name: "App-Name", value: "PermaWrite" },
    { name: "App-Version", value: "1.0" },
    { name: "PermaWrite-Type", value: "repo-manifest" },
    { name: "Repo-Slug", value: repo.slug },
    { name: "Repo-Id", value: repo.id },
    { name: "Commit-Message", value: message.slice(0, 150) },
  ];
  if (parentCommit?.manifest_tx) {
    manifestTags.push({ name: "Parent-Commit", value: parentCommit.manifest_tx });
  }

  const manifestBuf = new Uint8Array(await manifestBlob.arrayBuffer());
  const manifestResult = await gw.smartUploadData(
    manifestBuf, manifestTags, jwk, preferredMethod, `${repo.slug}-manifest`,
  );
  if (manifestResult.status !== 200) throw new Error("Manifest upload failed");

  const { data: commit, error: commitErr } = await supabase
    .from("permawrite_repo_commits")
    .insert({
      user_id: userId,
      repo_id: repo.id,
      message,
      parent_commit_id: parentCommit?.id ?? null,
      manifest_tx: manifestResult.txId,
      files: uploadedFiles,
      total_size: totalSize,
    })
    .select()
    .single();

  if (commitErr) throw new Error(commitErr.message);

  await supabase
    .from("permawrite_repos")
    .update({
      latest_commit_tx: manifestResult.txId,
      commit_count: repo.commit_count + 1,
      total_size: repo.total_size + totalSize,
      updated_at: new Date().toISOString(),
    })
    .eq("id", repo.id);

  return commit as RepoCommit;
}

/* ------------------------------------------------------------------ */
/*  Diff computation                                                   */
/* ------------------------------------------------------------------ */

export interface FileDiff {
  path: string;
  status: "added" | "modified" | "removed" | "unchanged";
  file?: RepoFile;
  previousFile?: RepoFile;
}

export function computeDiff(
  current: RepoFile[],
  previous: RepoFile[],
): FileDiff[] {
  const prevMap = new Map<string, RepoFile>();
  for (const f of previous) prevMap.set(f.path, f);

  const currMap = new Map<string, RepoFile>();
  for (const f of current) currMap.set(f.path, f);

  const diffs: FileDiff[] = [];

  for (const f of current) {
    const prev = prevMap.get(f.path);
    if (!prev) {
      diffs.push({ path: f.path, status: "added", file: f });
    } else if (prev.tx_id !== f.tx_id) {
      diffs.push({ path: f.path, status: "modified", file: f, previousFile: prev });
    } else {
      diffs.push({ path: f.path, status: "unchanged", file: f });
    }
  }

  for (const f of previous) {
    if (!currMap.has(f.path)) {
      diffs.push({ path: f.path, status: "removed", previousFile: f });
    }
  }

  return diffs.sort((a, b) => {
    const order = { added: 0, modified: 1, removed: 2, unchanged: 3 };
    return order[a.status] - order[b.status] || a.path.localeCompare(b.path);
  });
}

export function diffSummary(diffs: FileDiff[]): { added: number; modified: number; removed: number } {
  let added = 0, modified = 0, removed = 0;
  for (const d of diffs) {
    if (d.status === "added") added++;
    else if (d.status === "modified") modified++;
    else if (d.status === "removed") removed++;
  }
  return { added, modified, removed };
}

/* ------------------------------------------------------------------ */
/*  Fetch file content from Arweave                                    */
/* ------------------------------------------------------------------ */

export async function fetchFileContent(txId: string): Promise<{ text: string; truncated: boolean }> {
  const MAX = 200_000;
  const res = await fetch(`https://arweave.net/${txId}`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.startsWith("image/") || ct.startsWith("video/") || ct.startsWith("audio/")) {
    return { text: `[Binary content: ${ct}]`, truncated: false };
  }
  const text = await res.text();
  if (text.length > MAX) return { text: text.slice(0, MAX), truncated: true };
  return { text, truncated: false };
}

export function isPreviewableText(contentType: string): boolean {
  if (contentType.startsWith("text/")) return true;
  if (contentType.includes("json") || contentType.includes("xml") || contentType.includes("javascript")
    || contentType.includes("typescript") || contentType.includes("yaml") || contentType.includes("toml")
    || contentType.includes("markdown") || contentType.includes("sql") || contentType.includes("csv")
    || contentType.includes("html") || contentType.includes("css") || contentType.includes("script")) return true;
  return false;
}

export function isPreviewableImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/* ------------------------------------------------------------------ */
/*  File helpers                                                       */
/* ------------------------------------------------------------------ */

const CODE_EXT: Record<string, string> = {
  js: "JavaScript", ts: "TypeScript", jsx: "React JSX", tsx: "React TSX",
  py: "Python", rs: "Rust", go: "Go", rb: "Ruby", java: "Java",
  c: "C", cpp: "C++", cs: "C#", swift: "Swift", kt: "Kotlin",
  php: "PHP", sh: "Shell", bash: "Bash", zsh: "Zsh",
  html: "HTML", css: "CSS", scss: "SCSS", less: "LESS",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML",
  md: "Markdown", txt: "Text", sql: "SQL", sol: "Solidity",
  dockerfile: "Dockerfile", makefile: "Makefile",
  gitignore: "Gitignore", env: "Env",
};

export function detectLanguage(path: string): string | null {
  const name = path.split("/").pop()?.toLowerCase() || "";
  if (CODE_EXT[name]) return CODE_EXT[name];
  const ext = name.split(".").pop() || "";
  return CODE_EXT[ext] || null;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
