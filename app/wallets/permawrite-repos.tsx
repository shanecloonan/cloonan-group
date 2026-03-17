"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useWallet } from "@/lib/wallet-context";
import {
  type Repo, type RepoCommit, type RepoFile,
  getMyRepos, createRepo, updateRepo, deleteRepo,
  getCommits, commitFiles, slugify, detectLanguage, formatBytes,
} from "@/lib/permawrite-repos";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-9 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/80 text-xs placeholder:text-white/20 outline-none focus:border-purple-400/40 focus:ring-1 focus:ring-purple-400/20 transition-all";
const btnPrimary = "h-9 px-5 rounded-xl text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/20 hover:bg-purple-500/30 active:scale-[0.97] transition-all cursor-pointer";
const btnGhost = "h-8 px-3.5 rounded-lg text-[11px] font-medium bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer";

type View = "list" | "create" | "detail" | "commit";

/* ------------------------------------------------------------------ */
/*  File tree helpers                                                  */
/* ------------------------------------------------------------------ */

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: RepoFile;
}

function buildTree(files: RepoFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const f of files) {
    const parts = f.path.split("/");
    let level = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let node = level.find((n) => n.name === name);
      if (!node) {
        node = { name, path: fullPath, isDir: !isLast, children: [], file: isLast ? f : undefined };
        level.push(node);
      }
      level = node.children;
    }
  }

  return root;
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => ({ ...n, children: sortTree(n.children) }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/* ------------------------------------------------------------------ */
/*  Tree item component                                                */
/* ------------------------------------------------------------------ */

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const lang = node.file ? detectLanguage(node.path) : null;

  const ext = node.name.split(".").pop()?.toLowerCase() || "";
  const colorMap: Record<string, string> = {
    ts: "text-blue-400", tsx: "text-blue-400", js: "text-yellow-400", jsx: "text-yellow-400",
    py: "text-green-400", rs: "text-orange-400", go: "text-cyan-400", json: "text-amber-300",
    md: "text-white/60", html: "text-red-400", css: "text-purple-400", sol: "text-violet-400",
  };
  const nameColor = node.isDir ? "text-cyan-300/70" : (colorMap[ext] || "text-white/50");

  return (
    <div>
      <button
        type="button"
        onClick={() => node.isDir ? setOpen(!open) : undefined}
        className={`w-full flex items-center gap-2 py-1 px-2 rounded-lg text-left hover:bg-white/[0.03] transition-colors ${node.isDir ? "cursor-pointer" : "cursor-default"}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.isDir ? (
          <span className="text-[10px] text-white/25 w-3 text-center">{open ? "▾" : "▸"}</span>
        ) : (
          <span className="text-[10px] text-white/15 w-3 text-center">·</span>
        )}
        <span className={`text-xs font-mono ${nameColor}`}>{node.name}</span>
        {lang && <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/25 ml-auto">{lang}</span>}
        {node.file && <span className="text-[9px] text-white/20 ml-auto">{formatBytes(node.file.size)}</span>}
      </button>
      {node.isDir && open && node.children.map((c) => <TreeItem key={c.path} node={c} depth={depth + 1} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PermawriteRepos() {
  const { arweaveWallet } = useWallet();
  const [view, setView] = useState<View>("list");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [commits, setCommits] = useState<RepoCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newVis, setNewVis] = useState<"private" | "public">("private");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");

  const [commitFiles_, setCommitFiles] = useState<File[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState("");
  const [commitErr, setCommitErr] = useState("");

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRepos(await getMyRepos()); setLoaded(true); }
    catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!loaded) load(); }, [loaded, load]);

  const openRepo = useCallback(async (repo: Repo) => {
    setSelectedRepo(repo);
    setView("detail");
    setCommitsLoading(true);
    try { setCommits(await getCommits(repo.id)); }
    catch { /* silent */ }
    finally { setCommitsLoading(false); }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) { setCreateErr("Name is required"); return; }
    setCreating(true);
    setCreateErr("");
    try {
      const repo = await createRepo({
        slug: newSlug.trim() || undefined,
        displayName: newName.trim(),
        description: newDesc.trim() || undefined,
        visibility: newVis,
      });
      setRepos((prev) => [repo, ...prev]);
      setView("list");
      setNewName(""); setNewSlug(""); setNewDesc(""); setNewVis("private");
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : "Failed to create repo");
    } finally { setCreating(false); }
  }, [newName, newSlug, newDesc, newVis]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteRepo(id);
      setRepos((prev) => prev.filter((r) => r.id !== id));
      if (selectedRepo?.id === id) { setView("list"); setSelectedRepo(null); }
    } catch { /* silent */ }
    setConfirmDelete(null);
  }, [selectedRepo]);

  const handleCommit = useCallback(async () => {
    if (!selectedRepo || !arweaveWallet || commitFiles_.length === 0) return;
    setCommitting(true);
    setCommitErr("");
    setCommitProgress("Starting...");
    try {
      const commit = await commitFiles({
        repo: selectedRepo,
        files: commitFiles_,
        message: commitMsg.trim() || "Update files",
        jwk: arweaveWallet.jwk,
        onFileProgress: (idx, total, name) => {
          if (idx < total) setCommitProgress(`Uploading ${idx + 1}/${total}: ${name}`);
          else setCommitProgress("Uploading manifest...");
        },
      });
      setCommits((prev) => [commit, ...prev]);
      setSelectedRepo((prev) => prev ? { ...prev, commit_count: prev.commit_count + 1, latest_commit_tx: commit.manifest_tx } : prev);
      setRepos((prev) => prev.map((r) => r.id === selectedRepo.id ? { ...r, commit_count: r.commit_count + 1, latest_commit_tx: commit.manifest_tx } : r));
      setCommitFiles([]); setCommitMsg(""); setView("detail");
      setCommitProgress("");
    } catch (e: unknown) {
      setCommitErr(e instanceof Error ? e.message : "Commit failed");
    } finally { setCommitting(false); }
  }, [selectedRepo, arweaveWallet, commitFiles_, commitMsg]);

  const autoSlug = useMemo(() => slugify(newName), [newName]);

  /* ---- No wallet ---- */
  if (!arweaveWallet) {
    return (
      <div className={`${card} p-10 text-center`}>
        <p className="text-sm text-white/30">Connect an Arweave wallet to use repos.</p>
      </div>
    );
  }

  /* ---- CREATE VIEW ---- */
  if (view === "create") {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setView("list")} className={`${btnGhost} mb-2`}>← Back</button>

        <div className={`${card} p-5 space-y-4`}>
          <h3 className="text-sm font-semibold text-white/80">New Repository</h3>

          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Repository Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My Project" className={inputCls} />
          </div>

          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">
              Slug <span className="text-white/15">(unique identifier — leave blank to auto-generate)</span>
            </label>
            <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder={autoSlug || "auto-generated"} className={inputCls} />
            {newName && !newSlug && <p className="text-[10px] text-white/20 mt-1">Will use: <span className="font-mono text-purple-300/40">{autoSlug}</span></p>}
          </div>

          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Description</label>
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Optional description" className={inputCls} />
          </div>

          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Visibility</label>
            <div className="flex gap-2">
              {(["private", "public"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setNewVis(v)}
                  className={`h-8 px-4 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${newVis === v ? "bg-purple-500/20 text-purple-300 border-purple-500/20" : "bg-white/[0.03] text-white/30 border-white/[0.06] hover:text-white/50"}`}>
                  {v === "private" ? "Private" : "Public"}
                </button>
              ))}
            </div>
          </div>

          {createErr && <p className="text-xs text-red-400">{createErr}</p>}

          <button type="button" onClick={handleCreate} disabled={creating || !newName.trim()} className={btnPrimary}>
            {creating ? "Creating..." : "Create Repository"}
          </button>
        </div>
      </div>
    );
  }

  /* ---- COMMIT VIEW ---- */
  if (view === "commit" && selectedRepo) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setView("detail")} className={`${btnGhost} mb-2`}>← Back to {selectedRepo.display_name}</button>

        <div className={`${card} p-5 space-y-4`}>
          <h3 className="text-sm font-semibold text-white/80">
            Commit to <span className="font-mono text-purple-300/60">{selectedRepo.slug}</span>
          </h3>

          {/* File selection */}
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Select Files</label>
            <div className={`${card} p-4 text-center border-dashed`}>
              <input
                type="file"
                multiple
                onChange={(e) => setCommitFiles(Array.from(e.target.files || []))}
                className="block w-full text-xs text-white/40 file:mr-3 file:h-8 file:px-4 file:rounded-lg file:border file:border-white/[0.08] file:bg-white/[0.04] file:text-white/50 file:text-[11px] file:font-medium file:cursor-pointer hover:file:bg-white/[0.08] file:transition-all"
              />
              <p className="text-[10px] text-white/15 mt-2">
                Select individual files or use the folder picker below for directories.
              </p>
              <input
                type="file"
                /* @ts-expect-error webkitdirectory is non-standard */
                webkitdirectory=""
                multiple
                onChange={(e) => setCommitFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                className="mt-2 block w-full text-xs text-white/40 file:mr-3 file:h-8 file:px-4 file:rounded-lg file:border file:border-white/[0.08] file:bg-white/[0.04] file:text-white/50 file:text-[11px] file:font-medium file:cursor-pointer hover:file:bg-white/[0.08] file:transition-all"
              />
            </div>
          </div>

          {/* Selected files preview */}
          {commitFiles_.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">{commitFiles_.length} files selected</span>
                <span className="text-[10px] text-white/20">{formatBytes(commitFiles_.reduce((s, f) => s + f.size, 0))}</span>
              </div>
              <div className={`${card} p-2 max-h-48 overflow-y-auto space-y-0.5`}>
                {commitFiles_.map((f, i) => {
                  const lang = detectLanguage(f.webkitRelativePath || f.name);
                  return (
                    <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/[0.02]">
                      <span className="text-[10px] text-white/15 w-3 text-center">·</span>
                      <span className="text-xs font-mono text-white/50 truncate flex-1">{f.webkitRelativePath || f.name}</span>
                      {lang && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/60 border border-emerald-500/15">{lang}</span>}
                      <span className="text-[9px] text-white/20">{formatBytes(f.size)}</span>
                      <button type="button" onClick={() => setCommitFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-[10px] text-red-400/40 hover:text-red-400 transition-colors cursor-pointer">✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Commit message */}
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Commit Message</label>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Describe your changes..." className={inputCls} />
          </div>

          {commitErr && <p className="text-xs text-red-400">{commitErr}</p>}
          {commitProgress && <p className="text-xs text-purple-300/60">{commitProgress}</p>}

          <button type="button" onClick={handleCommit} disabled={committing || commitFiles_.length === 0}
            className={`${btnPrimary} ${committing ? "opacity-50" : ""}`}>
            {committing ? "Committing..." : `Commit ${commitFiles_.length} file${commitFiles_.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    );
  }

  /* ---- DETAIL VIEW ---- */
  if (view === "detail" && selectedRepo) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => { setView("list"); setSelectedRepo(null); }} className={`${btnGhost} mb-2`}>← All Repos</button>

        {/* Repo header */}
        <div className={`${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white/80 truncate">{selectedRepo.display_name}</h3>
              <p className="text-xs font-mono text-purple-300/40 mt-0.5">{selectedRepo.slug}</p>
              {selectedRepo.description && <p className="text-xs text-white/30 mt-2">{selectedRepo.description}</p>}
            </div>
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase shrink-0 ${selectedRepo.visibility === "public" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/5 text-white/30 border border-white/10"}`}>
              {selectedRepo.visibility}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <div><p className="text-lg font-bold text-white tabular-nums">{selectedRepo.commit_count}</p><p className="text-[10px] text-white/25 uppercase">Commits</p></div>
            <div><p className="text-lg font-bold text-white tabular-nums">{formatBytes(selectedRepo.total_size)}</p><p className="text-[10px] text-white/25 uppercase">Total Size</p></div>
            <div>
              <p className="text-[10px] text-white/25 mt-1">
                {selectedRepo.latest_commit_tx
                  ? <span className="font-mono text-purple-300/30 text-[10px]">{selectedRepo.latest_commit_tx.slice(0, 12)}...</span>
                  : <span className="text-white/15">No commits</span>}
              </p>
              <p className="text-[10px] text-white/25 uppercase">Latest TX</p>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setView("commit")} className={btnPrimary}>+ New Commit</button>
            {confirmDelete === selectedRepo.id ? (
              <div className="flex gap-1.5 items-center">
                <button type="button" onClick={() => handleDelete(selectedRepo.id)} className="h-8 px-3 rounded-lg text-[11px] font-medium bg-red-500/20 text-red-400 border border-red-500/20 cursor-pointer transition-all hover:bg-red-500/30">Confirm Delete</button>
                <button type="button" onClick={() => setConfirmDelete(null)} className={btnGhost}>Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(selectedRepo.id)} className={btnGhost}>Delete</button>
            )}
          </div>
        </div>

        {/* Commits */}
        <div>
          <span className="text-xs font-medium text-white/30 uppercase tracking-wider block mb-3">Commit History</span>

          {commitsLoading && (
            <div className={`${card} p-8 text-center`}>
              <div className="w-4 h-4 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto" />
            </div>
          )}

          {!commitsLoading && commits.length === 0 && (
            <div className={`${card} p-8 text-center`}>
              <p className="text-sm text-white/25">No commits yet.</p>
              <p className="text-xs text-white/15 mt-1">Click &ldquo;New Commit&rdquo; to push your first files.</p>
            </div>
          )}

          {commits.length > 0 && (
            <div className="space-y-1.5">
              {commits.map((c, idx) => {
                const isOpen = expandedCommit === c.id;
                const tree = isOpen ? sortTree(buildTree(c.files)) : [];
                return (
                  <div key={c.id} className={`${card} overflow-hidden ${isOpen ? "ring-1 ring-purple-500/20" : ""}`}>
                    <button type="button" onClick={() => setExpandedCommit(isOpen ? null : c.id)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/[0.015] transition-colors cursor-pointer">

                      {/* Commit graph line */}
                      <div className="flex flex-col items-center w-5 shrink-0">
                        <div className={`w-2.5 h-2.5 rounded-full border-2 ${idx === 0 ? "bg-purple-500/40 border-purple-400/60" : "bg-white/5 border-white/15"}`} />
                        {idx < commits.length - 1 && <div className="w-px flex-1 bg-white/[0.06] mt-0.5 min-h-[8px]" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/70 truncate">{c.message}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] text-white/20">{new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-[10px] text-white/15">{c.files.length} file{c.files.length !== 1 ? "s" : ""}</span>
                          <span className="text-[10px] text-white/15">{formatBytes(c.total_size)}</span>
                          {c.manifest_tx && <span className="text-[9px] font-mono text-purple-300/25 truncate max-w-[100px]">{c.manifest_tx}</span>}
                        </div>
                      </div>

                      <span className={`text-white/15 text-sm shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-white/[0.04]">
                        {/* File tree */}
                        <div className="mt-3 mb-2">
                          <span className="text-[10px] text-white/25 uppercase tracking-wider">Files</span>
                        </div>
                        <div className={`${card} p-2 max-h-64 overflow-y-auto`}>
                          {tree.map((n) => <TreeItem key={n.path} node={n} depth={0} />)}
                        </div>

                        {/* Flat file list with links */}
                        <div className="mt-3 space-y-1">
                          {c.files.map((f) => (
                            <div key={f.tx_id} className="flex items-center gap-2 text-[10px]">
                              <span className="font-mono text-white/30 truncate flex-1">{f.path}</span>
                              <a href={`https://arweave.net/${f.tx_id}`} target="_blank" rel="noopener noreferrer"
                                className="text-purple-400/50 hover:text-purple-300 transition-colors shrink-0">view</a>
                            </div>
                          ))}
                        </div>

                        {/* Manifest link */}
                        {c.manifest_tx && (
                          <div className="mt-3 pt-3 border-t border-white/[0.04]">
                            <span className="text-[10px] text-white/25">Manifest: </span>
                            <a href={`https://arweave.net/${c.manifest_tx}`} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] font-mono text-purple-400/50 hover:text-purple-300 transition-colors">{c.manifest_tx}</a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---- LIST VIEW ---- */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/30 uppercase tracking-wider">My Repositories</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setLoaded(false)} disabled={loading} className={btnGhost}>
            {loading ? <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin inline-block" /> : "Refresh"}
          </button>
          <button type="button" onClick={() => setView("create")} className={btnPrimary}>+ New Repo</button>
        </div>
      </div>

      {loading && !loaded && (
        <div className={`${card} p-10 text-center`}>
          <div className="w-5 h-5 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-white/30">Loading repos...</p>
        </div>
      )}

      {loaded && repos.length === 0 && (
        <div className={`${card} p-10 text-center`}>
          <p className="text-sm text-white/30">No repositories yet.</p>
          <p className="text-xs text-white/20 mt-1">Create one to start uploading code to Arweave.</p>
        </div>
      )}

      {repos.length > 0 && (
        <div className="space-y-1.5">
          {repos.map((r) => (
            <button key={r.id} type="button" onClick={() => openRepo(r)}
              className={`${card} w-full text-left px-4 py-3.5 hover:bg-white/[0.015] transition-colors cursor-pointer`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white/70">{r.display_name}</span>
                    <span className="text-[10px] font-mono text-purple-300/30">{r.slug}</span>
                  </div>
                  {r.description && <p className="text-[10px] text-white/25 mt-0.5 truncate">{r.description}</p>}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-white/20">{r.commit_count} commit{r.commit_count !== 1 ? "s" : ""}</span>
                    {r.total_size > 0 && <span className="text-[10px] text-white/15">{formatBytes(r.total_size)}</span>}
                    <span className="text-[10px] text-white/15">{new Date(r.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase ${r.visibility === "public" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/5 text-white/30 border border-white/10"}`}>
                    {r.visibility}
                  </span>
                  <span className="text-white/15 text-sm">▸</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
