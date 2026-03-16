"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet-context";
import ArweaveGateway from "@/lib/arweave";
import {
  getCategories,
  getCategoryCounts,
  getMyItems,
  getFeed,
  uploadPrivate,
  uploadPrivateText,
  permawrite,
  permawriteText,
  estimatePermawriteCost,
  deleteItem,
  getSignedUrl,
  getArweaveContentUrl,
  detectCategory,
  isPreviewable,
  contentIcon,
  formatBytes,
  type PermawriteCategory,
  type PermawriteItem,
  type CategoryCount,
} from "@/lib/permawrite";
import type { ArweaveCostEstimate } from "@/lib/wallet-types";
import AuthPanel from "@/components/auth-panel";

/* ================================================================== */
/*  Design tokens                                                      */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-sky-400/60 focus:ring-1 focus:ring-sky-400/30 transition-all";
const btnPrimary = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-sky-500 to-cyan-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnPermawrite = "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnSmall = "h-9 px-4 rounded-xl font-medium text-xs bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";
const pillBtn = "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-medium border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 365) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/* ================================================================== */
/*  Tabs                                                               */
/* ================================================================== */

type Tab = "roll" | "upload" | "feed";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "roll", label: "My Files", icon: "◫" },
  { id: "upload", label: "Upload", icon: "☁" },
  { id: "feed", label: "PermaFeed", icon: "◉" },
];

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export default function PermawritePage() {
  const { user, vaultUnlocked, isLoading, arweaveWallet } = useWallet();

  const [tab, setTab] = useState<Tab>("roll");
  const [categories, setCategories] = useState<PermawriteCategory[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);

  /* ---- Camera Roll state ---- */
  const [myItems, setMyItems] = useState<PermawriteItem[]>([]);
  const [myCount, setMyCount] = useState(0);
  const [myLoading, setMyLoading] = useState(false);
  const [myCategory, setMyCategory] = useState<string>("");
  const [myPage, setMyPage] = useState(0);
  const [viewItem, setViewItem] = useState<PermawriteItem | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  /* ---- Upload state ---- */
  const [uploadMode, setUploadMode] = useState<"private" | "permawrite">("private");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadText, setUploadText] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [uploadCost, setUploadCost] = useState<ArweaveCostEstimate | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ msg: string; type: "success" | "error" | "loading" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ---- Feed state ---- */
  const [feedItems, setFeedItems] = useState<PermawriteItem[]>([]);
  const [feedCount, setFeedCount] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedCategory, setFeedCategory] = useState<string>("");
  const [feedPage, setFeedPage] = useState(0);
  const [feedViewItem, setFeedViewItem] = useState<PermawriteItem | null>(null);

  const PER_PAGE = 24;

  /* ================================================================ */
  /*  Load categories                                                  */
  /* ================================================================ */

  useEffect(() => {
    getCategories().then(setCategories);
    getCategoryCounts().then(setCategoryCounts);
  }, []);

  const catCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of categoryCounts) map[c.category_slug] = c.item_count;
    return map;
  }, [categoryCounts]);

  /* ================================================================ */
  /*  Camera Roll                                                      */
  /* ================================================================ */

  const loadMyItems = useCallback(async (page = 0, cat = myCategory) => {
    setMyLoading(true);
    try {
      const { items, count } = await getMyItems({
        category: cat || undefined,
        limit: PER_PAGE,
        offset: page * PER_PAGE,
      });
      setMyItems(items);
      setMyCount(count);
      setMyPage(page);
    } catch { /* silent */ }
    finally { setMyLoading(false); }
  }, [myCategory]);

  useEffect(() => {
    if (user && tab === "roll") loadMyItems(0);
  }, [user, tab, loadMyItems]);

  const openItem = useCallback(async (item: PermawriteItem) => {
    setViewItem(item);
    setViewUrl(null);
    if (item.visibility === "permawrite" && item.arweave_tx_id) {
      setViewUrl(getArweaveContentUrl(item.arweave_tx_id));
    } else if (item.storage_path) {
      const url = await getSignedUrl(item.storage_path);
      setViewUrl(url);
    }
  }, []);

  const handleDelete = useCallback(async (item: PermawriteItem) => {
    if (!confirm(`Delete "${item.title || item.file_name}"? ${item.visibility === "private" ? "This will remove the file." : "The Arweave copy is permanent, but it will be removed from your library."}`)) return;
    await deleteItem(item.id);
    setViewItem(null);
    loadMyItems(myPage);
  }, [loadMyItems, myPage]);

  /* ================================================================ */
  /*  Upload logic                                                     */
  /* ================================================================ */

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setUploadFile(f);
    setUploadText("");
    if (f) {
      const cat = detectCategory(f.type, f.name);
      setUploadCategory(cat);
      if (!uploadTitle) setUploadTitle(f.name);
    }
  }, [uploadTitle]);

  useEffect(() => {
    if (tab !== "upload" || uploadMode !== "permawrite") { setUploadCost(null); return; }
    let size = 0;
    if (uploadFile) size = uploadFile.size;
    else if (uploadText) size = new TextEncoder().encode(uploadText).byteLength;
    if (size === 0) { setUploadCost(null); return; }
    const t = setTimeout(() => { estimatePermawriteCost(size).then(setUploadCost); }, 500);
    return () => clearTimeout(t);
  }, [tab, uploadMode, uploadFile, uploadText]);

  const addTag = useCallback(() => {
    const t = newTag.trim().toLowerCase();
    if (!t || uploadTags.includes(t)) return;
    setUploadTags((prev) => [...prev, t]);
    setNewTag("");
  }, [newTag, uploadTags]);

  const removeTag = useCallback((tag: string) => {
    setUploadTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleUpload = useCallback(async () => {
    const file = uploadFile;
    const text = uploadText.trim();
    if (!file && !text) { setUploadStatus({ msg: "Add a file or text", type: "error" }); return; }
    if (!uploadCategory) { setUploadStatus({ msg: "Choose a category", type: "error" }); return; }

    if (uploadMode === "permawrite" && !arweaveWallet) {
      setUploadStatus({ msg: "Connect an Arweave wallet to PermaWrite (go to Wallets page)", type: "error" });
      return;
    }

    setUploadStatus({ msg: uploadMode === "permawrite" ? "PermaWriting to Arweave..." : "Uploading...", type: "loading" });
    setUploadProgress(uploadMode === "permawrite" ? 0 : null);

    try {
      const opts = { title: uploadTitle || undefined, description: uploadDesc || undefined, category: uploadCategory, tags: uploadTags };

      if (uploadMode === "private") {
        if (file) {
          await uploadPrivate(file, opts);
        } else {
          await uploadPrivateText(text, opts);
        }
        setUploadStatus({ msg: "Saved privately!", type: "success" });
      } else {
        if (file) {
          await permawrite(file, arweaveWallet!.jwk, opts, (pct) => setUploadProgress(pct));
        } else {
          await permawriteText(text, arweaveWallet!.jwk, opts, (pct) => setUploadProgress(pct));
        }
        setUploadStatus({ msg: "PermaWritten to Arweave!", type: "success" });
        getCategoryCounts().then(setCategoryCounts);
      }

      setUploadFile(null);
      setUploadText("");
      setUploadTitle("");
      setUploadDesc("");
      setUploadTags([]);
      setUploadCategory("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setUploadStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    } finally {
      setUploadProgress(null);
    }
  }, [uploadFile, uploadText, uploadCategory, uploadMode, uploadTitle, uploadDesc, uploadTags, arweaveWallet]);

  /* ================================================================ */
  /*  Feed logic                                                       */
  /* ================================================================ */

  const loadFeed = useCallback(async (page = 0, cat = feedCategory) => {
    setFeedLoading(true);
    try {
      const { items, count } = await getFeed({
        category: cat || undefined,
        limit: PER_PAGE,
        offset: page * PER_PAGE,
      });
      setFeedItems(items);
      setFeedCount(count);
      setFeedPage(page);
    } catch { /* silent */ }
    finally { setFeedLoading(false); }
  }, [feedCategory]);

  useEffect(() => {
    if (tab === "feed") loadFeed(0);
  }, [tab, loadFeed]);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#08090e" }}>
        <p className="text-white/30 text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user || !vaultUnlocked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8" style={{ background: "#08090e" }}>
        <div className="w-full max-w-md space-y-5">
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
              Perma<span className="text-sky-400">Write</span>
            </h1>
            <p className="text-xs text-white/30 mt-1">Sign in to access your permanent storage</p>
          </div>
          <AuthPanel inline />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[960px] mx-auto space-y-5">

        {/* Header */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
            Perma<span className="text-sky-400">Write</span>
          </h1>
          <p className="text-xs text-white/30 mt-1">Private storage &amp; permanent archival on Arweave</p>
        </div>

        {/* Tabs */}
        <div className={`${card} p-1.5 flex gap-1`}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); setViewItem(null); setFeedViewItem(null); }}
              className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                tab === t.id
                  ? "bg-sky-500/20 text-sky-300 shadow-[inset_0_1px_0_rgba(56,189,248,0.2)]"
                  : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
              }`}
            >
              <span className="text-xs opacity-60">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* ============================================================ */}
        {/*  MY FILES (Camera Roll)                                       */}
        {/* ============================================================ */}
        {tab === "roll" && !viewItem && (
          <div className="space-y-4">
            {/* Category filter */}
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              <button
                type="button"
                onClick={() => { setMyCategory(""); loadMyItems(0, ""); }}
                className={`${pillBtn} shrink-0 ${!myCategory ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : ""}`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => { setMyCategory(c.slug); loadMyItems(0, c.slug); }}
                  className={`${pillBtn} shrink-0 ${myCategory === c.slug ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : ""}`}
                >
                  {c.icon} {c.name}
                </button>
              ))}
            </div>

            {myLoading && myItems.length === 0 && (
              <div className={`${card} p-10 text-center`}>
                <div className="w-5 h-5 border-2 border-white/10 border-t-sky-400 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs text-white/30">Loading your files...</p>
              </div>
            )}

            {!myLoading && myItems.length === 0 && (
              <div className={`${card} p-10 text-center`}>
                <p className="text-3xl mb-3 opacity-20">📷</p>
                <p className="text-sm text-white/30">No files yet</p>
                <p className="text-xs text-white/20 mt-1">Upload files from the Upload tab to see them here.</p>
              </div>
            )}

            {/* Grid */}
            {myItems.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {myItems.map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => openItem(item)} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {myCount > PER_PAGE && (
              <Pagination page={myPage} total={myCount} perPage={PER_PAGE} onPage={(p) => loadMyItems(p)} />
            )}
          </div>
        )}

        {/* Item detail view */}
        {tab === "roll" && viewItem && (
          <ItemDetail
            item={viewItem}
            url={viewUrl}
            onBack={() => setViewItem(null)}
            onDelete={() => handleDelete(viewItem)}
          />
        )}

        {/* ============================================================ */}
        {/*  UPLOAD TAB                                                   */}
        {/* ============================================================ */}
        {tab === "upload" && (
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className={`${card} p-1.5 flex gap-1`}>
              <button
                type="button"
                onClick={() => setUploadMode("private")}
                className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  uploadMode === "private"
                    ? "bg-sky-500/15 text-sky-300 shadow-[inset_0_1px_0_rgba(56,189,248,0.2)]"
                    : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-sky-400" style={{ opacity: uploadMode === "private" ? 1 : 0.3 }} />
                Private
              </button>
              <button
                type="button"
                onClick={() => setUploadMode("permawrite")}
                className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  uploadMode === "permawrite"
                    ? "bg-purple-500/15 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]"
                    : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-purple-400" style={{ opacity: uploadMode === "permawrite" ? 1 : 0.3 }} />
                PermaWrite
              </button>
            </div>

            {/* Mode description */}
            <div className={`${card} p-4 text-xs ${uploadMode === "private" ? "text-sky-300/60 border-sky-500/10" : "text-purple-300/60 border-purple-500/10"}`}>
              {uploadMode === "private"
                ? "Private mode: File is stored securely in your vault. Only you can see it. You can delete it anytime."
                : "PermaWrite mode: File is permanently stored on Arweave with category tags. It becomes publicly browseable in the PermaFeed. This costs AR and cannot be undone."
              }
            </div>

            {/* File / text input */}
            <div className={`${card} p-5 space-y-4`}>
              <div>
                <label className={labelCls}>Choose a File</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="*/*"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-white/40 file:mr-3 file:h-9 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-medium file:bg-white/[0.06] file:text-white/60 hover:file:bg-white/[0.1] file:cursor-pointer file:transition-all"
                />
                {uploadFile && <p className="text-[11px] text-white/30 mt-1">{uploadFile.name} ({formatBytes(uploadFile.size)})</p>}
              </div>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-white/[0.06]" />
                <span className="text-[10px] text-white/20 uppercase tracking-wider">or</span>
                <span className="h-px flex-1 bg-white/[0.06]" />
              </div>

              <div>
                <label className={labelCls}>Text Content</label>
                <textarea
                  rows={4}
                  value={uploadText}
                  onChange={(e) => { setUploadText(e.target.value); setUploadFile(null); if (!uploadCategory) setUploadCategory("text"); }}
                  placeholder="Enter text content..."
                  className={`${inputCls} h-auto py-3`}
                  style={{ resize: "vertical" }}
                />
              </div>
            </div>

            {/* Metadata */}
            <div className={`${card} p-5 space-y-4`}>
              <div>
                <label className={labelCls}>Title</label>
                <input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Give it a name..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)} placeholder="What is this?" className={inputCls} />
              </div>
            </div>

            {/* Category picker */}
            <div className={`${card} p-5 space-y-3`}>
              <label className={labelCls}>Category</label>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {categories.map((c) => (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => setUploadCategory(c.slug)}
                    className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl text-center transition-all cursor-pointer ${
                      uploadCategory === c.slug
                        ? "bg-sky-500/15 border border-sky-500/30 text-sky-300"
                        : "bg-white/[0.02] border border-white/[0.04] text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="text-lg">{c.icon}</span>
                    <span className="text-[9px] font-medium uppercase tracking-wider">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div className={`${card} p-5 space-y-3`}>
              <label className={labelCls}>Tags</label>
              {uploadTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {uploadTags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300/60">
                      #{t}
                      <button type="button" onClick={() => removeTag(t)} className="text-red-400/60 hover:text-red-400 cursor-pointer">x</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Add a tag..."
                  className={`flex-1 ${inputCls}`}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <button type="button" onClick={addTag} className={btnSmall}>Add</button>
              </div>
            </div>

            {/* Cost estimate (PermaWrite only) */}
            {uploadMode === "permawrite" && uploadCost && (
              <div className={`${card} p-4 border-purple-500/10`}>
                <span className="text-[10px] text-purple-300/40 uppercase tracking-wider font-medium">PermaWrite Cost</span>
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div>
                    <p className="text-sm font-bold text-white">{parseFloat(uploadCost.ar).toFixed(8)}</p>
                    <p className="text-[10px] text-white/30">AR</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">${parseFloat(uploadCost.usd).toFixed(6)}</p>
                    <p className="text-[10px] text-white/30">USD</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{uploadCost.winston}</p>
                    <p className="text-[10px] text-white/30">Winston</p>
                  </div>
                </div>
              </div>
            )}

            {/* PermaWrite wallet notice */}
            {uploadMode === "permawrite" && !arweaveWallet && (
              <div className={`${card} p-4 text-center border-purple-500/10`}>
                <p className="text-xs text-purple-300/60 mb-2">You need an Arweave wallet to PermaWrite.</p>
                <Link href="/wallets" className={`${btnSmall} inline-flex`}>Go to Wallets</Link>
              </div>
            )}

            {/* Progress */}
            {uploadProgress !== null && (
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-violet-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <span className="text-xs text-white/50 w-12 text-right">{uploadProgress}%</span>
                </div>
              </div>
            )}

            {/* Submit */}
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploadProgress !== null}
              className={`w-full ${uploadMode === "permawrite" ? btnPermawrite : btnPrimary}`}
            >
              {uploadProgress !== null
                ? "Uploading..."
                : uploadMode === "permawrite"
                  ? "PermaWrite to Arweave"
                  : "Save Privately"
              }
            </button>

            {uploadStatus && (
              <div className={`${card} p-3 text-xs font-medium break-all ${
                uploadStatus.type === "success" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" :
                uploadStatus.type === "error" ? "text-red-400 border-red-500/20 bg-red-500/5" :
                "text-sky-300 border-sky-500/20 bg-sky-500/5"
              }`}>
                {uploadStatus.msg}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/*  PERMAFEED                                                    */}
        {/* ============================================================ */}
        {tab === "feed" && !feedViewItem && (
          <div className="space-y-4">
            {/* Category filter with counts */}
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              <button
                type="button"
                onClick={() => { setFeedCategory(""); loadFeed(0, ""); }}
                className={`${pillBtn} shrink-0 ${!feedCategory ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : ""}`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => { setFeedCategory(c.slug); loadFeed(0, c.slug); }}
                  className={`${pillBtn} shrink-0 ${feedCategory === c.slug ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : ""}`}
                >
                  {c.icon} {c.name}
                  {catCountMap[c.slug] ? <span className="text-white/20 ml-1">{catCountMap[c.slug]}</span> : null}
                </button>
              ))}
            </div>

            {feedLoading && feedItems.length === 0 && (
              <div className={`${card} p-10 text-center`}>
                <div className="w-5 h-5 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs text-white/30">Loading feed...</p>
              </div>
            )}

            {!feedLoading && feedItems.length === 0 && (
              <div className={`${card} p-10 text-center`}>
                <p className="text-3xl mb-3 opacity-20">◉</p>
                <p className="text-sm text-white/30">No PermaWrite content yet</p>
                <p className="text-xs text-white/20 mt-1">PermaWritten content from all users appears here, browseable by category.</p>
              </div>
            )}

            {/* Feed grid */}
            {feedItems.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {feedItems.map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => setFeedViewItem(item)} showBadge={false} />
                ))}
              </div>
            )}

            {feedCount > PER_PAGE && (
              <Pagination page={feedPage} total={feedCount} perPage={PER_PAGE} onPage={(p) => loadFeed(p)} />
            )}
          </div>
        )}

        {/* Feed item detail */}
        {tab === "feed" && feedViewItem && (
          <ItemDetail
            item={feedViewItem}
            url={feedViewItem.arweave_tx_id ? getArweaveContentUrl(feedViewItem.arweave_tx_id) : null}
            onBack={() => setFeedViewItem(null)}
            readonly
          />
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  ItemCard                                                           */
/* ================================================================== */

function ItemCard({ item, onClick, showBadge = true }: { item: PermawriteItem; onClick: () => void; showBadge?: boolean }) {
  const isImage = item.content_type?.startsWith("image/");
  const isVideo = item.content_type?.startsWith("video/");
  const icon = contentIcon(item.category_slug);

  const thumbUrl = item.visibility === "permawrite" && item.arweave_tx_id
    ? getArweaveContentUrl(item.arweave_tx_id)
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${card} group overflow-hidden text-left cursor-pointer hover:border-white/[0.12] hover:bg-white/[0.05] active:scale-[0.98] transition-all`}
    >
      {/* Thumbnail area */}
      <div className="relative aspect-square bg-white/[0.02] flex items-center justify-center overflow-hidden">
        {isImage && thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt={item.title || ""} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
        ) : (
          <span className="text-4xl opacity-20">{icon}</span>
        )}
        {isVideo && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white/80 text-lg">▶</span>
          </span>
        )}
        {showBadge && (
          <span className={`absolute top-2 right-2 text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
            item.visibility === "permawrite"
              ? "bg-purple-500/80 text-white"
              : "bg-white/20 text-white/60"
          }`}>
            {item.visibility === "permawrite" ? "PERMA" : "PRIVATE"}
          </span>
        )}
      </div>
      {/* Info */}
      <div className="p-2.5">
        <p className="text-xs font-medium text-white/70 truncate">{item.title || item.file_name || "Untitled"}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px]">{icon}</span>
          <span className="text-[10px] text-white/30">{formatBytes(item.file_size)}</span>
          <span className="text-[10px] text-white/20">{relativeTime(item.created_at)}</span>
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/[0.04] text-white/30">#{t}</span>
            ))}
            {item.tags.length > 3 && <span className="text-[8px] text-white/20">+{item.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

/* ================================================================== */
/*  ItemDetail                                                         */
/* ================================================================== */

function ItemDetail({
  item, url, onBack, onDelete, readonly,
}: {
  item: PermawriteItem;
  url: string | null;
  onBack: () => void;
  onDelete?: () => void;
  readonly?: boolean;
}) {
  const icon = contentIcon(item.category_slug);
  const isImage = item.content_type?.startsWith("image/");
  const isVideo = item.content_type?.startsWith("video/");
  const isAudio = item.content_type?.startsWith("audio/");
  const isText = item.content_type?.startsWith("text/") || item.content_type === "application/json";
  const isPdf = item.content_type === "application/pdf";

  const [textContent, setTextContent] = useState<string | null>(null);
  useEffect(() => {
    if (isText && url) {
      fetch(url).then((r) => r.text()).then(setTextContent).catch(() => setTextContent("Failed to load"));
    }
  }, [isText, url]);

  const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
  const pillBtn = "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-medium border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className={pillBtn}>← Back</button>
        <h2 className="text-sm font-medium text-white/70 truncate flex-1">{item.title || item.file_name || "Untitled"}</h2>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase ${
          item.visibility === "permawrite" ? "bg-purple-500/20 text-purple-300 border border-purple-500/20" : "bg-white/10 text-white/40 border border-white/[0.08]"
        }`}>
          {item.visibility === "permawrite" ? "PermaWritten" : "Private"}
        </span>
      </div>

      {/* Content preview */}
      {url && (
        <div className={`${card} overflow-hidden`}>
          <div className="min-h-[200px] max-h-[500px] overflow-auto bg-black/30">
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={item.title || ""} className="max-w-full h-auto mx-auto" />
            )}
            {isVideo && <video src={url} controls className="max-w-full mx-auto" />}
            {isAudio && <div className="p-8 flex justify-center"><audio src={url} controls /></div>}
            {isText && textContent !== null && (
              <pre className="p-4 text-xs text-white/40 whitespace-pre-wrap break-all font-mono max-h-[400px] overflow-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                {textContent}
              </pre>
            )}
            {isPdf && <iframe src={url} title="PDF" className="w-full h-[500px] border-0" />}
            {!isImage && !isVideo && !isAudio && !isText && !isPdf && (
              <div className="p-8 text-center">
                <span className="text-4xl">{icon}</span>
                <p className="text-xs text-white/30 mt-2">{item.content_type || "Unknown type"}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className={`${card} p-5 space-y-3`}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-white/30 uppercase">Category</span>
            <p className="text-xs text-white/60">{icon} {item.category_slug}</p>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase">Size</span>
            <p className="text-xs text-white/60">{formatBytes(item.file_size)}</p>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase">Type</span>
            <p className="text-xs text-white/60">{item.content_type || "—"}</p>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase">Created</span>
            <p className="text-xs text-white/60">{new Date(item.created_at).toLocaleString()}</p>
          </div>
        </div>

        {item.description && (
          <div>
            <span className="text-[10px] text-white/30 uppercase">Description</span>
            <p className="text-xs text-white/50 mt-0.5">{item.description}</p>
          </div>
        )}

        {item.tags.length > 0 && (
          <div>
            <span className="text-[10px] text-white/30 uppercase">Tags</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {item.tags.map((t) => (
                <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300/60">#{t}</span>
              ))}
            </div>
          </div>
        )}

        {item.arweave_tx_id && (
          <div>
            <span className="text-[10px] text-white/30 uppercase">Arweave TX</span>
            <p className="text-xs font-mono text-purple-300/50 break-all mt-0.5">{item.arweave_tx_id}</p>
            <div className="flex gap-2 mt-1.5">
              <a href={getArweaveContentUrl(item.arweave_tx_id)} target="_blank" rel="noopener noreferrer" className={pillBtn}>View on Arweave</a>
              <a href={`https://viewblock.io/arweave/tx/${item.arweave_tx_id}`} target="_blank" rel="noopener noreferrer" className={pillBtn}>ViewBlock</a>
              <Link href="/gateway" className={pillBtn}>Gateway</Link>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {!readonly && (
        <div className="flex gap-2">
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className={`flex-1 flex items-center justify-center ${pillBtn} h-9`}>Download</a>}
          {onDelete && <button type="button" onClick={onDelete} className={`flex-1 flex items-center justify-center ${pillBtn} h-9 text-red-400/50 hover:text-red-400`}>Delete</button>}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Pagination                                                         */
/* ================================================================== */

function Pagination({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page === 0} className="text-xs text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed">
        ← Prev
      </button>
      <span className="text-[10px] text-white/40">{page + 1} / {totalPages}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1} className="text-xs text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed">
        Next →
      </button>
    </div>
  );
}
