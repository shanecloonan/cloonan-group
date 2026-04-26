import { supabase } from "./supabase";
import ArweaveGateway from "./arweave";
import type { ArweaveTag, ArweaveCostEstimate, UploadMethod } from "./wallet-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PermawriteCategoryGroup {
  slug: string;
  name: string;
  icon: string | null;
  color: string;
  sort_order: number;
}

export interface PermawriteCategory {
  slug: string;
  name: string;
  icon: string;
  description: string | null;
  group_slug: string | null;
  sort_order: number;
}

export interface PermawriteItem {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  category_slug: string;
  tags: string[];
  visibility: "private" | "permawrite";
  file_name: string | null;
  file_size: number;
  content_type: string | null;
  storage_path: string | null;
  arweave_tx_id: string | null;
  arweave_tags: ArweaveTag[];
  created_at: string;
  updated_at: string;
}

export interface CategoryCount {
  category_slug: string;
  item_count: number;
}

/* ------------------------------------------------------------------ */
/*  Category auto-detection                                            */
/* ------------------------------------------------------------------ */

const CATEGORY_MAP: Record<string, string> = {
  "image/jpeg": "photo", "image/png": "photo", "image/gif": "photo",
  "image/webp": "photo", "image/svg+xml": "art", "image/bmp": "photo",
  "image/tiff": "photo", "image/avif": "photo", "image/heic": "photo",
  "video/mp4": "video", "video/webm": "video", "video/ogg": "video",
  "video/quicktime": "video", "video/x-msvideo": "video", "video/x-matroska": "video",
  "audio/mpeg": "audio", "audio/ogg": "audio", "audio/wav": "audio",
  "audio/webm": "audio", "audio/flac": "audio", "audio/aac": "audio",
  "audio/mp4": "audio", "audio/x-m4a": "audio",
  "text/plain": "text", "text/markdown": "text", "text/rtf": "text",
  "application/json": "code", "text/javascript": "code", "text/typescript": "code",
  "text/html": "code", "text/css": "code", "text/xml": "code",
  "application/xml": "code", "text/x-python": "code", "text/x-rust": "code",
  "text/x-go": "code", "text/x-c": "code", "text/x-java": "code",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.ms-powerpoint": "presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentation",
  "application/zip": "archive", "application/x-tar": "archive",
  "application/gzip": "archive", "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive", "application/x-bzip2": "archive",
  "model/gltf-binary": "3d-model", "model/gltf+json": "3d-model",
  "model/stl": "3d-model", "model/obj": "3d-model",
  "text/csv": "spreadsheet",
};

const EXT_CATEGORY_MAP: Record<string, string> = {
  ".js": "code", ".ts": "code", ".tsx": "code", ".jsx": "code",
  ".py": "code", ".rs": "code", ".go": "code", ".rb": "code",
  ".java": "code", ".c": "code", ".cpp": "code", ".h": "code",
  ".cs": "code", ".php": "code", ".swift": "code", ".kt": "code",
  ".sql": "code", ".lua": "code", ".r": "code", ".scala": "code",
  ".zig": "code", ".haskell": "code", ".hs": "code", ".ex": "code",
  ".exs": "code", ".clj": "code", ".erl": "code", ".v": "code",
  ".sol": "blockchain", ".vy": "blockchain", ".move": "blockchain",
  ".sh": "config", ".bash": "config", ".zsh": "config",
  ".yaml": "config", ".yml": "config", ".toml": "config",
  ".ini": "config", ".env": "config", ".conf": "config",
  ".dockerfile": "config", ".tf": "config", ".hcl": "config",
  ".nginx": "config", ".editorconfig": "config",
  ".md": "text", ".txt": "text", ".rtf": "text",
  ".csv": "spreadsheet", ".tsv": "spreadsheet",
  ".xls": "spreadsheet", ".xlsx": "spreadsheet",
  ".ppt": "presentation", ".pptx": "presentation", ".key": "presentation",
  ".svg": "art", ".ai": "art", ".psd": "art", ".fig": "art",
  ".sketch": "art", ".xd": "art",
  ".stl": "3d-model", ".obj": "3d-model", ".fbx": "3d-model",
  ".gltf": "3d-model", ".glb": "3d-model", ".blend": "3d-model",
  ".step": "3d-model", ".iges": "3d-model",
  ".ipynb": "ai-ml", ".onnx": "ai-ml", ".pt": "ai-ml",
  ".h5": "ai-ml", ".safetensors": "ai-ml", ".gguf": "ai-ml",
  ".json": "code", ".jsonc": "config", ".json5": "config",
  ".graphql": "api", ".gql": "api", ".proto": "api",
  ".wsdl": "api", ".wadl": "api",
  ".url": "bookmark", ".webloc": "bookmark",
};

const FILENAME_CATEGORY_MAP: Record<string, string> = {
  "dockerfile": "config",
  "docker-compose.yml": "config",
  "docker-compose.yaml": "config",
  "makefile": "config",
  "cmakelists.txt": "config",
  ".gitignore": "config",
  ".gitattributes": "config",
  ".prettierrc": "config",
  ".eslintrc": "config",
  "tsconfig.json": "config",
  "package.json": "config",
  "cargo.toml": "config",
  "go.mod": "config",
  "requirements.txt": "config",
  "pipfile": "config",
  "gemfile": "config",
  "swagger.json": "api",
  "swagger.yaml": "api",
  "openapi.json": "api",
  "openapi.yaml": "api",
};

export function detectCategory(contentType: string | null, fileName: string | null): string {
  if (fileName) {
    const lower = fileName.toLowerCase();
    if (FILENAME_CATEGORY_MAP[lower]) return FILENAME_CATEGORY_MAP[lower];
  }
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (CATEGORY_MAP[ct]) return CATEGORY_MAP[ct];
    if (ct.startsWith("image/")) return "photo";
    if (ct.startsWith("video/")) return "video";
    if (ct.startsWith("audio/")) return "audio";
    if (ct.startsWith("text/")) return "text";
    if (ct.startsWith("model/")) return "3d-model";
  }
  if (fileName) {
    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    if (EXT_CATEGORY_MAP[ext]) return EXT_CATEGORY_MAP[ext];
  }
  return "other";
}

/* ------------------------------------------------------------------ */
/*  Category queries                                                   */
/* ------------------------------------------------------------------ */

export async function getCategories(): Promise<PermawriteCategory[]> {
  const { data } = await supabase
    .from("permawrite_categories")
    .select("*")
    .order("sort_order");
  return (data ?? []) as PermawriteCategory[];
}

export async function getCategoryGroups(): Promise<PermawriteCategoryGroup[]> {
  const { data } = await supabase
    .from("permawrite_category_groups")
    .select("*")
    .order("sort_order");
  return (data ?? []) as PermawriteCategoryGroup[];
}

export async function getCategoryCounts(): Promise<CategoryCount[]> {
  const { data } = await supabase.rpc("permawrite_category_counts");
  return (data ?? []) as CategoryCount[];
}

export function getGroupedCategories(
  categories: PermawriteCategory[],
  groups: PermawriteCategoryGroup[],
): { group: PermawriteCategoryGroup; items: PermawriteCategory[] }[] {
  return groups
    .map((g) => ({
      group: g,
      items: categories.filter((c) => c.group_slug === g.slug),
    }))
    .filter((g) => g.items.length > 0);
}

export const GROUP_COLORS: Record<string, { bg: string; border: string; text: string; activeBg: string }> = {
  sky:     { bg: "bg-sky-500/8",     border: "border-sky-500/20",     text: "text-sky-300",     activeBg: "bg-sky-500/15" },
  emerald: { bg: "bg-emerald-500/8", border: "border-emerald-500/20", text: "text-emerald-300", activeBg: "bg-emerald-500/15" },
  amber:   { bg: "bg-amber-500/8",   border: "border-amber-500/20",   text: "text-amber-300",   activeBg: "bg-amber-500/15" },
  violet:  { bg: "bg-violet-500/8",  border: "border-violet-500/20",  text: "text-violet-300",  activeBg: "bg-violet-500/15" },
  blue:    { bg: "bg-blue-500/8",    border: "border-blue-500/20",    text: "text-blue-300",    activeBg: "bg-blue-500/15" },
  rose:    { bg: "bg-rose-500/8",    border: "border-rose-500/20",    text: "text-rose-300",    activeBg: "bg-rose-500/15" },
  orange:  { bg: "bg-orange-500/8",  border: "border-orange-500/20",  text: "text-orange-300",  activeBg: "bg-orange-500/15" },
  cyan:    { bg: "bg-cyan-500/8",    border: "border-cyan-500/20",    text: "text-cyan-300",    activeBg: "bg-cyan-500/15" },
  zinc:    { bg: "bg-zinc-500/8",    border: "border-zinc-500/20",    text: "text-zinc-300",    activeBg: "bg-zinc-500/15" },
};

/* ------------------------------------------------------------------ */
/*  Item queries                                                       */
/* ------------------------------------------------------------------ */

export async function getMyItems(
  opts?: { category?: string; limit?: number; offset?: number },
): Promise<{ items: PermawriteItem[]; count: number }> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return { items: [], count: 0 };

  let query = supabase
    .from("permawrite_items")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (opts?.category) query = query.eq("category_slug", opts.category);
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.range(opts.offset, opts.offset + (opts.limit || 25) - 1);

  const { data, count } = await query;
  return { items: (data ?? []) as PermawriteItem[], count: count ?? 0 };
}

export async function getFeed(
  opts?: { category?: string; tag?: string; limit?: number; offset?: number },
): Promise<{ items: PermawriteItem[]; count: number }> {
  let query = supabase
    .from("permawrite_items")
    .select("*", { count: "exact" })
    .eq("visibility", "permawrite")
    .order("created_at", { ascending: false });

  if (opts?.category) query = query.eq("category_slug", opts.category);
  if (opts?.tag) query = query.contains("tags", [opts.tag]);
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.range(opts.offset, opts.offset + (opts.limit || 25) - 1);

  const { data, count } = await query;
  return { items: (data ?? []) as PermawriteItem[], count: count ?? 0 };
}

export async function getItem(id: string): Promise<PermawriteItem | null> {
  const { data } = await supabase
    .from("permawrite_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as PermawriteItem | null;
}

/* ------------------------------------------------------------------ */
/*  File URL helpers                                                   */
/* ------------------------------------------------------------------ */

export function getPrivateFileUrl(storagePath: string): string {
  const { data } = supabase.storage
    .from("permawrite-private")
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("permawrite-private")
    .createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

export function getArweaveContentUrl(txId: string): string {
  return `https://arweave.net/${txId}`;
}

export function getArioContentUrl(txId: string): string {
  return `https://ar-io.net/${txId}`;
}

/* ------------------------------------------------------------------ */
/*  Upload: Private                                                    */
/* ------------------------------------------------------------------ */

export async function uploadPrivate(
  file: File,
  opts: {
    title?: string;
    description?: string;
    category: string;
    tags: string[];
  },
): Promise<PermawriteItem | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const ext = file.name.slice(file.name.lastIndexOf("."));
  const storagePath = `${userId}/${crypto.randomUUID()}${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("permawrite-private")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

  const { data, error } = await supabase
    .from("permawrite_items")
    .insert({
      user_id: userId,
      title: opts.title || file.name,
      description: opts.description || null,
      category_slug: opts.category,
      tags: opts.tags,
      visibility: "private",
      file_name: file.name,
      file_size: file.size,
      content_type: file.type,
      storage_path: storagePath,
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data as PermawriteItem;
}

export async function uploadPrivateText(
  text: string,
  opts: {
    title?: string;
    description?: string;
    category: string;
    tags: string[];
    fileName?: string;
  },
): Promise<PermawriteItem | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const fileName = opts.fileName || "text.txt";
  const storagePath = `${userId}/${crypto.randomUUID()}.txt`;
  const blob = new Blob([text], { type: "text/plain" });

  const { error: uploadErr } = await supabase.storage
    .from("permawrite-private")
    .upload(storagePath, blob, { contentType: "text/plain" });

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

  const { data, error } = await supabase
    .from("permawrite_items")
    .insert({
      user_id: userId,
      title: opts.title || fileName,
      description: opts.description || null,
      category_slug: opts.category,
      tags: opts.tags,
      visibility: "private",
      file_name: fileName,
      file_size: new TextEncoder().encode(text).byteLength,
      content_type: "text/plain",
      storage_path: storagePath,
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data as PermawriteItem;
}

/* ------------------------------------------------------------------ */
/*  Upload: PermaWrite (to Arweave + log in DB)                        */
/* ------------------------------------------------------------------ */

export async function permawrite(
  file: File,
  jwk: JsonWebKey,
  opts: {
    title?: string;
    description?: string;
    category: string;
    tags: string[];
  },
  onProgress?: (pct: number) => void,
): Promise<PermawriteItem | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const gw = new ArweaveGateway();

  const arTags: ArweaveTag[] = [
    { name: "Content-Type", value: file.type || "application/octet-stream" },
    { name: "App-Name", value: "PermaWrite" },
    { name: "App-Version", value: "1.0" },
    { name: "Category", value: opts.category },
    { name: "Title", value: opts.title || file.name },
  ];
  if (opts.description) arTags.push({ name: "Description", value: opts.description });
  for (const tag of opts.tags) {
    arTags.push({ name: "Tag", value: tag });
  }

  const result = await gw.uploadFile(file, arTags, jwk, opts.description || file.name, onProgress);

  if (result.status !== 200) throw new Error(`Arweave upload failed (status ${result.status})`);

  const { data, error } = await supabase
    .from("permawrite_items")
    .insert({
      user_id: userId,
      title: opts.title || file.name,
      description: opts.description || null,
      category_slug: opts.category,
      tags: opts.tags,
      visibility: "permawrite",
      file_name: file.name,
      file_size: file.size,
      content_type: file.type,
      arweave_tx_id: result.txId,
      arweave_tags: arTags,
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data as PermawriteItem;
}

export async function permawriteText(
  text: string,
  jwk: JsonWebKey,
  opts: {
    title?: string;
    description?: string;
    category: string;
    tags: string[];
  },
  onProgress?: (pct: number) => void,
): Promise<PermawriteItem | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const gw = new ArweaveGateway();
  const data_bytes = new TextEncoder().encode(text);

  const arTags: ArweaveTag[] = [
    { name: "Content-Type", value: "text/plain" },
    { name: "App-Name", value: "PermaWrite" },
    { name: "App-Version", value: "1.0" },
    { name: "Category", value: opts.category },
    { name: "Title", value: opts.title || "text" },
  ];
  if (opts.description) arTags.push({ name: "Description", value: opts.description });
  for (const tag of opts.tags) {
    arTags.push({ name: "Tag", value: tag });
  }

  const result = await gw.uploadData(data_bytes, arTags, jwk, opts.description, onProgress);

  if (result.status !== 200) throw new Error(`Arweave upload failed (status ${result.status})`);

  const { data: row, error } = await supabase
    .from("permawrite_items")
    .insert({
      user_id: userId,
      title: opts.title || "Text",
      description: opts.description || null,
      category_slug: opts.category,
      tags: opts.tags,
      visibility: "permawrite",
      file_name: null,
      file_size: data_bytes.byteLength,
      content_type: "text/plain",
      arweave_tx_id: result.txId,
      arweave_tags: arTags,
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return row as PermawriteItem;
}

/* ------------------------------------------------------------------ */
/*  Upload: Smart PermaWrite (Turbo first, L1 fallback)                */
/* ------------------------------------------------------------------ */

export async function permawriteSmart(
  file: File,
  jwk: JsonWebKey,
  opts: {
    title?: string;
    description?: string;
    category: string;
    tags: string[];
    preferredMethod?: UploadMethod;
    visibility?: "private" | "permawrite";
    customTags?: ArweaveTag[];
  },
  onProgress?: (pct: number) => void,
): Promise<PermawriteItem & { method: UploadMethod } | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const gw = new ArweaveGateway();

  const arTags: ArweaveTag[] = [
    { name: "Content-Type", value: file.type || "application/octet-stream" },
    { name: "App-Name", value: "PermaWrite" },
    { name: "App-Version", value: "1.0" },
    { name: "Category", value: opts.category },
    { name: "Title", value: opts.title || file.name },
  ];
  if (opts.description) arTags.push({ name: "Description", value: opts.description });
  for (const tag of opts.tags) arTags.push({ name: "Tag", value: tag });
  if (opts.customTags) for (const ct of opts.customTags) arTags.push(ct);

  const result = await gw.smartUploadFile(
    file, arTags, jwk, opts.preferredMethod ?? "l1",
    opts.description || file.name, onProgress,
  );

  if (result.status !== 200) throw new Error(`Arweave upload failed (status ${result.status})`);

  const { data, error } = await supabase
    .from("permawrite_items")
    .insert({
      user_id: userId,
      title: opts.title || file.name,
      description: opts.description || null,
      category_slug: opts.category,
      tags: opts.tags,
      visibility: opts.visibility ?? "permawrite",
      file_name: file.name,
      file_size: file.size,
      content_type: file.type,
      arweave_tx_id: result.txId,
      arweave_tags: arTags,
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return { ...(data as PermawriteItem), method: result.method };
}

export async function permawriteTextSmart(
  text: string,
  jwk: JsonWebKey,
  opts: {
    title?: string;
    description?: string;
    category: string;
    tags: string[];
    preferredMethod?: UploadMethod;
    visibility?: "private" | "permawrite";
    customTags?: ArweaveTag[];
  },
  onProgress?: (pct: number) => void,
): Promise<PermawriteItem & { method: UploadMethod } | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const gw = new ArweaveGateway();
  const data_bytes = new TextEncoder().encode(text);

  const arTags: ArweaveTag[] = [
    { name: "Content-Type", value: "text/plain" },
    { name: "App-Name", value: "PermaWrite" },
    { name: "App-Version", value: "1.0" },
    { name: "Category", value: opts.category },
    { name: "Title", value: opts.title || "text" },
  ];
  if (opts.description) arTags.push({ name: "Description", value: opts.description });
  for (const tag of opts.tags) arTags.push({ name: "Tag", value: tag });
  if (opts.customTags) for (const ct of opts.customTags) arTags.push(ct);

  const result = await gw.smartUploadData(
    data_bytes, arTags, jwk, opts.preferredMethod ?? "l1",
    opts.description, onProgress,
  );

  if (result.status !== 200) throw new Error(`Arweave upload failed (status ${result.status})`);

  const { data: row, error } = await supabase
    .from("permawrite_items")
    .insert({
      user_id: userId,
      title: opts.title || "Text",
      description: opts.description || null,
      category_slug: opts.category,
      tags: opts.tags,
      visibility: opts.visibility ?? "permawrite",
      file_name: null,
      file_size: data_bytes.byteLength,
      content_type: "text/plain",
      arweave_tx_id: result.txId,
      arweave_tags: arTags,
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return { ...(row as PermawriteItem), method: result.method };
}

/* ------------------------------------------------------------------ */
/*  Cost estimation                                                    */
/* ------------------------------------------------------------------ */

export async function estimatePermawriteCost(bytes: number): Promise<ArweaveCostEstimate | null> {
  try {
    const gw = new ArweaveGateway();
    return await gw.estimateCost(bytes);
  } catch {
    return null;
  }
}

export async function estimateTurboCost(bytes: number): Promise<{ winc: string; ar: string } | null> {
  try {
    return await ArweaveGateway.getTurboPrice(bytes);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Item management                                                    */
/* ------------------------------------------------------------------ */

export async function updateItem(
  id: string,
  updates: { title?: string; description?: string; tags?: string[] },
): Promise<void> {
  await supabase
    .from("permawrite_items")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function deleteItem(id: string): Promise<void> {
  const { data: item } = await supabase
    .from("permawrite_items")
    .select("storage_path, user_id")
    .eq("id", id)
    .single();

  if (item?.storage_path) {
    await supabase.storage.from("permawrite-private").remove([item.storage_path]);
  }

  await supabase.from("permawrite_items").delete().eq("id", id);
}

/* ------------------------------------------------------------------ */
/*  Content type helpers                                               */
/* ------------------------------------------------------------------ */

export function isPreviewable(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.startsWith("image/") || ct.startsWith("text/") ||
    ct === "application/json" || ct === "application/pdf" ||
    ct.startsWith("video/") || ct.startsWith("audio/");
}

export function contentIcon(category: string): string {
  const icons: Record<string, string> = {
    photo: "📷", video: "🎬", audio: "🎵", art: "🎨",
    screenshot: "📸", "3d-model": "🧊",
    text: "📝", article: "📰", journal: "📓", story: "📖",
    poetry: "🪶", quote: "💬",
    research: "🔬", education: "🎓", reference: "📚",
    science: "🧪", history: "🏛️",
    code: "💻", config: "🔧", api: "📡", "ai-ml": "🤖",
    blockchain: "⛓️", security: "🛡️",
    document: "📄", spreadsheet: "📊", presentation: "📑",
    template: "📋", archive: "📦",
    business: "💼", finance: "💰", legal: "⚖️",
    marketing: "📢", project: "🗂️",
    health: "🏥", travel: "✈️", food: "🍳",
    fitness: "🏋️", home: "🏠",
    news: "🌍", social: "🤝", culture: "🎭", announcement: "📣",
    bookmark: "🔖", other: "📎",
  };
  return icons[category] || "📎";
}

export const SUGGESTED_TAGS: Record<string, string[]> = {
  photo: [
    "portrait", "landscape", "nature", "wildlife", "street", "macro", "aerial",
    "night", "architecture", "event", "product", "abstract", "black-and-white",
    "panorama", "hdr", "vintage", "documentary", "fashion", "wedding", "sports",
    "pet", "food-photo", "astrophotography", "underwater", "fine-art", "selfie",
    "drone", "timelapse", "long-exposure", "film",
  ],
  video: [
    "short-film", "vlog", "tutorial", "documentary", "timelapse", "animation",
    "drone", "music-video", "interview", "gameplay", "livestream", "cinematic",
    "behind-the-scenes", "trailer", "review", "course-video", "event-recording",
    "reaction", "podcast-video", "slow-motion", "4k", "vertical", "loop",
    "unboxing", "walkthrough",
  ],
  audio: [
    "music", "podcast", "voice-memo", "sound-effect", "ambient", "interview",
    "audiobook", "lecture", "remix", "original", "cover", "instrumental",
    "spoken-word", "field-recording", "asmr", "radio", "jingle", "meditation",
    "binaural", "lo-fi", "sample", "mix", "live-recording", "acapella",
  ],
  art: [
    "digital-art", "illustration", "vector", "pixel-art", "concept-art",
    "fan-art", "logo", "icon-design", "typography", "ui-design", "ux-mockup",
    "wireframe", "infographic", "poster", "banner", "album-art", "generative",
    "ai-art", "sketch", "calligraphy", "comic", "storyboard", "pattern",
    "gradient", "moodboard",
  ],
  screenshot: [
    "app", "desktop", "mobile", "browser", "error", "debug", "ui-bug",
    "before-after", "proof", "conversation", "notification", "settings",
    "dashboard", "analytics", "terminal", "code-screenshot", "receipt",
  ],
  "3d-model": [
    "blender", "unity", "unreal", "cad", "architectural", "character",
    "environment", "prop", "vehicle", "texture", "material", "rigged",
    "animated", "sculpt", "scan", "game-asset", "print-ready",
  ],
  text: [
    "note", "memo", "thought", "idea", "draft", "snippet", "log", "list",
    "outline", "brainstorm", "reminder", "summary", "transcript", "annotation",
    "caption", "quicknote", "clipboard", "scratch", "todo",
  ],
  article: [
    "blog-post", "opinion", "analysis", "editorial", "how-to", "guide",
    "explainer", "deep-dive", "review", "comparison", "case-study",
    "interview", "profile", "investigative", "longform", "tech-article",
    "philosophy", "science-writing", "personal-essay",
  ],
  journal: [
    "daily", "weekly", "monthly", "reflection", "gratitude", "dream",
    "mood", "personal", "milestone", "lesson-learned", "goal",
    "morning-pages", "travel-diary", "work-log", "year-in-review",
    "bucket-list", "habits", "affirmation",
  ],
  story: [
    "short-story", "novella", "novel", "flash-fiction", "sci-fi", "fantasy",
    "horror", "romance", "mystery", "thriller", "literary", "satire",
    "memoir", "autobiography", "fan-fiction", "dystopian", "historical-fiction",
    "magical-realism", "cyberpunk",
  ],
  poetry: [
    "haiku", "sonnet", "free-verse", "limerick", "epic", "ballad", "ode",
    "elegy", "lyric", "narrative", "visual-poetry", "slam", "rap-lyrics",
    "song-lyrics", "experimental", "concrete", "prose-poetry", "ghazal",
  ],
  quote: [
    "book-quote", "movie-quote", "speech", "proverb", "aphorism", "wisdom",
    "motivational", "philosophical", "literary", "historical", "attributed",
    "anonymous", "personal-motto", "excerpt", "highlight", "tweet",
  ],
  research: [
    "whitepaper", "thesis", "dissertation", "peer-reviewed", "abstract",
    "literature-review", "methodology", "findings", "meta-analysis",
    "survey", "experiment", "hypothesis", "bibliography", "citation",
    "preprint", "grant-proposal", "field-study",
  ],
  education: [
    "course", "lecture", "tutorial", "syllabus", "textbook", "study-guide",
    "flashcard", "quiz", "exam", "certificate", "cheat-sheet", "workshop",
    "seminar", "mooc", "self-study", "curriculum", "lesson-plan",
  ],
  reference: [
    "manual", "documentation", "handbook", "encyclopedia", "glossary",
    "faq", "specification", "standard", "protocol", "best-practice",
    "cheatsheet", "quick-reference", "index", "catalog", "directory",
    "api-docs", "man-page",
  ],
  science: [
    "biology", "chemistry", "physics", "mathematics", "astronomy",
    "geology", "ecology", "genetics", "neuroscience", "climate",
    "dataset", "simulation", "model", "formula", "observation",
    "statistics", "quantum", "medicine",
  ],
  history: [
    "primary-source", "secondary-source", "chronicle", "artifact",
    "genealogy", "oral-history", "archive", "timeline", "era",
    "civilization", "war", "revolution", "discovery", "biography",
    "memorial", "ancient", "medieval", "modern",
  ],
  code: [
    "javascript", "typescript", "python", "rust", "go", "solidity",
    "react", "nextjs", "node", "sql", "algorithm", "library",
    "framework", "open-source", "snippet", "boilerplate",
    "proof-of-concept", "cli", "full-stack", "backend", "frontend",
    "deno", "bun", "svelte", "vue", "angular",
  ],
  config: [
    "docker", "kubernetes", "terraform", "ansible", "nginx",
    "github-actions", "ci-cd", "env-vars", "yaml", "toml",
    "dockerfile", "compose", "helm", "serverless", "aws", "gcp",
    "azure", "vercel", "cloudflare", "monitoring", "logging",
  ],
  api: [
    "rest", "graphql", "grpc", "websocket", "openapi", "swagger",
    "postman", "schema", "endpoint", "webhook", "oauth", "jwt",
    "rate-limit", "versioned", "microservice", "protobuf", "trpc",
    "hono", "express", "fastapi",
  ],
  "ai-ml": [
    "neural-network", "transformer", "llm", "fine-tune", "dataset",
    "training", "inference", "prompt", "embedding", "vector-db", "rag",
    "agent", "diffusion", "computer-vision", "nlp", "reinforcement-learning",
    "pytorch", "tensorflow", "huggingface", "openai", "anthropic",
    "langchain", "stable-diffusion", "lora", "gguf",
  ],
  blockchain: [
    "smart-contract", "solidity", "ethereum", "bitcoin", "arweave",
    "defi", "nft", "dao", "token", "wallet", "transaction", "on-chain",
    "layer-2", "bridge", "oracle", "audit", "solana", "cosmos",
    "polkadot", "ipfs", "filecoin", "zero-knowledge",
  ],
  security: [
    "encryption", "vulnerability", "audit", "penetration-test", "firewall",
    "ssl-tls", "zero-knowledge", "multi-sig", "key-management",
    "incident-response", "compliance", "privacy", "authentication",
    "authorization", "threat-model", "pgp", "ssh", "certificate",
  ],
  document: [
    "pdf", "report", "memo", "letter", "manual", "policy", "procedure",
    "specification", "agreement", "proposal", "whitepaper", "handbook",
    "guide", "certificate", "record", "transcript", "brief", "draft",
  ],
  spreadsheet: [
    "financial-model", "budget", "forecast", "pivot-table", "dashboard",
    "kpi", "metrics", "inventory", "payroll", "tax", "analysis",
    "comparison", "tracking", "log", "calculation", "database-export",
  ],
  presentation: [
    "pitch-deck", "keynote", "slides", "webinar", "demo", "training",
    "quarterly-review", "annual-report", "product-launch", "investor",
    "board-meeting", "workshop", "conference", "sales-deck", "portfolio",
  ],
  template: [
    "contract-template", "invoice-template", "resume", "cover-letter",
    "business-plan", "proposal-template", "email-template", "checklist",
    "sop", "form", "survey", "questionnaire", "nda", "mou", "framework",
  ],
  archive: [
    "backup", "snapshot", "export", "migration", "bundle", "release",
    "distribution", "package", "compressed", "encrypted", "versioned",
    "incremental", "full-backup", "cold-storage", "disaster-recovery",
  ],
  business: [
    "strategy", "meeting-notes", "okr", "kpi", "swot",
    "competitive-analysis", "market-research", "partnership", "vendor",
    "client", "stakeholder", "executive-summary", "board-report",
    "growth", "operations", "startup", "pitch",
  ],
  finance: [
    "invoice", "receipt", "tax-return", "bank-statement", "p-and-l",
    "balance-sheet", "budget", "forecast", "expense-report", "payroll",
    "investment", "portfolio", "audit", "crypto-tax", "bookkeeping",
  ],
  legal: [
    "contract", "agreement", "nda", "terms-of-service", "privacy-policy",
    "patent", "trademark", "copyright", "litigation", "filing",
    "power-of-attorney", "will", "trust", "incorporation", "regulatory",
    "compliance", "arbitration",
  ],
  marketing: [
    "brand-guide", "ad-creative", "social-media", "seo", "content-calendar",
    "analytics", "a-b-test", "email-campaign", "landing-page",
    "press-release", "case-study", "testimonial", "influencer",
    "affiliate", "roi", "funnel", "copywriting",
  ],
  project: [
    "roadmap", "timeline", "gantt", "sprint", "backlog", "requirements",
    "specification", "wireframe", "prototype", "milestone", "deliverable",
    "stakeholder", "risk-assessment", "retrospective", "scope",
    "kanban", "agile", "waterfall",
  ],
  health: [
    "medical-record", "prescription", "lab-result", "vaccination",
    "insurance", "appointment", "diagnosis", "treatment", "therapy",
    "mental-health", "nutrition", "supplement", "allergy", "dental",
    "vision", "blood-work", "vitals",
  ],
  travel: [
    "itinerary", "booking", "passport", "visa", "map", "guide",
    "review", "photo-journal", "packing-list", "budget", "flight",
    "hotel", "restaurant", "landmark", "adventure", "road-trip",
    "backpacking", "cruise",
  ],
  food: [
    "recipe", "meal-plan", "grocery-list", "restaurant-review",
    "cooking-tip", "baking", "cocktail", "nutrition-info", "diet",
    "vegan", "vegetarian", "gluten-free", "fermentation", "bbq",
    "dessert", "sous-vide", "preserving",
  ],
  fitness: [
    "workout", "training-plan", "progress-photo", "personal-record",
    "cardio", "strength", "yoga", "running", "cycling", "swimming",
    "hiking", "martial-arts", "recovery", "stretching", "competition",
    "crossfit", "calisthenics",
  ],
  home: [
    "warranty", "insurance", "mortgage", "lease", "renovation",
    "maintenance", "appliance", "garden", "pet-record", "school",
    "childcare", "vehicle", "utility", "inventory", "family-photo",
    "estate-planning", "moving",
  ],
  news: [
    "breaking", "local", "national", "international", "tech-news",
    "politics", "economics", "sports-news", "science-news", "environment",
    "culture-news", "opinion", "editorial", "press-release", "fact-check",
  ],
  social: [
    "discussion", "forum-post", "tweet-archive", "chat-log", "group",
    "event", "meetup", "collaboration", "open-letter", "petition",
    "feedback", "recommendation", "testimonial", "ama", "community",
  ],
  culture: [
    "book-review", "film-review", "music-review", "exhibit",
    "performance", "tradition", "language", "philosophy", "religion",
    "mythology", "folklore", "cuisine", "fashion", "architecture-culture",
    "anthropology",
  ],
  announcement: [
    "product-launch", "update", "changelog", "deprecation", "maintenance",
    "outage", "release-notes", "newsletter", "press-release", "milestone",
    "hiring", "event", "partnership", "acquisition",
  ],
  bookmark: [
    "read-later", "reference", "tool", "resource", "tutorial-link",
    "article-link", "video-link", "podcast-link", "github", "documentation",
    "blog", "newsletter", "course", "community", "inspiration",
  ],
  other: [
    "misc", "temp", "draft", "unsorted", "imported", "legacy", "test",
    "sample", "placeholder", "wip", "experiment",
  ],
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}
