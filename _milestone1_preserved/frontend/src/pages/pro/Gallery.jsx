import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Reorder } from "framer-motion";
import { ArrowLeft, GripVertical, Star, Trash2, ImagePlus, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Notice, Pill, cx } from "@/components/ui-kit";

const SEED = ["/img/swedish.jpg", "/img/deep.jpg", "/img/hotstone.jpg", "/img/prenatal.jpg", "/img/stones.jpg"].map((src, i) => ({ id: `ph${i}`, src }));

export default function Gallery() {
  const { me, pro, api } = usePreview();
  const nav = useNavigate();
  const p = pro(me.pro);
  const [items, setItems] = useState(SEED);
  const [preview, setPreview] = useState(null);
  const add = (e) => {
    const files = [...e.target.files].slice(0, 6).map((f, i) => ({ id: `up${Date.now()}${i}`, src: URL.createObjectURL(f), local: true }));
    setItems((x) => [...x, ...files]);
    toast("Added locally — uploads aren't connected in this preview");
  };
  const setProfile = async (src) => { await api.save("practitioners", p.id, { photo: src }, "Profile photo updated (preview)"); };
  return (
    <div className="max-w-5xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader back={<button data-testid="gallery-back" onClick={() => nav("/pro/me")} className="h-11 w-11 grid place-items-center rounded-full bg-white ring-1 ring-sky-100 shrink-0"><ArrowLeft className="h-4 w-4" /></button>} eyebrow="Public profile" title="Photos" sub="Drag to reorder. The first three appear on your profile." />
      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <div>
          <label data-testid="gallery-add" className="flex items-center justify-center gap-2 h-14 rounded-3xl border-2 border-dashed border-sky-200 text-nb-blue font-semibold cursor-pointer hover:bg-sky-50 transition-colors mb-4"><ImagePlus className="h-5 w-5" />Add photos<input type="file" accept="image/*" multiple className="hidden" onChange={add} /></label>
          <Reorder.Group axis="y" values={items} onReorder={setItems} className="space-y-2" data-testid="gallery-list">
            {items.map((it, i) => (
              <Reorder.Item key={it.id} value={it} data-testid={`gallery-item-${it.id}`} whileDrag={{ scale: 1.02, boxShadow: "0 20px 40px -16px rgba(11,27,63,.4)" }} className="flex items-center gap-3 rounded-3xl bg-white ring-1 ring-sky-100 p-2.5 cursor-grab active:cursor-grabbing">
                <GripVertical className="h-5 w-5 text-nb-mute shrink-0" />
                <button onClick={() => setPreview(it.src)} className="shrink-0"><img src={it.src} alt="" className="h-16 w-20 rounded-2xl object-cover" draggable={false} /></button>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold">Photo {i + 1}</p><div className="flex gap-1.5 mt-1">{i < 3 && <Pill tone="bg-nb-turq/15 text-nb-teal ring-nb-turq/30">On profile</Pill>}{it.local && <Pill>Local only</Pill>}{p.photo === it.src && <Pill tone="bg-nb-ink text-white ring-nb-ink">Profile photo</Pill>}</div></div>
                <button data-testid={`gallery-star-${it.id}`} onClick={() => setProfile(it.src)} className="h-10 w-10 grid place-items-center rounded-full bg-sky-50 text-nb-blue" aria-label="Set as profile photo"><Star className="h-4 w-4" /></button>
                <button data-testid={`gallery-remove-${it.id}`} onClick={() => setItems((x) => x.filter((y) => y.id !== it.id))} className="h-10 w-10 grid place-items-center rounded-full bg-nb-coral/10 text-nb-coral" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
          <Notice className="mt-4">Photo uploads aren't connected. Order and profile photo are kept in this preview session only.</Notice>
        </div>
        <div className="lg:sticky lg:top-16 h-fit">
          <p className="nb-eyebrow mb-2 flex items-center gap-1"><Eye className="h-3.5 w-3.5" />Live preview</p>
          <div data-testid="gallery-preview" className="nb-card overflow-hidden">
            <div className="relative h-40 tint-ice"><img src={p.photo} alt="" className="absolute right-0 bottom-0 h-full w-1/2 object-cover object-top [mask-image:linear-gradient(to_left,black_70%,transparent)]" /><div className="relative p-4"><p className="text-lg font-semibold max-w-[55%] leading-tight">{p.name}</p><p className="text-xs text-nb-mute">{p.title}</p></div></div>
            <div className="grid grid-cols-3 gap-1.5 p-3">{items.slice(0, 3).map((it) => <img key={it.id} src={it.src} alt="" className="aspect-square w-full rounded-xl object-cover" />)}</div>
          </div>
        </div>
      </div>
      {preview && (
        <div data-testid="gallery-lightbox" className="fixed inset-0 z-[80] bg-nb-ink/90 grid place-items-center p-5" onClick={() => setPreview(null)}>
          <button className="absolute top-12 right-5 h-11 w-11 grid place-items-center rounded-full bg-white/10 text-white"><X className="h-5 w-5" /></button>
          <img src={preview} alt="" className={cx("max-h-[80vh] max-w-full rounded-3xl nb-pop")} />
        </div>
      )}
    </div>
  );
}
