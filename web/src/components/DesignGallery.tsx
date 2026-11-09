import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Sparkles } from "lucide-react";
import { api } from "../api.ts";
import type { DesignMeta } from "../../../server/types.ts";
import { Modal } from "./Modal.tsx";

/** Loads the library; bump `version` to fetch it again. */
export function useDesigns(version = 0): DesignMeta[] | null {
  const [designs, setDesigns] = useState<DesignMeta[] | null>(null);
  useEffect(() => {
    api<DesignMeta[]>("GET", "/api/designs").then(setDesigns).catch(() => setDesigns([]));
  }, [version]);
  return designs;
}

/** A live, scaled-down render of the shared sample page in this design. */
export function DesignThumb({ id, name, src }: { id: string; name: string; src?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Scale the 1200px-wide sample page to whatever width the card has.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--thumb-scale", String(el.clientWidth / 1200));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="thumb" ref={ref}>
      <iframe src={src ?? `/api/designs/${id}/preview`} title={`${name} preview`} loading="lazy" tabIndex={-1} sandbox="" />
    </div>
  );
}

/** Grid of designs with search and tag filters. `onPick(null)` means "let the designers decide". */
export function DesignGrid({
  designs,
  selected,
  onPick,
  allowNone,
}: {
  designs: DesignMeta[];
  selected?: string | null;
  onPick: (d: DesignMeta | null) => void;
  allowNone?: boolean;
}) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const tags = useMemo(() => [...new Set(designs.flatMap((d) => d.tags))].sort(), [designs]);
  const term = q.trim().toLowerCase();
  const shown = designs.filter(
    (d) =>
      (!tag || d.tags.includes(tag)) &&
      (!term || [d.name, d.description, ...d.tags, ...d.bestFor].some((s) => s.toLowerCase().includes(term))),
  );

  return (
    <div className="gallery">
      <div className="gallery-bar">
        <div className="ctx-query">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search styles: restaurant, dark, playful, serif…" aria-label="Search designs" />
        </div>
        <div className="tagline">
          <button className={!tag ? "on" : ""} onClick={() => setTag(null)}>
            All
          </button>
          {tags.map((t) => (
            <button key={t} className={tag === t ? "on" : ""} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="design-grid">
        {allowNone && !term && !tag && (
          <button className={`design-card none ${!selected ? "on" : ""}`} onClick={() => onPick(null)}>
            <div className="thumb blank">
              <Sparkles size={22} />
            </div>
            <div className="design-info">
              <b>Let the designers decide</b>
              <span>The design team creates a style for this project.</span>
            </div>
          </button>
        )}
        {shown.map((d) => (
          <button key={d.id} className={`design-card ${selected === d.id ? "on" : ""}`} onClick={() => onPick(d)}>
            <DesignThumb id={d.id} name={d.name} />
            <div className="design-info">
              <b>
                {d.name}
                {selected === d.id && <Check size={14} />}
              </b>
              <span>{d.bestFor.slice(0, 3).join(" · ")}</span>
              <span className="swatches">
                {[d.colors.bg, d.colors.surface, d.colors.text, d.colors.primary, d.colors.accent].map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
            </div>
          </button>
        ))}
        {shown.length === 0 && <p className="muted empty-line">No design matches.</p>}
      </div>
    </div>
  );
}

export function DesignPicker({ selected, onPick, onClose }: { selected: string | null; onPick: (d: DesignMeta | null) => void; onClose: () => void }) {
  const designs = useDesigns();
  return (
    <Modal title="Choose a style" onClose={onClose} wide>
      {!designs ? (
        <p className="muted">Loading the library…</p>
      ) : (
        <DesignGrid
          designs={designs}
          selected={selected}
          allowNone
          onPick={(d) => {
            onPick(d);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
