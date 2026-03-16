"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useWallet } from "@/lib/wallet-context";
import {
  getCategories,
  getCategoryGroups,
  getCategoryCounts,
  getGroupedCategories,
  getMyItems,
  getFeed,
  deleteItem,
  getSignedUrl,
  getArweaveContentUrl,
  contentIcon,
  formatBytes,
  GROUP_COLORS,
  SUGGESTED_TAGS,
  type PermawriteCategory,
  type PermawriteCategoryGroup,
  type PermawriteItem,
  type CategoryCount,
} from "@/lib/permawrite";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/30 transition-all";
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

type Tab = "mine" | "public";

export default function PermaFeed() {
  const { user } = useWallet();

  const [tab, setTab] = useState<Tab>("mine");
  const [categories, setCategories] = useState<PermawriteCategory[]>([]);
  const [groups, setGroups] = useState<PermawriteCategoryGroup[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);

  const [myItems, setMyItems] = useState<PermawriteItem[]>([]);
  const [myCount, setMyCount] = useState(0);
  const [myLoading, setMyLoading] = useState(false);
  const [myCategory, setMyCategory] = useState<string>("");
  const [myPage, setMyPage] = useState(0);
  const [viewItem, setViewItem] = useState<PermawriteItem | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  const [feedItems, setFeedItems] = useState<PermawriteItem[]>([]);
  const [feedCount, setFeedCount] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedCategory, setFeedCategory] = useState<string>("");
  const [feedTag, setFeedTag] = useState<string>("");
  const [feedPage, setFeedPage] = useState(0);
  const [feedViewItem, setFeedViewItem] = useState<PermawriteItem | null>(null);

  const PER_PAGE = 24;

  useEffect(() => {
    Promise.all([getCategories(), getCategoryGroups(), getCategoryCounts()]).then(
      ([cats, grps, counts]) => {
        setCategories(cats);
        setGroups(grps);
        setCategoryCounts(counts);
      },
    );
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

  const catCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of categoryCounts) map[c.category_slug] = c.item_count;
    return map;
  }, [categoryCounts]);

  const loadMyItems = useCallback(async (page = 0, cat = myCategory) => {
    setMyLoading(true);
    try {
      const { items, count } = await getMyItems({ category: cat || undefined, limit: PER_PAGE, offset: page * PER_PAGE });
      setMyItems(items);
      setMyCount(count);
      setMyPage(page);
    } catch { /* silent */ } finally { setMyLoading(false); }
  }, [myCategory]);

  useEffect(() => { if (user && tab === "mine") loadMyItems(0); }, [user, tab, loadMyItems]);

  const openItem = useCallback(async (item: PermawriteItem) => {
    setViewItem(item);
    setViewUrl(null);
    if (item.arweave_tx_id) {
      setViewUrl(getArweaveContentUrl(item.arweave_tx_id));
    } else if (item.storage_path) {
      setViewUrl(await getSignedUrl(item.storage_path));
    }
  }, []);

  const handleDelete = useCallback(async (item: PermawriteItem) => {
    if (!confirm(`Delete "${item.title || item.file_name}"? ${item.visibility === "private" && !item.arweave_tx_id ? "This will remove the file." : "The Arweave copy is permanent, but it will be removed from your library."}`)) return;
    await deleteItem(item.id);
    setViewItem(null);
    loadMyItems(myPage);
  }, [loadMyItems, myPage]);

  const loadFeed = useCallback(async (page = 0, cat = feedCategory, tag = feedTag) => {
    setFeedLoading(true);
    try {
      const { items, count } = await getFeed({
        category: cat || undefined,
        tag: tag || undefined,
        limit: PER_PAGE,
        offset: page * PER_PAGE,
      });
      setFeedItems(items);
      setFeedCount(count);
      setFeedPage(page);
    } catch { /* silent */ } finally { setFeedLoading(false); }
  }, [feedCategory, feedTag]);

  useEffect(() => { if (tab === "public") loadFeed(0); }, [tab, loadFeed]);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className={`${card} p-1.5 flex gap-1`}>
        <button type="button" onClick={() => { setTab("mine"); setViewItem(null); setFeedViewItem(null); }} className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${tab === "mine" ? "bg-sky-500/20 text-sky-300 shadow-[inset_0_1px_0_rgba(56,189,248,0.2)]" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"}`}>
          <span className="text-xs opacity-60">◫</span>My Files
        </button>
        <button type="button" onClick={() => { setTab("public"); setViewItem(null); setFeedViewItem(null); }} className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${tab === "public" ? "bg-violet-500/20 text-violet-300 shadow-[inset_0_1px_0_rgba(139,92,246,0.2)]" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"}`}>
          <span className="text-xs opacity-60">◉</span>Public Feed
        </button>
      </div>

      {/* MY FILES */}
      {tab === "mine" && !viewItem && (
        <div className="space-y-4">
          <CategoryFilterBar
            categories={categories}
            groups={groups}
            grouped={grouped}
            selected={myCategory}
            onSelect={(slug) => { setMyCategory(slug); loadMyItems(0, slug); }}
            accentColor="sky"
          />
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
              <p className="text-xs text-white/20 mt-1">Upload files from the Upload tab with PermaWrite enabled to see them here.</p>
            </div>
          )}
          {myItems.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {myItems.map((item) => (
                <ItemCard key={item.id} item={item} onClick={() => openItem(item)} />
              ))}
            </div>
          )}
          {myCount > PER_PAGE && (
            <Pagination page={myPage} total={myCount} perPage={PER_PAGE} onPage={(p) => loadMyItems(p)} />
          )}
        </div>
      )}

      {tab === "mine" && viewItem && (
        <ItemDetail
          item={viewItem}
          url={viewUrl}
          catMap={catMap}
          onBack={() => setViewItem(null)}
          onDelete={() => handleDelete(viewItem)}
        />
      )}

      {/* PUBLIC FEED */}
      {tab === "public" && !feedViewItem && (
        <div className="space-y-4">
          <CategoryFilterBar
            categories={categories}
            groups={groups}
            grouped={grouped}
            selected={feedCategory}
            onSelect={(slug) => { setFeedCategory(slug); loadFeed(0, slug, feedTag); }}
            counts={catCountMap}
            accentColor="violet"
          />

          {feedCategory && SUGGESTED_TAGS[feedCategory] && (
            <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              <button
                type="button"
                onClick={() => { setFeedTag(""); loadFeed(0, feedCategory, ""); }}
                className={`${pillBtn} shrink-0 ${!feedTag ? "bg-violet-500/15 text-violet-300 border-violet-500/30" : ""}`}
              >All tags</button>
              {SUGGESTED_TAGS[feedCategory].slice(0, 20).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setFeedTag(t); loadFeed(0, feedCategory, t); }}
                  className={`${pillBtn} shrink-0 ${feedTag === t ? "bg-violet-500/15 text-violet-300 border-violet-500/30" : ""}`}
                >#{t}</button>
              ))}
            </div>
          )}

          {feedLoading && feedItems.length === 0 && (
            <div className={`${card} p-10 text-center`}>
              <div className="w-5 h-5 border-2 border-white/10 border-t-violet-400 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-white/30">Loading feed...</p>
            </div>
          )}
          {!feedLoading && feedItems.length === 0 && (
            <div className={`${card} p-10 text-center`}>
              <p className="text-3xl mb-3 opacity-20">◉</p>
              <p className="text-sm text-white/30">No public content yet</p>
              <p className="text-xs text-white/20 mt-1">PermaWritten content from all users appears here, browseable by category.</p>
            </div>
          )}
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

      {tab === "public" && feedViewItem && (
        <ItemDetail
          item={feedViewItem}
          url={feedViewItem.arweave_tx_id ? getArweaveContentUrl(feedViewItem.arweave_tx_id) : null}
          catMap={catMap}
          onBack={() => setFeedViewItem(null)}
          readonly
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category Filter Bar                                                */
/* ------------------------------------------------------------------ */

function CategoryFilterBar({
  categories,
  groups,
  grouped,
  selected,
  onSelect,
  counts,
  accentColor = "sky",
}: {
  categories: PermawriteCategory[];
  groups: PermawriteCategoryGroup[];
  grouped: { group: PermawriteCategoryGroup; items: PermawriteCategory[] }[];
  selected: string;
  onSelect: (slug: string) => void;
  counts?: Record<string, number>;
  accentColor?: "sky" | "violet";
}) {
  const [mode, setMode] = useState<"flat" | "grouped">("flat");
  const [search, setSearch] = useState("");
  const activeStyles = accentColor === "violet"
    ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
    : "bg-sky-500/15 text-sky-300 border-sky-500/30";

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories.filter(
      (c) => c.name.toLowerCase().includes(q) || c.slug.includes(q),
    );
  }, [categories, search]);

  const selectedCat = categories.find((c) => c.slug === selected);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.04]">
          <button type="button" onClick={() => setMode("flat")} className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all cursor-pointer ${mode === "flat" ? "bg-white/[0.08] text-white/60" : "text-white/25 hover:text-white/40"}`}>
            List
          </button>
          <button type="button" onClick={() => setMode("grouped")} className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all cursor-pointer ${mode === "grouped" ? "bg-white/[0.08] text-white/60" : "text-white/25 hover:text-white/40"}`}>
            Groups
          </button>
        </div>
        {selected && selectedCat && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${activeStyles} flex items-center gap-1`}>
            {selectedCat.icon} {selectedCat.name}
            <button type="button" onClick={() => onSelect("")} className="ml-1 opacity-60 hover:opacity-100 cursor-pointer">×</button>
          </span>
        )}
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter..."
          className="h-7 w-32 px-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/60 text-[10px] placeholder:text-white/20 outline-none focus:border-white/[0.12] transition-all"
        />
      </div>

      {mode === "flat" && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          <button type="button" onClick={() => onSelect("")} className={`${pillBtn} shrink-0 ${!selected ? activeStyles : ""}`}>All</button>
          {filteredCategories.map((c) => (
            <button key={c.slug} type="button" onClick={() => onSelect(c.slug)} className={`${pillBtn} shrink-0 ${selected === c.slug ? activeStyles : ""}`}>
              {c.icon} {c.name}
              {counts?.[c.slug] ? <span className="text-white/20 ml-1">{counts[c.slug]}</span> : null}
            </button>
          ))}
        </div>
      )}

      {mode === "grouped" && (
        <div className="space-y-1.5">
          <button type="button" onClick={() => onSelect("")} className={`${pillBtn} ${!selected ? activeStyles : ""}`}>All</button>
          {grouped.map(({ group: g, items }) => {
            const colors = GROUP_COLORS[g.color] || GROUP_COLORS.zinc;
            const filteredItems = search.trim()
              ? items.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.slug.includes(search.toLowerCase()))
              : items;
            if (filteredItems.length === 0) return null;
            return (
              <div key={g.slug}>
                <p className={`text-[9px] font-semibold uppercase tracking-widest px-1 mb-1 ${colors.text} opacity-60`}>
                  {g.icon} {g.name}
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {filteredItems.map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => onSelect(c.slug)}
                      className={`${pillBtn} ${selected === c.slug ? `${colors.activeBg} ${colors.text} ${colors.border}` : ""}`}
                    >
                      {c.icon} {c.name}
                      {counts?.[c.slug] ? <span className="text-white/20 ml-1">{counts[c.slug]}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Item Card                                                          */
/* ------------------------------------------------------------------ */

function ItemCard({ item, onClick, showBadge = true }: { item: PermawriteItem; onClick: () => void; showBadge?: boolean }) {
  const isImage = item.content_type?.startsWith("image/");
  const isVideo = item.content_type?.startsWith("video/");
  const icon = contentIcon(item.category_slug);
  const thumbUrl = item.arweave_tx_id ? getArweaveContentUrl(item.arweave_tx_id) : null;

  return (
    <button type="button" onClick={onClick} className={`${card} group overflow-hidden text-left cursor-pointer hover:border-white/[0.12] hover:bg-white/[0.05] active:scale-[0.98] transition-all`}>
      <div className="relative aspect-square bg-white/[0.02] flex items-center justify-center overflow-hidden">
        {isImage && thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt={item.title || ""} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
        ) : (<span className="text-4xl opacity-20">{icon}</span>)}
        {isVideo && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white/80 text-lg">▶</span>
          </span>
        )}
        {showBadge && (
          <span className={`absolute top-2 right-2 text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
            item.visibility === "permawrite"
              ? "bg-violet-500/80 text-white"
              : item.arweave_tx_id
                ? "bg-sky-500/80 text-white"
                : "bg-white/20 text-white/60"
          }`}>
            {item.visibility === "permawrite" ? "PUBLIC" : item.arweave_tx_id ? "PERSONAL" : "VAULT"}
          </span>
        )}
      </div>
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

/* ------------------------------------------------------------------ */
/*  Item Detail                                                        */
/* ------------------------------------------------------------------ */

function ItemDetail({
  item,
  url,
  catMap,
  onBack,
  onDelete,
  readonly,
}: {
  item: PermawriteItem;
  url: string | null;
  catMap: Record<string, PermawriteCategory>;
  onBack: () => void;
  onDelete?: () => void;
  readonly?: boolean;
}) {
  const icon = contentIcon(item.category_slug);
  const cat = catMap[item.category_slug];
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

  const badgeLabel = item.visibility === "permawrite" ? "Public Feed" : item.arweave_tx_id ? "Personal" : "Vault";
  const badgeCls = item.visibility === "permawrite"
    ? "bg-violet-500/20 text-violet-300 border border-violet-500/20"
    : item.arweave_tx_id
      ? "bg-sky-500/20 text-sky-300 border border-sky-500/20"
      : "bg-white/10 text-white/40 border border-white/[0.08]";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className={pillBtn}>← Back</button>
        <h2 className="text-sm font-medium text-white/70 truncate flex-1">{item.title || item.file_name || "Untitled"}</h2>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase ${badgeCls}`}>
          {badgeLabel}
        </span>
      </div>

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

      <div className={`${card} p-5 space-y-3`}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-white/30 uppercase">Category</span>
            <p className="text-xs text-white/60">{icon} {cat?.name || item.category_slug}</p>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase">Size</span>
            <p className="text-xs text-white/60">{formatBytes(item.file_size)}</p>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase">Type</span>
            <p className="text-xs text-white/60">{item.content_type || "\u2014"}</p>
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
                <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300/60">#{t}</span>
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
            </div>
          </div>
        )}
      </div>

      {!readonly && (
        <div className="flex gap-2">
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className={`flex-1 flex items-center justify-center ${pillBtn} h-9`}>Download</a>}
          {onDelete && <button type="button" onClick={onDelete} className={`flex-1 flex items-center justify-center ${pillBtn} h-9 text-red-400/50 hover:text-red-400`}>Delete</button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pagination                                                         */
/* ------------------------------------------------------------------ */

function Pagination({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page === 0} className="text-xs text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed">← Prev</button>
      <span className="text-[10px] text-white/40">{page + 1} / {totalPages}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1} className="text-xs text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed">Next →</button>
    </div>
  );
}
