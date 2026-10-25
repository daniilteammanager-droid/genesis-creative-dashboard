// Изменение отклонённого объявления в Meta: ссылка, страница, Multi-advertiser
// (Decision 067). Логика записи — из Genesis Manager Артёма, она проверена на
// живых кабинетах: креатив переписывается прямо в объявлении (POST /{ad_id}
// с creative), а не создаётся отдельный — так Meta сохраняет привязанную к
// объявлению личность Instagram. После записи читаем обратно и сверяем.
//
// Ключ — только Meta владельца кабинета с ads_management. Токены аккаунтов из
// FB Tool и Dolphin сюда не ходят никогда.

const GRAPH = "https://graph.facebook.com/v26.0";

export class GraphError extends Error {
  constructor(message: string, readonly code?: number, readonly subcode?: number) { super(message); }
}

async function graph<T>(token: string, path: string, method: "GET" | "POST", params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET"
    ? await fetch(`${GRAPH}/${path}?${body}`, { signal: AbortSignal.timeout(30_000) })
    : await fetch(`${GRAPH}/${path}`, { method: "POST", body, signal: AbortSignal.timeout(60_000) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } };
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    // Частая причина на новых приложениях — Development Mode: читать можно, писать нельзя.
    if (e.code === 100 && e.error_subcode === 1885183) throw new GraphError("Приложение Meta в Development Mode — переведи его в Live Mode и повтори", e.code, e.error_subcode);
    throw new GraphError(`Meta: ${e.error_user_msg || e.message || `HTTP ${res.status}`}`, e.code, e.error_subcode);
  }
  return json;
}

const AD_FIELDS = "id,name,account_id,effective_status,creative{id},campaign{id,name},adset{id,name}";
const CREATIVE_FIELDS = "id,name,object_story_spec,asset_feed_spec,contextual_multi_ads,link_url,url_tags,object_story_id";

type Story = {
  page_id?: string; instagram_user_id?: string; instagram_actor_id?: string;
  link_data?: { link?: string; [k: string]: unknown };
  video_data?: { video_id?: string; image_url?: string; image_hash?: string; call_to_action?: { value?: { link?: string } }; [k: string]: unknown };
  [k: string]: unknown;
};
export interface Creative {
  id: string; name?: string; object_story_spec?: Story; asset_feed_spec?: unknown;
  contextual_multi_ads?: { enroll_status?: string; [k: string]: unknown };
  link_url?: string; url_tags?: string; object_story_id?: string;
}
export interface AdDetail {
  ad: { id: string; name: string; account_id: string; effective_status: string; creative?: { id: string }; campaign?: { id: string; name: string }; adset?: { id: string; name: string } };
  creative: Creative;
}

export type Change =
  | { type: "link"; newUrl: string }
  | { type: "page"; pageId: string }
  | { type: "multi"; enrollStatus: "OPT_IN" | "OPT_OUT" }
  | { type: "video"; videoId: string; imageUrl: string };   // уникализация (Decision 076)

export const REJECTED = ["DISAPPROVED", "WITH_ISSUES"];

export function currentLink(c: Creative): string {
  const s = c.object_story_spec ?? {};
  return (s.link_data?.link || s.video_data?.call_to_action?.value?.link || c.link_url || "").trim();
}

// Тело нового креатива: копия текущего с одним изменением. Чистая функция.
export function creativeForChange(c: Creative, change: Change): Record<string, unknown> {
  if (c.object_story_id || !c.object_story_spec) throw new Error("Креатив сделан из опубликованного поста — так его не поменять");
  if (c.asset_feed_spec) throw new Error("У креатива языковые варианты — их кнопкой не поменять, только в Ads Manager");
  const story = structuredClone(c.object_story_spec);
  // image_url в video_data — только для чтения: Meta отдаёт превью, но не принимает его назад.
  if (story.video_data?.image_url) delete story.video_data.image_url;
  // Личность Instagram из ответа на чтение бывает не годной для записи — Meta
  // сама подставит ту, что привязана к странице.
  delete story.instagram_user_id;
  delete story.instagram_actor_id;
  const out: Record<string, unknown> = { name: `${c.name || "Genesis"} · anti-reject`, object_story_spec: story };
  if (c.url_tags) out.url_tags = c.url_tags;
  if (c.contextual_multi_ads) out.contextual_multi_ads = structuredClone(c.contextual_multi_ads);

  if (change.type === "link") {
    if (story.link_data?.link) story.link_data.link = change.newUrl;
    else if (story.video_data?.call_to_action?.value?.link) story.video_data.call_to_action.value.link = change.newUrl;
    else throw new Error("У этого формата креатива ссылку кнопкой не поменять");
  } else if (change.type === "page") {
    if (!/^\d+$/.test(change.pageId)) throw new Error("Неверный ID страницы");
    story.page_id = change.pageId;
  } else if (change.type === "video") {
    if (!story.video_data?.video_id || !/^\d+$/.test(change.videoId)) throw new Error("Это не видеокреатив — видео не заменить");
    story.video_data.video_id = change.videoId;
    delete story.video_data.image_hash;
    // Превью нового видео: при записи Meta его требует (чтение его же отдаёт только для чтения).
    story.video_data.image_url = change.imageUrl;
  } else {
    if (!c.contextual_multi_ads) throw new Error("В этом креативе нет настройки Multi-advertiser");
    (out.contextual_multi_ads as Record<string, unknown>).enroll_status = change.enrollStatus;
  }
  return out;
}

export async function adDetail(token: string, adId: string): Promise<AdDetail> {
  if (!/^\d+$/.test(adId)) throw new Error("Неверный ID объявления");
  const ad = await graph<AdDetail["ad"]>(token, adId, "GET", { fields: AD_FIELDS });
  if (!ad.creative?.id) throw new Error("У объявления нет доступного креатива");
  const creative = await graph<Creative>(token, ad.creative.id, "GET", { fields: CREATIVE_FIELDS });
  return { ad, creative };
}

// Страницы, на которые можно переключить: те, что уже стоят в креативах кабинета,
// плюс страницы ключа. Других источников «моих страниц» у Meta нет.
export async function accountPages(token: string, accountId: string): Promise<{ id: string; name: string }[]> {
  const ids = new Set<string>();
  let next: string | null = `act_${accountId}/adcreatives`;
  // По 100: на 500 Meta отвечает «reduce the amount of data» (замер 24.10.2026).
  let params: Record<string, string> = { fields: "object_story_spec{page_id}", limit: "100" };
  for (let i = 0; next && i < 20; i++) {
    const r: { data?: { object_story_spec?: { page_id?: string } }[]; paging?: { cursors?: { after?: string }; next?: string } } = await graph(token, next, "GET", params);
    for (const c of r.data ?? []) if (c.object_story_spec?.page_id) ids.add(c.object_story_spec.page_id);
    next = r.paging?.next && r.paging.cursors?.after ? `act_${accountId}/adcreatives` : null;
    params = { ...params, after: r.paging?.cursors?.after ?? "" };
  }
  const pages = new Map<string, string>();
  try {
    const own = await graph<{ data?: { id: string; name?: string }[] }>(token, "me/accounts", "GET", { fields: "id,name", limit: "200" });
    for (const p of own.data ?? []) pages.set(p.id, p.name ?? "");
  } catch { /* у ключа может не быть pages_show_list — хватит страниц из креативов */ }
  for (const id of ids) {
    if (pages.get(id)) continue;
    try {
      pages.set(id, (await graph<{ name?: string }>(token, id, "GET", { fields: "name" })).name ?? "");
    } catch {
      pages.set(id, "");
    }
  }
  return [...pages].map(([id, name]) => ({ id, name: name || "название недоступно" }));
}

// Видео в кабинет по ссылке (Meta сама скачает файл), дождаться обработки и взять превью.
// ponytail: ждём до ~4 минут — дольше функции Vercel не живут; не успело — ошибка, задание можно повторить.
export async function uploadVideo(token: string, accountId: string, fileUrl: string, title: string): Promise<{ videoId: string; imageUrl: string }> {
  const { id } = await graph<{ id: string }>(token, `act_${accountId}/advideos`, "POST", { file_url: fileUrl, title });
  const status = (v: unknown): string => {
    const o = (v ?? {}) as { video_status?: string; processing_phase?: { status?: string } };
    return String(o.video_status ?? o.processing_phase?.status ?? v ?? "").toLowerCase();
  };
  for (let i = 0; i < 48; i++) {
    const v = await graph<{ status?: unknown }>(token, id, "GET", { fields: "status" });
    const st = status(v.status);
    if (/error|fail/.test(st)) throw new Error(`Meta не обработала видео: ${st}`);
    if (/ready|complete|published/.test(st)) break;
    if (i === 47) throw new Error("Meta обрабатывает видео дольше 4 минут — повтори замену позже");
    await new Promise((r) => setTimeout(r, 5000));
  }
  for (let i = 0; i < 12; i++) {
    const t = await graph<{ data?: { uri?: string; is_preferred?: boolean }[] }>(token, `${id}/thumbnails`, "GET", { fields: "uri,is_preferred" }).catch(() => ({ data: [] }));
    const uri = (t.data ?? []).find((x) => x.is_preferred)?.uri ?? t.data?.[0]?.uri;
    if (uri) return { videoId: id, imageUrl: uri };
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Meta не отдала превью нового видео");
}

export interface Preview {
  adId: string; accountId: string; creativeId: string;
  adName: string; campaignName: string;
  change: Change;
  describe: string;    // что поменяется — человеческим языком, для подтверждения
}

// Записать изменение. Перед записью — что объявление то же самое и всё ещё
// отклонено: за час между «выбрал» и «подтвердил» его могли поправить руками.
export async function applyChange(token: string, p: Preview): Promise<{ status: string; newCreativeId: string }> {
  const before = await adDetail(token, p.adId);
  if (before.ad.account_id.replace(/^act_/, "") !== p.accountId) throw new Error("Объявление переехало в другой кабинет");
  if (before.creative.id !== p.creativeId) throw new Error("Креатив объявления уже поменяли — открой действие заново");
  if (!REJECTED.includes(before.ad.effective_status)) throw new Error("Объявление уже не отклонено");

  const body = creativeForChange(before.creative, p.change);
  // С Instagram-аккаунтом Meta иногда принимает только то же поле, что прочитала:
  // пробуем как было, потом как actor, потом без него — как у Артёма.
  const ig = before.creative.object_story_spec?.instagram_user_id;
  const bodies = (p.change.type === "link" || p.change.type === "video") && ig
    ? [withIg(body, "instagram_user_id", ig), withIg(body, "instagram_actor_id", ig), body]
    : [body];

  let last: unknown = null;
  for (const b of bodies) {
    try {
      await graph(token, p.adId, "POST", { creative: JSON.stringify(b) });
      const after = await adDetail(token, p.adId);
      const s = after.creative.object_story_spec ?? {};
      const ok = p.change.type === "link" ? currentLink(after.creative) === p.change.newUrl
        : p.change.type === "page" ? s.page_id === p.change.pageId
        : p.change.type === "video" ? s.video_data?.video_id === p.change.videoId
        : after.creative.contextual_multi_ads?.enroll_status === p.change.enrollStatus;
      if (ok) return { status: after.ad.effective_status, newCreativeId: after.creative.id };
      last = new Error("Meta приняла запрос, но изменение не видно в объявлении");
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Meta не подтвердила изменение");
}

function withIg(body: Record<string, unknown>, field: string, value: string) {
  const b = structuredClone(body);
  (b.object_story_spec as Story)[field] = value;
  return b;
}
