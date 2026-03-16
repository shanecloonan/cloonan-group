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
  estimateTurboCost,
  detectCategory,
  formatBytes,
  GROUP_COLORS,
  SUGGESTED_TAGS,
  type PermawriteCategory,
  type PermawriteCategoryGroup,
} from "@/lib/permawrite";
import type { ArweaveTag, ArweaveCostEstimate, UploadMethod } from "@/lib/wallet-types";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/30 transition-all";
const btnSmall = "h-9 px-4 rounded-xl font-medium text-xs bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";

export default function UnifiedUpload() {
  const { arweaveWallet } = useWallet();
  const gw = useMemo(() => new ArweaveGateway(), []);

  const [method, setMethod] = useState<UploadMethod>("turbo");
  const [file, setFile] = useState<File | null>(null);
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
  const [turboCost, setTurboCost] = useState<{ winc: string; ar: string } | null>(null);
  const [turboBalance, setTurboBalance] = useState<{ winc: string; ar: string } | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "loading" } | null>(null);

  useEffect(() => {
    Promise.all([getCategories(), getCategoryGroups()]).then(([cats, grps]) => {
      setCategories(cats);
      setGroups(grps);
    });
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
    if (size === 0) { setL1Cost(null); setTurboCost(null); return; }
    const t = setTimeout(() => {
      estimatePermawriteCost(size).then(setL1Cost);
      estimateTurboCost(size).then(setTurboCost);
    }, 500);
    return () => clearTimeout(t);
  }, [file, text]);

  useEffect(() => {
    if (!arweaveWallet) { setTurboBalance(null); return; }
    ArweaveGateway.getTurboBalance(arweaveWallet.address).then(setTurboBalance).catch(() => setTurboBalance(null));
  }, [arweaveWallet]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setText("");
    if (f) {
      setCategory(detectCategory(f.type, f.name));
      if (!title) setTitle(f.name);
    }
  }, [title]);

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
        preferredMethod: method,
        visibility: vis,
        customTags: customTags.length > 0 ? customTags : undefined,
      };
      const visLabel = visibility === "public" ? "to Public Feed" : "to Personal Feed";
      setStatus({ msg: `PermaWriting ${visLabel}...`, type: "loading" });
      setProgress(0);
      try {
        let uploadMethod = "turbo";
        if (f) {
          const result = await permawriteSmart(f, arweaveWallet.jwk, pwOpts, (pct) => setProgress(pct));
          uploadMethod = result?.method ?? "turbo";
        } else {
          const result = await permawriteTextSmart(t, arweaveWallet.jwk, pwOpts, (pct) => setProgress(pct));
          uploadMethod = result?.method ?? "turbo";
        }
        const methodMsg = uploadMethod === "turbo" ? "instantly via Turbo" : "via L1 (~10-30 min confirmation)";
        setStatus({ msg: `PermaWritten ${visLabel} ${methodMsg}!`, type: "success" });
        getCategoryCounts();
        resetForm();
      } catch (e) {
        setStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
      } finally {
        setProgress(null);
      }
    } else {
      const methodLabel = method === "turbo" ? "Bundling via Turbo" : "Uploading to L1";
      setStatus({ msg: `${methodLabel}...`, type: "loading" });
      setProgress(0);
      try {
        const tags: ArweaveTag[] = [...customTags];
        let result;
        if (f) {
          result = await gw.smartUploadFile(f, tags, arweaveWallet.jwk, method, desc || undefined, (pct) => setProgress(pct));
        } else {
          const data = new TextEncoder().encode(t);
          const allTags: ArweaveTag[] = [{ name: "Content-Type", value: "text/plain" }, ...tags];
          result = await gw.smartUploadData(data, allTags, arweaveWallet.jwk, method, desc || undefined, (pct) => setProgress(pct));
        }
        if (result.status === 200) {
          const methodMsg = result.method === "turbo" ? " (instant via Turbo)" : " (L1 — ~10-30 min confirmation)";
          setStatus({ msg: `Uploaded! TX: ${result.txId}${methodMsg}`, type: "success" });
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
  }, [arweaveWallet, file, text, permawrite, category, title, desc, pwTags, method, visibility, customTags, gw, resetForm]);

  if (!arweaveWallet) {
    return (
      <div className={`${card} p-8 text-center`}>
        <p className="text-3xl mb-4 opacity-20">☁</p>
        <p className="text-sm text-white/50 mb-2">Set up an Arweave wallet to upload.</p>
        <p className="text-xs text-white/30">Switch to the <strong className="text-white/50">Arweave</strong> tab to generate or import a wallet.</p>
      </div>
    );
  }

  const uploadBtnLabel = progress !== null
    ? "Uploading..."
    : permawrite
      ? `PermaWrite ${visibility === "public" ? "to Public Feed" : "to Personal Feed"}`
      : method === "turbo"
        ? "Upload via Turbo"
        : "Upload to Arweave (L1)";

  const uploadBtnCls = permawrite
    ? "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
    : method === "turbo"
      ? "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
      : "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

  return (
    <div className="space-y-4">
      {/* Upload Method */}
      <div className={`${card} p-1.5 flex gap-1`}>
        <button type="button" onClick={() => setMethod("turbo")} className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${method === "turbo" ? "bg-emerald-500/15 text-emerald-300 shadow-[inset_0_1px_0_rgba(52,211,153,0.2)]" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"}`}>
          <span className="w-2 h-2 rounded-full bg-emerald-400" style={{ opacity: method === "turbo" ? 1 : 0.3 }} />Turbo (Instant)
        </button>
        <button type="button" onClick={() => setMethod("l1")} className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${method === "l1" ? "bg-purple-500/15 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"}`}>
          <span className="w-2 h-2 rounded-full bg-purple-400" style={{ opacity: method === "l1" ? 1 : 0.3 }} />Standard (L1)
        </button>
      </div>

      <div className={`${card} p-4 text-xs ${method === "turbo" ? "text-emerald-300/60 border-emerald-500/10" : "text-purple-300/60 border-purple-500/10"}`}>
        {method === "turbo"
          ? "Bundled via Turbo for instant confirmation. Uses Turbo credits — fund at app.ardrive.io. Falls back to L1 if credits are insufficient."
          : "Submitted directly to the Arweave network (L1). Confirmation takes ~10-30 minutes but only requires AR in your wallet."}
      </div>

      {method === "turbo" && turboBalance && (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-emerald-300/40 uppercase tracking-wider font-medium">Turbo Credits</span>
            <a href="https://app.ardrive.io" target="_blank" rel="noopener noreferrer" className={btnSmall}>Fund Account</a>
          </div>
          <p className="text-lg font-bold text-white mt-1">{parseFloat(turboBalance.ar).toFixed(8)} <span className="text-sm font-normal text-white/30">AR equivalent</span></p>
        </div>
      )}

      {/* Content */}
      <div className={`${card} p-5 space-y-4`}>
        <div>
          <label className={labelCls}>Choose a File</label>
          <input ref={fileRef} type="file" accept="*/*" onChange={handleFileSelect} className="block w-full text-sm text-white/40 file:mr-3 file:h-9 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-medium file:bg-white/[0.06] file:text-white/60 hover:file:bg-white/[0.1] file:cursor-pointer file:transition-all" />
          {file && <p className="text-[11px] text-white/30 mt-1">{file.name} ({formatBytes(file.size)})</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.06]" />
          <span className="text-[10px] text-white/20 uppercase tracking-wider">or</span>
          <span className="h-px flex-1 bg-white/[0.06]" />
        </div>
        <div>
          <label className={labelCls}>Text Content</label>
          <textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setFile(null); if (permawrite && !category) setCategory("text"); }} placeholder="Enter text to store permanently..." className={`${inputCls} h-auto py-3`} style={{ resize: "vertical" }} />
        </div>
        <div>
          <label className={labelCls}>Description (optional)</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this upload?" className={inputCls} />
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
            <p className="text-[11px] text-white/30 mt-0.5">Organize with categories, tags &amp; feeds</p>
          </div>
          <div className={`w-11 h-6 rounded-full flex items-center transition-all ${permawrite ? "bg-violet-500" : "bg-white/[0.08]"}`}>
            <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-all ${permawrite ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
          </div>
        </button>

        {permawrite && (
          <div className="px-5 pb-5 space-y-4 border-t border-white/[0.04]">
            {/* Visibility */}
            <div className="pt-4">
              <label className={labelCls}>Feed Visibility</label>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setVisibility("personal")} className={`flex-1 h-10 rounded-xl text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${visibility === "personal" ? "bg-sky-500/15 text-sky-300 border border-sky-500/30 shadow-[inset_0_1px_0_rgba(56,189,248,0.2)]" : "bg-white/[0.03] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]"}`}>
                  <span className="text-sm">🔒</span> Personal
                </button>
                <button type="button" onClick={() => setVisibility("public")} className={`flex-1 h-10 rounded-xl text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${visibility === "public" ? "bg-violet-500/15 text-violet-300 border border-violet-500/30 shadow-[inset_0_1px_0_rgba(139,92,246,0.2)]" : "bg-white/[0.03] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]"}`}>
                  <span className="text-sm">🌐</span> Public Feed
                </button>
              </div>
              <p className="text-[10px] text-white/25 mt-1.5">
                {visibility === "personal"
                  ? "Tracked in your personal PermaFeed only. Data is still on Arweave but won't appear in the public feed."
                  : "Visible to everyone in the public PermaFeed. Data is permanently on Arweave."}
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
      {(l1Cost || turboCost) && (
        <div className={`${card} p-4`}>
          <span className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Estimated Cost</span>
          <div className="grid grid-cols-2 gap-4 mt-2">
            {turboCost && (
              <div className={method === "turbo" ? "" : "opacity-40"}>
                <p className="text-sm font-bold text-emerald-300">{parseFloat(turboCost.ar).toFixed(8)}</p>
                <p className="text-[10px] text-emerald-300/40">AR via Turbo</p>
              </div>
            )}
            {l1Cost && (
              <div className={method === "l1" ? "" : "opacity-40"}>
                <p className="text-sm font-bold text-white/60">{parseFloat(l1Cost.ar).toFixed(8)}</p>
                <p className="text-[10px] text-white/20">AR via L1</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress */}
      {progress !== null && (
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div className={`h-full rounded-full transition-all ${permawrite ? "bg-gradient-to-r from-violet-500 to-purple-500" : method === "turbo" ? "bg-gradient-to-r from-emerald-500 to-teal-500" : "bg-gradient-to-r from-purple-500 to-violet-500"}`} style={{ width: `${progress}%` }} />
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
