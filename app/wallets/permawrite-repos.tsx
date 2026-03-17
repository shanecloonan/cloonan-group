"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useWallet } from "@/lib/wallet-context";
import {
  type Repo, type RepoCommit, type RepoFile, type FileDiff,
  getMyRepos, createRepo, updateRepo, deleteRepo,
  getCommits, commitFiles, slugify, detectLanguage, formatBytes,
  computeDiff, diffSummary, fetchFileContent, isPreviewableText, isPreviewableImage,
} from "@/lib/permawrite-repos";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-9 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/80 text-xs placeholder:text-white/20 outline-none focus:border-purple-400/40 focus:ring-1 focus:ring-purple-400/20 transition-all";
const btnPrimary = "h-9 px-5 rounded-xl text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/20 hover:bg-purple-500/30 active:scale-[0.97] transition-all cursor-pointer disabled:opacity-40";
const btnGhost = "h-8 px-3.5 rounded-lg text-[11px] font-medium bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer";

type View = "list" | "create" | "detail" | "commit" | "file-view";
type DetailTab = "files" | "commits" | "settings";

/* ------------------------------------------------------------------ */
/*  Tree                                                               */
/* ------------------------------------------------------------------ */

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: RepoFile;
  diffStatus?: FileDiff["status"];
}

function buildTree(files: RepoFile[], diffs?: FileDiff[]): TreeNode[] {
  const diffMap = new Map<string, FileDiff["status"]>();
  if (diffs) for (const d of diffs) diffMap.set(d.path, d.status);

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
        node = {
          name, path: fullPath, isDir: !isLast, children: [],
          file: isLast ? f : undefined,
          diffStatus: isLast ? diffMap.get(f.path) : undefined,
        };
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

function countFiles(nodes: TreeNode[]): number {
  let c = 0;
  for (const n of nodes) { if (!n.isDir) c++; c += countFiles(n.children); }
  return c;
}

const extColor: Record<string, string> = {
  ts: "text-blue-400", tsx: "text-blue-400", js: "text-yellow-400", jsx: "text-yellow-400",
  py: "text-green-400", rs: "text-orange-400", go: "text-cyan-400", json: "text-amber-300",
  md: "text-white/60", html: "text-red-400", css: "text-purple-400", sol: "text-violet-400",
  yaml: "text-pink-300", yml: "text-pink-300", toml: "text-amber-400", sh: "text-green-300",
  sql: "text-cyan-300", dockerfile: "text-blue-300", gitignore: "text-white/30",
};

const diffIcon: Record<string, { char: string; color: string }> = {
  added: { char: "+", color: "text-emerald-400" },
  modified: { char: "~", color: "text-amber-400" },
  removed: { char: "-", color: "text-red-400" },
};

function TreeItem({ node, depth, onFileClick }: { node: TreeNode; depth: number; onFileClick?: (f: RepoFile) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const lang = node.file ? detectLanguage(node.path) : null;
  const ext = node.name.split(".").pop()?.toLowerCase() || "";
  const nameColor = node.isDir ? "text-cyan-300/70" : (extColor[ext] || "text-white/50");
  const di = node.diffStatus && node.diffStatus !== "unchanged" ? diffIcon[node.diffStatus] : null;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (node.isDir) setOpen(!open);
          else if (node.file && onFileClick) onFileClick(node.file);
        }}
        className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-lg text-left hover:bg-white/[0.04] transition-colors cursor-pointer group`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.isDir ? (
          <span className="text-[10px] text-white/25 w-3 text-center shrink-0">{open ? "▾" : "▸"}</span>
        ) : (
          <span className={`text-[10px] w-3 text-center shrink-0 ${di ? di.color : "text-white/10"}`}>
            {di ? di.char : "·"}
          </span>
        )}
        <span className={`text-xs font-mono truncate ${nameColor} ${node.diffStatus === "removed" ? "line-through opacity-50" : ""}`}>
          {node.name}
        </span>
        {lang && <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/20 ml-auto shrink-0 hidden sm:inline">{lang}</span>}
        {node.file && <span className="text-[9px] text-white/15 ml-auto shrink-0">{formatBytes(node.file.size)}</span>}
        {!node.isDir && <span className="text-[9px] text-purple-400/0 group-hover:text-purple-400/40 transition-colors shrink-0 ml-1">→</span>}
      </button>
      {node.isDir && open && node.children.map((c) => <TreeItem key={c.path} node={c} depth={depth + 1} onFileClick={onFileClick} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Copy button                                                        */
/* ------------------------------------------------------------------ */

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
      className="text-[10px] text-purple-400/40 hover:text-purple-300 transition-colors cursor-pointer shrink-0">
      {copied ? "Copied!" : (label || "Copy")}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  File viewer                                                        */
/* ------------------------------------------------------------------ */

function FileViewer({ file, onBack }: { file: RepoFile; onBack: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const lang = detectLanguage(file.path);
  const isText = isPreviewableText(file.content_type);
  const isImage = isPreviewableImage(file.content_type);

  useEffect(() => {
    if (!isText && !isImage) return;
    if (isImage) return;
    setLoading(true);
    fetchFileContent(file.tx_id)
      .then((r) => { setContent(r.text); setTruncated(r.truncated); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [file.tx_id, isText, isImage]);

  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onBack} className={btnGhost}>← Back</button>
        <span className="text-xs font-mono text-white/50 truncate flex-1">{file.path}</span>
        {lang && <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400/60 border border-emerald-500/15">{lang}</span>}
      </div>

      <div className={`${card} overflow-hidden`}>
        {/* File info bar */}
        <div className="px-4 py-2.5 border-b border-white/[0.04] flex items-center gap-3 flex-wrap">
          <span className="text-[10px] text-white/30">{formatBytes(file.size)}</span>
          <span className="text-[10px] text-white/20">{file.content_type}</span>
          {isText && content && <span className="text-[10px] text-white/20">{lineCount} lines</span>}
          <div className="ml-auto flex gap-2">
            <CopyBtn text={file.tx_id} label="Copy TX" />
            <a href={`https://arweave.net/${file.tx_id}`} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-purple-400/40 hover:text-purple-300 transition-colors">Raw</a>
          </div>
        </div>

        {/* Content */}
        {loading && (
          <div className="p-8 text-center">
            <div className="w-4 h-4 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto mb-2" />
            <p className="text-[10px] text-white/20">Fetching from Arweave...</p>
          </div>
        )}
        {error && <div className="p-6 text-center text-xs text-red-400/60">{error}</div>}

        {isImage && (
          <div className="p-4 flex justify-center bg-black/20">
            <img src={`https://arweave.net/${file.tx_id}`} alt={file.path} className="max-w-full max-h-[400px] rounded-lg" />
          </div>
        )}

        {isText && content !== null && (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <pre className="text-[11px] leading-[1.6] font-mono">
              {content.split("\n").map((line, i) => (
                <div key={i} className="flex hover:bg-white/[0.02] transition-colors">
                  <span className="w-12 shrink-0 text-right pr-3 text-white/10 select-none border-r border-white/[0.04]">{i + 1}</span>
                  <span className="pl-3 pr-4 text-white/50 whitespace-pre">{line}</span>
                </div>
              ))}
            </pre>
            {truncated && (
              <div className="px-4 py-2 border-t border-white/[0.04] text-center">
                <p className="text-[10px] text-amber-400/50">File truncated at 200KB — <a href={`https://arweave.net/${file.tx_id}`} target="_blank" rel="noopener noreferrer" className="underline">view full file</a></p>
              </div>
            )}
          </div>
        )}

        {!isText && !isImage && (
          <div className="p-8 text-center">
            <p className="text-sm text-white/25">{file.content_type}</p>
            <p className="text-xs text-white/15 mt-1">Binary file — cannot preview</p>
            <a href={`https://arweave.net/${file.tx_id}`} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-3 text-[11px] text-purple-400/60 hover:text-purple-300 transition-colors">Download from Arweave →</a>
          </div>
        )}
      </div>
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
  const [detailTab, setDetailTab] = useState<DetailTab>("files");
  const [commits, setCommits] = useState<RepoCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);

  const [viewingFile, setViewingFile] = useState<RepoFile | null>(null);
  const [fileSearch, setFileSearch] = useState("");

  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newVis, setNewVis] = useState<"private" | "public">("private");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");

  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editVis, setEditVis] = useState<"private" | "public">("private");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [commitFiles_, setCommitFiles] = useState<File[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState("");
  const [commitErr, setCommitErr] = useState("");

  const [confirmDelete, setConfirmDelete] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

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
    setDetailTab("files");
    setExpandedCommit(null);
    setViewingFile(null);
    setFileSearch("");
    setEditName(repo.display_name);
    setEditDesc(repo.description || "");
    setEditVis(repo.visibility);
    setSaveMsg("");
    setConfirmDelete(false);
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

  const handleSave = useCallback(async () => {
    if (!selectedRepo) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const updated = await updateRepo(selectedRepo.id, {
        display_name: editName.trim(),
        description: editDesc.trim() || null,
        visibility: editVis,
      });
      setSelectedRepo(updated);
      setRepos((prev) => prev.map((r) => r.id === updated.id ? updated : r));
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }, [selectedRepo, editName, editDesc, editVis]);

  const handleDelete = useCallback(async () => {
    if (!selectedRepo) return;
    try {
      await deleteRepo(selectedRepo.id);
      setRepos((prev) => prev.filter((r) => r.id !== selectedRepo.id));
      setView("list"); setSelectedRepo(null);
    } catch { /* silent */ }
    setConfirmDelete(false);
  }, [selectedRepo]);

  const handleCommit = useCallback(async () => {
    if (!selectedRepo || !arweaveWallet || commitFiles_.length === 0) return;
    setCommitting(true); setCommitErr(""); setCommitProgress("Starting...");
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
      const updatedRepo = { ...selectedRepo, commit_count: selectedRepo.commit_count + 1, latest_commit_tx: commit.manifest_tx, total_size: selectedRepo.total_size + commit.total_size };
      setSelectedRepo(updatedRepo);
      setRepos((prev) => prev.map((r) => r.id === selectedRepo.id ? updatedRepo : r));
      setCommitFiles([]); setCommitMsg(""); setView("detail"); setDetailTab("commits");
      setCommitProgress("");
    } catch (e: unknown) {
      setCommitErr(e instanceof Error ? e.message : "Commit failed");
    } finally { setCommitting(false); }
  }, [selectedRepo, arweaveWallet, commitFiles_, commitMsg]);

  const autoSlug = useMemo(() => slugify(newName), [newName]);

  const latestFiles = useMemo(() => commits.length > 0 ? commits[0].files : [], [commits]);

  const filteredFiles = useMemo(() => {
    if (!fileSearch.trim()) return latestFiles;
    const q = fileSearch.toLowerCase();
    return latestFiles.filter((f) => f.path.toLowerCase().includes(q) || (detectLanguage(f.path) || "").toLowerCase().includes(q));
  }, [latestFiles, fileSearch]);

  const latestTree = useMemo(() => sortTree(buildTree(filteredFiles)), [filteredFiles]);

  const commitDiffs = useMemo(() => {
    const map = new Map<string, { diffs: FileDiff[]; summary: { added: number; modified: number; removed: number } }>();
    for (let i = 0; i < commits.length; i++) {
      const curr = commits[i];
      const prev = i + 1 < commits.length ? commits[i + 1] : null;
      const diffs = computeDiff(curr.files, prev?.files ?? []);
      map.set(curr.id, { diffs, summary: diffSummary(diffs) });
    }
    return map;
  }, [commits]);

  if (!arweaveWallet) {
    return (
      <div className={`${card} p-10 text-center`}>
        <p className="text-sm text-white/30">Connect an Arweave wallet to use repos.</p>
      </div>
    );
  }

  /* ================================================================ */
  /*  FILE VIEW                                                        */
  /* ================================================================ */
  if (view === "file-view" && viewingFile && selectedRepo) {
    return (
      <FileViewer
        file={viewingFile}
        onBack={() => { setView("detail"); setViewingFile(null); }}
      />
    );
  }

  /* ================================================================ */
  /*  CREATE VIEW                                                      */
  /* ================================================================ */
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

  /* ================================================================ */
  /*  COMMIT VIEW                                                      */
  /* ================================================================ */
  if (view === "commit" && selectedRepo) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setView("detail")} className={`${btnGhost} mb-2`}>← Back to {selectedRepo.display_name}</button>
        <div className={`${card} p-5 space-y-4`}>
          <h3 className="text-sm font-semibold text-white/80">
            Commit to <span className="font-mono text-purple-300/60">{selectedRepo.slug}</span>
          </h3>

          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Select Files</label>
            <div className={`${card} p-4 border-dashed`}>
              <div className="flex gap-2 flex-wrap justify-center">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className={`${btnGhost} inline-flex items-center gap-1.5`}>
                  <span className="text-[10px]">📄</span> Select Files
                </button>
                <button type="button" onClick={() => dirInputRef.current?.click()}
                  className={`${btnGhost} inline-flex items-center gap-1.5`}>
                  <span className="text-[10px]">📁</span> Select Folder
                </button>
              </div>
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={(e) => setCommitFiles((prev) => [...prev, ...Array.from(e.target.files || [])])} />
              <input ref={dirInputRef} type="file"
                /* @ts-expect-error webkitdirectory is non-standard */
                webkitdirectory="" multiple className="hidden"
                onChange={(e) => setCommitFiles((prev) => [...prev, ...Array.from(e.target.files || [])])} />
              {commitFiles_.length === 0 && <p className="text-[10px] text-white/15 mt-2 text-center">Drag and drop or use the buttons above</p>}
            </div>
          </div>

          {commitFiles_.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">{commitFiles_.length} files</span>
                <div className="flex gap-2 items-center">
                  <span className="text-[10px] text-white/20">{formatBytes(commitFiles_.reduce((s, f) => s + f.size, 0))}</span>
                  <button type="button" onClick={() => setCommitFiles([])} className="text-[10px] text-red-400/40 hover:text-red-400 transition-colors cursor-pointer">Clear all</button>
                </div>
              </div>
              <div className={`${card} p-2 max-h-52 overflow-y-auto space-y-0.5`}>
                {commitFiles_.map((f, i) => {
                  const lang = detectLanguage(f.webkitRelativePath || f.name);
                  const ext = (f.webkitRelativePath || f.name).split(".").pop()?.toLowerCase() || "";
                  return (
                    <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/[0.02]">
                      <span className={`text-[10px] w-3 text-center ${extColor[ext] ? extColor[ext].replace("text-", "text-") : "text-white/15"}`}>·</span>
                      <span className="text-xs font-mono text-white/50 truncate flex-1">{f.webkitRelativePath || f.name}</span>
                      {lang && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/60 border border-emerald-500/15 shrink-0">{lang}</span>}
                      <span className="text-[9px] text-white/20 shrink-0">{formatBytes(f.size)}</span>
                      <button type="button" onClick={() => setCommitFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-[10px] text-red-400/30 hover:text-red-400 transition-colors cursor-pointer shrink-0">✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Commit Message</label>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Describe your changes..."
              className={inputCls}
              onKeyDown={(e) => { if (e.key === "Enter" && !committing && commitFiles_.length > 0) handleCommit(); }}
            />
          </div>

          {commitErr && <p className="text-xs text-red-400">{commitErr}</p>}
          {commitProgress && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin shrink-0" />
              <p className="text-xs text-purple-300/60">{commitProgress}</p>
            </div>
          )}

          <button type="button" onClick={handleCommit} disabled={committing || commitFiles_.length === 0} className={btnPrimary}>
            {committing ? "Committing..." : `Commit ${commitFiles_.length} file${commitFiles_.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  DETAIL VIEW                                                      */
  /* ================================================================ */
  if (view === "detail" && selectedRepo) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => { setView("list"); setSelectedRepo(null); }} className={`${btnGhost} mb-1`}>← All Repos</button>

        {/* Repo header */}
        <div className={`${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white/80 truncate">{selectedRepo.display_name}</h3>
                <CopyBtn text={selectedRepo.slug} label={selectedRepo.slug} />
              </div>
              {selectedRepo.description && <p className="text-xs text-white/30 mt-1.5">{selectedRepo.description}</p>}
            </div>
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase shrink-0 ${selectedRepo.visibility === "public" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/5 text-white/30 border border-white/10"}`}>
              {selectedRepo.visibility}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div><p className="text-lg font-bold text-white tabular-nums">{selectedRepo.commit_count}</p><p className="text-[10px] text-white/25 uppercase">Commits</p></div>
            <div><p className="text-lg font-bold text-white tabular-nums">{latestFiles.length}</p><p className="text-[10px] text-white/25 uppercase">Files</p></div>
            <div><p className="text-lg font-bold text-white tabular-nums">{formatBytes(selectedRepo.total_size)}</p><p className="text-[10px] text-white/25 uppercase">Total Size</p></div>
            <div>
              {selectedRepo.latest_commit_tx ? (
                <div className="flex items-center gap-1">
                  <p className="font-mono text-purple-300/30 text-[10px] truncate">{selectedRepo.latest_commit_tx.slice(0, 14)}...</p>
                  <CopyBtn text={selectedRepo.latest_commit_tx} />
                </div>
              ) : <p className="text-white/15 text-[10px]">No commits</p>}
              <p className="text-[10px] text-white/25 uppercase">Latest TX</p>
            </div>
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            <button type="button" onClick={() => setView("commit")} className={btnPrimary}>+ New Commit</button>
            {selectedRepo.latest_commit_tx && (
              <a href={`https://arweave.net/${selectedRepo.latest_commit_tx}`} target="_blank" rel="noopener noreferrer" className={btnGhost}>View Manifest</a>
            )}
          </div>
        </div>

        {/* Detail tabs */}
        <div className={`${card} p-1.5 flex gap-1`}>
          {([
            { id: "files" as const, label: "Files", count: latestFiles.length },
            { id: "commits" as const, label: "Commits", count: commits.length },
            { id: "settings" as const, label: "Settings", count: null },
          ]).map((t) => (
            <button key={t.id} type="button" onClick={() => setDetailTab(t.id)}
              className={`flex-1 h-9 rounded-xl text-[12px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                detailTab === t.id
                  ? "bg-purple-500/20 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]"
                  : "text-white/35 hover:text-white/55 hover:bg-white/[0.03]"
              }`}>
              {t.label}
              {t.count !== null && <span className="text-[9px] opacity-50">({t.count})</span>}
            </button>
          ))}
        </div>

        {/* ── FILES TAB ── */}
        {detailTab === "files" && (
          <div className="space-y-3">
            {latestFiles.length === 0 ? (
              <div className={`${card} p-8 text-center`}>
                <p className="text-sm text-white/25">No files yet.</p>
                <p className="text-xs text-white/15 mt-1">Commit files to see them here.</p>
              </div>
            ) : (
              <>
                <input value={fileSearch} onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Search files by name or language..."
                  className={inputCls} />

                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] text-white/20">{filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}</span>
                  <span className="text-[10px] text-white/15">{formatBytes(filteredFiles.reduce((s, f) => s + f.size, 0))}</span>
                </div>

                <div className={`${card} p-2`}>
                  {latestTree.map((n) => (
                    <TreeItem key={n.path} node={n} depth={0}
                      onFileClick={(f) => { setViewingFile(f); setView("file-view"); }} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── COMMITS TAB ── */}
        {detailTab === "commits" && (
          <div className="space-y-3">
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
              <div className="relative">
                {/* Continuous graph line */}
                <div className="absolute left-[18px] top-3 bottom-3 w-px bg-white/[0.06]" />

                <div className="space-y-1">
                  {commits.map((c, idx) => {
                    const isOpen = expandedCommit === c.id;
                    const cd = commitDiffs.get(c.id);
                    const tree = isOpen ? sortTree(buildTree(c.files, cd?.diffs)) : [];

                    return (
                      <div key={c.id} className={`${card} overflow-hidden relative ${isOpen ? "ring-1 ring-purple-500/20" : ""}`}>
                        <button type="button" onClick={() => setExpandedCommit(isOpen ? null : c.id)}
                          className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/[0.015] transition-colors cursor-pointer">

                          <div className="relative z-10 shrink-0">
                            <div className={`w-3 h-3 rounded-full border-2 ${idx === 0 ? "bg-purple-500/50 border-purple-400/70" : "bg-brand-950 border-white/15"}`} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white/70 truncate">{c.message}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-[10px] text-white/20">{new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                              <span className="text-[10px] text-white/15">{c.files.length} file{c.files.length !== 1 ? "s" : ""}</span>
                              {cd && cd.summary.added > 0 && <span className="text-[9px] text-emerald-400/60">+{cd.summary.added}</span>}
                              {cd && cd.summary.modified > 0 && <span className="text-[9px] text-amber-400/60">~{cd.summary.modified}</span>}
                              {cd && cd.summary.removed > 0 && <span className="text-[9px] text-red-400/60">-{cd.summary.removed}</span>}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {c.manifest_tx && <CopyBtn text={c.manifest_tx} label={c.manifest_tx.slice(0, 8)} />}
                            <span className={`text-white/15 text-sm transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="px-4 pb-4 border-t border-white/[0.04] space-y-3">
                            {/* Diff summary */}
                            {cd && (cd.summary.added > 0 || cd.summary.modified > 0 || cd.summary.removed > 0) && (
                              <div className="flex gap-3 mt-3">
                                {cd.summary.added > 0 && <span className="text-[10px] text-emerald-400/70 bg-emerald-500/10 px-2 py-0.5 rounded-full">{cd.summary.added} added</span>}
                                {cd.summary.modified > 0 && <span className="text-[10px] text-amber-400/70 bg-amber-500/10 px-2 py-0.5 rounded-full">{cd.summary.modified} modified</span>}
                                {cd.summary.removed > 0 && <span className="text-[10px] text-red-400/70 bg-red-500/10 px-2 py-0.5 rounded-full">{cd.summary.removed} removed</span>}
                              </div>
                            )}

                            {/* File tree with diff indicators */}
                            <div className={`${card} p-2 max-h-72 overflow-y-auto`}>
                              {tree.map((n) => (
                                <TreeItem key={n.path} node={n} depth={0}
                                  onFileClick={(f) => { setViewingFile(f); setView("file-view"); }} />
                              ))}
                            </div>

                            {/* Changed files flat list */}
                            {cd && cd.diffs.filter((d) => d.status !== "unchanged").length > 0 && (
                              <div>
                                <span className="text-[10px] text-white/25 uppercase tracking-wider block mb-1.5">Changed Files</span>
                                <div className="space-y-0.5">
                                  {cd.diffs.filter((d) => d.status !== "unchanged").map((d) => (
                                    <div key={d.path} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/[0.02]">
                                      <span className={`text-[10px] w-3 text-center font-bold ${d.status === "added" ? "text-emerald-400" : d.status === "modified" ? "text-amber-400" : "text-red-400"}`}>
                                        {d.status === "added" ? "+" : d.status === "modified" ? "~" : "-"}
                                      </span>
                                      <span className={`text-[11px] font-mono truncate flex-1 ${d.status === "removed" ? "text-red-400/40 line-through" : "text-white/40"}`}>{d.path}</span>
                                      {d.file && (
                                        <button type="button" onClick={() => { setViewingFile(d.file!); setView("file-view"); }}
                                          className="text-[10px] text-purple-400/40 hover:text-purple-300 transition-colors cursor-pointer shrink-0">view</button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2 pt-1 flex-wrap">
                              {c.manifest_tx && (
                                <a href={`https://arweave.net/${c.manifest_tx}`} target="_blank" rel="noopener noreferrer" className={btnGhost}>View Manifest</a>
                              )}
                              {c.manifest_tx && <CopyBtn text={c.manifest_tx} label="Copy Manifest TX" />}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {detailTab === "settings" && (
          <div className="space-y-4">
            <div className={`${card} p-5 space-y-4`}>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Repository Settings</h4>

              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Description</label>
                <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Optional description" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Visibility</label>
                <div className="flex gap-2">
                  {(["private", "public"] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setEditVis(v)}
                      className={`h-8 px-4 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${editVis === v ? "bg-purple-500/20 text-purple-300 border-purple-500/20" : "bg-white/[0.03] text-white/30 border-white/[0.06] hover:text-white/50"}`}>
                      {v === "private" ? "Private" : "Public"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={handleSave} disabled={saving} className={btnPrimary}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                {saveMsg && <span className={`text-xs ${saveMsg === "Saved" ? "text-emerald-400/60" : "text-red-400/60"}`}>{saveMsg}</span>}
              </div>

              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Slug <span className="text-white/15">(read-only)</span></label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-purple-300/40">{selectedRepo.slug}</span>
                  <CopyBtn text={selectedRepo.slug} />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Repo ID <span className="text-white/15">(read-only)</span></label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-white/20 truncate">{selectedRepo.id}</span>
                  <CopyBtn text={selectedRepo.id} />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1.5">Created</label>
                <span className="text-xs text-white/30">{new Date(selectedRepo.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>

            {/* Danger zone */}
            <div className={`${card} p-5 border-red-500/10 space-y-3`}>
              <h4 className="text-xs font-semibold text-red-400/50 uppercase tracking-wider">Danger Zone</h4>
              <p className="text-[10px] text-white/20">Deleting a repo removes all commit records from the database. Files already uploaded to Arweave remain permanent.</p>
              {confirmDelete ? (
                <div className="flex gap-2 items-center">
                  <button type="button" onClick={handleDelete}
                    className="h-8 px-4 rounded-lg text-[11px] font-semibold bg-red-500/20 text-red-400 border border-red-500/20 cursor-pointer transition-all hover:bg-red-500/30">Delete Forever</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className={btnGhost}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)}
                  className="h-8 px-4 rounded-lg text-[11px] font-medium bg-white/[0.02] border border-red-500/15 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer">
                  Delete Repository
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================ */
  /*  LIST VIEW                                                        */
  /* ================================================================ */
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
        <div className={`${card} p-10 text-center space-y-3`}>
          <div className="text-3xl opacity-20">⌥</div>
          <p className="text-sm text-white/30">No repositories yet.</p>
          <p className="text-xs text-white/20">Create one to start uploading code permanently to Arweave.</p>
          <button type="button" onClick={() => setView("create")} className={`${btnPrimary} mt-2`}>Create Your First Repo</button>
        </div>
      )}

      {repos.length > 0 && (
        <div className="space-y-1.5">
          {repos.map((r) => (
            <button key={r.id} type="button" onClick={() => openRepo(r)}
              className={`${card} w-full text-left px-4 py-3.5 hover:bg-white/[0.02] transition-all cursor-pointer group`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white/70 group-hover:text-white/90 transition-colors">{r.display_name}</span>
                    <span className="text-[10px] font-mono text-purple-300/25">{r.slug}</span>
                  </div>
                  {r.description && <p className="text-[10px] text-white/25 mt-0.5 truncate">{r.description}</p>}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-white/20">{r.commit_count} commit{r.commit_count !== 1 ? "s" : ""}</span>
                    {r.total_size > 0 && <span className="text-[10px] text-white/15">{formatBytes(r.total_size)}</span>}
                    <span className="text-[10px] text-white/15">{new Date(r.updated_at).toLocaleDateString()}</span>
                    {r.latest_commit_tx && <span className="text-[9px] font-mono text-purple-300/15 hidden sm:inline">{r.latest_commit_tx.slice(0, 10)}...</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase ${r.visibility === "public" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/5 text-white/30 border border-white/10"}`}>
                    {r.visibility}
                  </span>
                  <span className="text-white/10 group-hover:text-white/30 text-sm transition-colors">▸</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
