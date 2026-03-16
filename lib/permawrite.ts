import { supabase } from "./supabase";
import ArweaveGateway from "./arweave";
import type { ArweaveTag, ArweaveCostEstimate } from "./wallet-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PermawriteCategory {
  slug: string;
  name: string;
  icon: string;
  description: string | null;
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
  "image/webp": "photo", "image/svg+xml": "photo", "image/bmp": "photo",
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
  "application/pdf": "document", "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "application/zip": "archive", "application/x-tar": "archive",
  "application/gzip": "archive", "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive", "application/x-bzip2": "archive",
};

const EXT_CATEGORY_MAP: Record<string, string> = {
  ".js": "code", ".ts": "code", ".tsx": "code", ".jsx": "code",
  ".py": "code", ".rs": "code", ".go": "code", ".rb": "code",
  ".java": "code", ".c": "code", ".cpp": "code", ".h": "code",
  ".cs": "code", ".php": "code", ".swift": "code", ".kt": "code",
  ".sql": "code", ".sh": "code", ".bash": "code", ".yaml": "code",
  ".yml": "code", ".toml": "code", ".ini": "code", ".env": "code",
  ".sol": "code", ".vy": "code", ".lua": "code",
  ".md": "text", ".txt": "text", ".rtf": "text", ".csv": "text",
};

export function detectCategory(contentType: string | null, fileName: string | null): string {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (CATEGORY_MAP[ct]) return CATEGORY_MAP[ct];
    if (ct.startsWith("image/")) return "photo";
    if (ct.startsWith("video/")) return "video";
    if (ct.startsWith("audio/")) return "audio";
    if (ct.startsWith("text/")) return "text";
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

export async function getCategoryCounts(): Promise<CategoryCount[]> {
  const { data } = await supabase.rpc("permawrite_category_counts");
  return (data ?? []) as CategoryCount[];
}

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
    photo: "📷", video: "🎬", audio: "🎵", text: "📝",
    code: "💻", document: "📄", archive: "📦", other: "📎",
  };
  return icons[category] || "📎";
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}
