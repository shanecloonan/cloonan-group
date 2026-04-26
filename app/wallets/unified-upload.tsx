"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useWallet } from "@/lib/wallet-context";
import ArweaveGateway from "@/lib/arweave";
import {
  getCategories,
  getCategoryGroups,
  getCategoryCounts,
  getGroupedCategories,
  permawriteSmart,
  permawriteTextSmart,
  estimatePermawriteCost,
  detectCategory,
  formatBytes,
  GROUP_COLORS,
  SUGGESTED_TAGS,
  type PermawriteCategory,
  type PermawriteCategoryGroup,
} from "@/lib/permawrite";
import type { ArweaveTag, ArweaveCostEstimate } from "@/lib/wallet-types";

// Wallet uploads always take the L1 path — standard, direct Arweave base-layer
// submission. Turbo (bundled instant) is still available internally for repo
// commits (see permawrite-repos), it's just not a user-facing option here.
const UPLOAD_METHOD = "l1" as const;

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/30 transition-all";
const btnSmall = "h-9 px-4 rounded-xl font-medium text-xs bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";

export default function UnifiedUpload() {
  const { arweaveWallet } = useWallet();
  const gw = useMemo(() => new ArweaveGateway(), []);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const [text, setText] = useState("");
  const [desc, setDesc] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [customTags, setCustomTags] = useState<ArweaveTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagValue, setNewTagValue] = useState("");

  const [permawrite, setPermawrite] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [pwTags, setPwTags] = useState<string[]>([]);
  const [newPwTag, setNewPwTag] = useState("");
  const [visibility, setVisibility] = useState<"personal" | "public">("personal");

  const [categories, setCategories] = useState<PermawriteCategory[]>([]);
  const [groups, setGroups] = useState<PermawriteCategoryGroup[]>([]);
  const [catPickerSearch, setCatPickerSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [l1Cost, setL1Cost] = useState<ArweaveCostEstimate | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "loading" } | null>(null);

  useEffect(() => {
    Promise.all([getCategories(), getCategoryGroups()]).then(([cats, grps]) => {
      setCategories(cats);
      setGroups(grps);
    });
  }, []);

  // Prevent the browser from navigating away if the user misses the dropzone.
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      // Only intercept file drags, not text/link drags from other areas of the app.
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);
    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);

  const grouped = useMemo(
    () => getGroupedCategories(categories, groups),
    [categories, groups],
  );

  const catMap = useMemo(() => {
    const m: Record<string, PermawriteCategory> = {};
    for (const c of categories) m[c.slug] = c;
    return m;
  }, [categories]);

  const filteredGrouped = useMemo(() => {
    if (!catPickerSearch.trim()) return grouped;
    const q = catPickerSearch.toLowerCase();
    return grouped
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.slug.toLowerCase().includes(q) ||
            (c.description || "").toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [grouped, catPickerSearch]);

  const suggestedTags = useMemo(() => {
    if (!category) return [];
    return (SUGGESTED_TAGS[category] || []).filter((t) => !pwTags.includes(t));
  }, [category, pwTags]);

  const selectedCatGroup = useMemo(() => {
    if (!category) return null;
    const cat = catMap[category];
    if (!cat?.group_slug) return null;
    return groups.find((g) => g.slug === cat.group_slug) || null;
  }, [category, catMap, groups]);

  useEffect(() => {
    let size = 0;
    if (file) size = file.size;
    else if (text) size = new TextEncoder().encode(text).byteLength;
    if (size === 0) { setL1Cost(null); return; }
    const t = setTimeout(() => {
      estimatePermawriteCost(size).then(setL1Cost);
    }, 500);
    return () => clearTimeout(t);
  }, [file, text]);

  const acceptFile = useCallback((f: File | null) => {
    setFile(f);
    setText("");
    if (f) {
      setCategory(detectCategory(f.type, f.name));
      if (!title) setTitle(f.name);
    }
  }, [title]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0] || null);
  }, [acceptFile]);

  // Single-file drag-and-drop.
  // Important: we treat whatever is dropped as a single opaque File — zips stay zips.
  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) setIsDragging(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) {
      acceptFile(dropped[0]);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [acceptFile]);

  const addCustomTag = useCallback(() => {
    if (!newTagName.trim()) return;
    setCustomTags((prev) => [...prev, { name: newTagName.trim(), value: newTagValue.trim() }]);
    setNewTagName("");
    setNewTagValue("");
  }, [newTagName, newTagValue]);

  const addPwTag = useCallback((tag?: string) => {
    const t = (tag ?? newPwTag).trim().toLowerCase();
    if (!t || pwTags.includes(t)) return;
    setPwTags((prev) => [...prev, t]);
    if (!tag) setNewPwTag("");
  }, [newPwTag, pwTags]);

  const toggleGroup = useCallback((slug: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const resetForm = useCallback(() => {
    setFile(null);
    setText("");
    setDesc("");
    setTitle("");
    setCategory("");
    setPwTags([]);
    setCustomTags([]);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleUpload = useCallback(async () => {
    if (!arweaveWallet) { setStatus({ msg: "Set up an Arweave wallet first (switch to Arweave tab)", type: "error" }); return; }
    const f = file;
    const t = text.trim();
    if (!f && !t) { setStatus({ msg: "Add a file or text to upload", type: "error" }); return; }

    if (permawrite) {
      if (!category) { setStatus({ msg: "Choose a category for PermaWrite", type: "error" }); return; }
      const vis = visibility === "public" ? "permawrite" as const : "private" as const;
      const pwOpts = {
        title: title || undefined,
        description: desc || undefined,
        category,
        tags: pwTags,
        preferredMethod: UPLOAD_METHOD,
        visibility: vis,
        customTags: customTags.length > 0 ? customTags : undefined,
      };
      const visLabel = visibility === "public" ? "to Public Feed" : "to Personal Feed";
      setStatus({ msg: `PermaWriting ${visLabel}...`, type: "loading" });
      setProgress(0);
      try {
        if (f) {
          await permawriteSmart(f, arweaveWallet.jwk, pwOpts, (pct) => setProgress(pct));
        } else {
          await permawriteTextSmart(t, arweaveWallet.jwk, pwOpts, (pct) => setProgress(pct));
        }
        setStatus({ msg: `PermaWritten ${visLabel} — ~10-30 min network confirmation.`, type: "success" });
        getCategoryCounts();
        resetForm();
      } catch (e) {
        setStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
      } finally {
        setProgress(null);
      }
    } else {
      setStatus({ msg: "Uploading to Arweave...", type: "loading" });
      setProgress(0);
      try {
        const tags: ArweaveTag[] = [...customTags];
        let result;
        if (f) {
          result = await gw.smartUploadFile(f, tags, arweaveWallet.jwk, UPLOAD_METHOD, desc || undefined, (pct) => setProgress(pct));
        } else {
          const data = new TextEncoder().encode(t);
          const allTags: ArweaveTag[] = [{ name: "Content-Type", value: "text/plain" }, ...tags];
          result = await gw.smartUploadData(data, allTags, arweaveWallet.jwk, UPLOAD_METHOD, desc || undefined, (pct) => setProgress(pct));
        }
        if (result.status === 200) {
          setStatus({ msg: `Uploaded! TX: ${result.txId} — ~10-30 min network confirmation.`, type: "success" });
          resetForm();
        } else {
          setStatus({ msg: `Upload failed (status ${result.status})`, type: "error" });
        }
      } catch (e) {
        setStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
      } finally {
        setProgress(null);
      }
    }
  }, [arweaveWallet, file, text, permawrite, category, title, desc, pwTags, visibility, customTags, gw, resetForm]);

  if (!arweaveWallet) {
    return (
      <div className={`${card} p-8 text-center space-y-4`}>
        <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto">
          <span className="text-3xl">☁</span>
        </div>
        <div>
          <p className="text-sm font-medium text-white/60">Wallet required to upload</p>
          <p className="text-xs text-white/30 mt-1 max-w-xs mx-auto">
            You need an Arweave wallet to upload files. Switch to the <strong className="text-white/50">Wallet</strong> tab to generate a new one or import an existing key.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-[10px] text-white/25">
            <span className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-300/60">1</span>
            <span>Generate or import a wallet</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/25">
            <span className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-300/60">2</span>
            <span>Fund it with AR</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/25">
            <span className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-300/60">3</span>
            <span>Upload files permanently</span>
          </div>
        </div>
      </div>
    );
  }

  const uploadBtnLabel = progress !== null
    ? "Uploading..."
    : permawrite
      ? `PermaWrite ${visibility === "public" ? "to Public Feed" : "to Personal Feed"}`
      : "Upload to Arweave";

  const uploadBtnCls = permawrite
    ? "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
    : "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

  return (
    <div className="space-y-4">
      {/* Content */}
      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Content</span>
          {(file || text) && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300/60 border border-emerald-500/20">
              {file ? `📎 ${file.name} (${formatBytes(file.size)})` : `📝 ${new TextEncoder().encode(text).byteLength} bytes`}
            </span>
          )}
        </div>
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed transition-all p-4 text-center ${
            isDragging
              ? "border-purple-400/70 bg-purple-500/10 ring-2 ring-purple-500/30"
              : file
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/[0.06] hover:border-white/[0.12]"
          }`}
        >
          <input ref={fileRef} type="file" accept="*/*" onChange={handleFileSelect} className="hidden" id="arUploadFile" />
          <label htmlFor="arUploadFile" className="cursor-pointer block">
            <span className="text-2xl block mb-2">{isDragging ? "⬇" : file ? "✓" : "📂"}</span>
            <p className="text-xs text-white/50">
              {isDragging ? "Drop to upload as a single file" : file ? file.name : "Drop a file here or click to browse"}
            </p>
            <p className="text-[10px] text-white/20 mt-1">
              {isDragging ? "Zips & folders stay intact — uploaded as one file" : "Any file type — zip files upload as-is"}
            </p>
            {file && (
              <button type="button" onClick={(e) => { e.preventDefault(); setFile(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-[10px] text-red-400/50 hover:text-red-400 mt-1 transition-colors">
                Remove file
              </button>
            )}
          </label>
        </div>
        {!file && (
          <>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-white/[0.06]" />
              <span className="text-[10px] text-white/20 uppercase tracking-wider">or type text</span>
              <span className="h-px flex-1 bg-white/[0.06]" />
            </div>
            <textarea rows={3} value={text} onChange={(e) => { setText(e.target.value); if (permawrite && !category) setCategory("text"); }} placeholder="Type or paste text to store permanently on Arweave..." className={`${inputCls} h-auto py-3`} style={{ resize: "vertical" }} />
          </>
        )}
        <div>
          <label className={labelCls}>Description (optional)</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Brief description of this upload" className={inputCls} />
        </div>
      </div>

      {/* Custom Tags */}
      <div className={`${card} p-5 space-y-3`}>
        <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Custom Arweave Tags</span>
        {customTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customTags.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300/60">
                {t.name}: {t.value}
                <button type="button" onClick={() => setCustomTags((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-400/60 hover:text-red-400 cursor-pointer">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Tag name" className={`flex-1 ${inputCls}`} />
          <input value={newTagValue} onChange={(e) => setNewTagValue(e.target.value)} placeholder="Tag value" className={`flex-1 ${inputCls}`} onKeyDown={(e) => e.key === "Enter" && addCustomTag()} />
          <button type="button" onClick={addCustomTag} className={btnSmall}>Add</button>
        </div>
      </div>

      {/* PermaWrite Toggle */}
      <div className={`${card} overflow-hidden transition-all ${permawrite ? "border-violet-500/20" : ""}`}>
        <button
          type="button"
          onClick={() => setPermawrite(!permawrite)}
          className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/[0.02] transition-all cursor-pointer"
        >
          <span className="text-xl">🗂</span>
          <div className="flex-1 text-left">
            <p className={`text-sm font-semibold ${permawrite ? "text-violet-300" : "text-white/60"}`}>PermaWrite</p>
            <p className="text-[11px] text-white/30 mt-0.5">
              {permawrite ? "Uploads are organized in your feed with categories and tags" : "Enable to organize uploads with categories, tags, and browsable feeds"}
            </p>
          </div>
          <div className={`w-11 h-6 rounded-full flex items-center transition-all ${permawrite ? "bg-violet-500" : "bg-white/[0.08]"}`}>
            <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-all ${permawrite ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
          </div>
        </button>

        {permawrite && (
          <div className="px-5 pb-5 space-y-4 border-t border-white/[0.04]">
            {/* Visibility */}
            <div className="pt-4">
              <label className={labelCls}>Who can see this?</label>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setVisibility("personal")} className={`flex-1 rounded-xl text-xs font-medium transition-all cursor-pointer flex flex-col items-center gap-1 py-3 ${visibility === "personal" ? "bg-sky-500/15 text-sky-300 border border-sky-500/30 shadow-[inset_0_1px_0_rgba(56,189,248,0.2)]" : "bg-white/[0.03] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]"}`}>
                  <span className="text-lg">🔒</span>
                  <span>Just Me</span>
                  <span className="text-[9px] text-white/20 font-normal">My Files only</span>
                </button>
                <button type="button" onClick={() => setVisibility("public")} className={`flex-1 rounded-xl text-xs font-medium transition-all cursor-pointer flex flex-col items-center gap-1 py-3 ${visibility === "public" ? "bg-violet-500/15 text-violet-300 border border-violet-500/30 shadow-[inset_0_1px_0_rgba(139,92,246,0.2)]" : "bg-white/[0.03] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]"}`}>
                  <span className="text-lg">🌐</span>
                  <span>Public</span>
                  <span className="text-[9px] text-white/20 font-normal">Browsable by everyone</span>
                </button>
              </div>
              <p className="text-[10px] text-white/20 mt-2 leading-relaxed">
                {visibility === "personal"
                  ? "Only you can see this in your personal feed. The data is still permanently stored on Arweave, but it won't appear in the public feed."
                  : "This will be visible to everyone in the public feed, browsable by category and tags. The data is permanently and publicly stored on Arweave."}
              </p>
            </div>

            {/* Title */}
            <div>
              <label className={labelCls}>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give it a name..." className={inputCls} />
            </div>

            {/* Category Picker */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className={labelCls + " mb-0"}>Category</label>
                {category && catMap[category] && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${selectedCatGroup ? `${GROUP_COLORS[selectedCatGroup.color]?.activeBg || "bg-white/10"} ${GROUP_COLORS[selectedCatGroup.color]?.text || "text-white/60"}` : "bg-white/10 text-white/60"}`}>
                    {catMap[category].icon} {catMap[category].name}
                    <button type="button" onClick={() => setCategory("")} className="ml-0.5 opacity-60 hover:opacity-100 cursor-pointer">×</button>
                  </span>
                )}
              </div>
              <input
                value={catPickerSearch}
                onChange={(e) => setCatPickerSearch(e.target.value)}
                placeholder="Search categories..."
                className={`${inputCls} h-9 text-xs`}
              />
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                {filteredGrouped.map(({ group: g, items }) => {
                  const colors = GROUP_COLORS[g.color] || GROUP_COLORS.zinc;
                  const isExpanded = expandedGroups.has(g.slug) || !!catPickerSearch.trim() || items.some((c) => c.slug === category);
                  return (
                    <div key={g.slug} className="rounded-xl border border-white/[0.04] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.slug)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-all cursor-pointer hover:bg-white/[0.02] ${isExpanded ? colors.activeBg : ""}`}
                      >
                        <span className="text-sm">{g.icon}</span>
                        <span className={`text-[11px] font-semibold uppercase tracking-wider flex-1 ${isExpanded ? colors.text : "text-white/40"}`}>
                          {g.name}
                        </span>
                        <span className="text-[10px] text-white/20">{items.length}</span>
                        <span className={`text-[10px] transition-transform ${isExpanded ? "rotate-180" : ""} text-white/20`}>▾</span>
                      </button>
                      {isExpanded && (
                        <div className="px-2 pb-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {items.map((c) => {
                            const active = category === c.slug;
                            return (
                              <button
                                key={c.slug}
                                type="button"
                                onClick={() => setCategory(c.slug)}
                                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all cursor-pointer ${active ? `${colors.activeBg} border ${colors.border} ${colors.text}` : "bg-white/[0.02] border border-transparent text-white/40 hover:text-white/60 hover:bg-white/[0.04]"}`}
                              >
                                <span className="text-base shrink-0">{c.icon}</span>
                                <p className="text-[10px] font-medium truncate">{c.name}</p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* PermaWrite Tags */}
            <div className="space-y-3">
              <label className={labelCls}>Feed Tags</label>
              {pwTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pwTags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300/70">
                      #{t}
                      <button type="button" onClick={() => setPwTags((prev) => prev.filter((x) => x !== t))} className="text-red-400/60 hover:text-red-400 cursor-pointer ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newPwTag}
                  onChange={(e) => setNewPwTag(e.target.value)}
                  placeholder="Add a tag..."
                  className={`flex-1 ${inputCls}`}
                  onKeyDown={(e) => e.key === "Enter" && addPwTag()}
                />
                <button type="button" onClick={() => addPwTag()} className={btnSmall}>Add</button>
              </div>
              {suggestedTags.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/25 uppercase tracking-wider font-medium mb-2">
                    Suggested for {catMap[category]?.name || category}
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                    {suggestedTags.slice(0, 20).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => addPwTag(t)}
                        className="text-[10px] px-2 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.06] hover:border-white/[0.12] transition-all cursor-pointer"
                      >
                        +{t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cost Estimate */}
      {l1Cost && (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Estimated Cost</span>
            <span className="text-[10px] text-white/20">~10-30 min confirmation</span>
          </div>
          <p className="text-lg font-bold text-white mt-1">
            {parseFloat(l1Cost.ar).toFixed(8)} <span className="text-sm font-normal text-white/30">AR</span>
          </p>
        </div>
      )}

      {/* Progress */}
      {progress !== null && (
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div className={`h-full rounded-full transition-all ${permawrite ? "bg-gradient-to-r from-violet-500 to-purple-500" : "bg-gradient-to-r from-purple-500 to-violet-500"}`} style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-white/50 w-12 text-right">{progress}%</span>
          </div>
        </div>
      )}

      {/* Upload Button */}
      <button type="button" onClick={handleUpload} disabled={progress !== null} className={uploadBtnCls}>
        {uploadBtnLabel}
      </button>

      {/* Status */}
      {status && (
        <div className={`${card} p-3 text-xs font-medium break-all ${status.type === "success" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" : status.type === "error" ? "text-red-400 border-red-500/20 bg-red-500/5" : "text-purple-300 border-purple-500/20 bg-purple-500/5"}`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
