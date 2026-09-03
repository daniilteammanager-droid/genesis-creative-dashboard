import { type MediaFile, isVideo, isImage } from "@/lib/creatives/media";

// Превью крео. Переехало сюда из легаси-страницы, когда понадобилось во втором
// месте — в новой картотеке. Правило проекта: в components/ переезжает то, что
// реально нужно дважды, а не то, что «может пригодиться».
//
// Видео не грузим, пока есть poster: это лёгкая картинка вместо мегабайтов
// (Decision 007). Нет poster — тег video с preload="none", он тоже ничего не
// тянет до нажатия.

const NO_FILE_WIDE =
  "w-full aspect-square flex items-center justify-center bg-gradient-to-br from-violet-900/20 to-[#0a080f]";
const NO_FILE_SQUARE =
  "w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center bg-gradient-to-br from-violet-900/25 to-[#0d0a1f]";

export function MediaWide({ file }: { file?: MediaFile }) {
  const wrapCls = "w-full aspect-square bg-zinc-900";
  const mediaCls = "w-full h-full object-cover";

  if (!file) return <div className={NO_FILE_WIDE}><span className="text-5xl opacity-40">📷</span></div>;
  if (isVideo(file.url)) {
    return file.posterUrl ? (
      /* eslint-disable-next-line @next/next/no-img-element */
      <div className={wrapCls}><img src={file.posterUrl} alt="" loading="lazy" className={mediaCls} /></div>
    ) : (
      <div className={wrapCls}><video src={file.url} muted loop playsInline preload="none" className={mediaCls} /></div>
    );
  }
  if (isImage(file.url)) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <div className={wrapCls}><img src={file.url} alt="" loading="lazy" className={mediaCls} /></div>;
  }
  return <div className={NO_FILE_WIDE}><span className="text-5xl opacity-40">📷</span></div>;
}

export function MediaSquare({ file }: { file?: MediaFile }) {
  const wrapCls = "w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden bg-zinc-900";
  const mediaCls = "w-full h-full object-cover";

  if (!file) return <div className={NO_FILE_SQUARE}><span className="text-2xl opacity-55">📷</span></div>;
  if (isVideo(file.url)) {
    return file.posterUrl ? (
      /* eslint-disable-next-line @next/next/no-img-element */
      <div className={wrapCls}><img src={file.posterUrl} alt="" loading="lazy" className={mediaCls} /></div>
    ) : (
      <div className={wrapCls}><video src={file.url} muted loop playsInline preload="none" className={mediaCls} /></div>
    );
  }
  if (isImage(file.url)) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <div className={wrapCls}><img src={file.url} alt="" loading="lazy" className={mediaCls} /></div>;
  }
  return <div className={NO_FILE_SQUARE}><span className="text-2xl opacity-55">📷</span></div>;
}
