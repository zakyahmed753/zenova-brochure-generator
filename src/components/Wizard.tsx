"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { fileToResizedDataUrl } from "@/lib/image";
import { buildBrochureHtml } from "@/lib/brochure-template";
import { BRAND_KEY, DRAFT_KEY, defaultOptions, emptyBrand } from "@/lib/defaults";
import type { AssistantDraft } from "@/lib/assistant/core";
import AssistantPanel from "@/components/AssistantPanel";
import type { Brand, BrochureRequest, Feature, Options } from "@/lib/types";

type PhotoItem = { id: string; dataUrl: string; caption: string; name: string };
type PageItem = { id: string; heading: string; body: string; photoIds: string[] };
type ListingItem = {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  address: string;
  propertyType: string;
  features: Feature[];
  highlights: string[];
  photos: PhotoItem[];
  pages: PageItem[];
};
type CoverDraft = { title: string; subtitle: string; photoDataUrl: string };

const emptyCover: CoverDraft = { title: "", subtitle: "", photoDataUrl: "" };

const STEPS = ["Cover & brand", "Listings", "Generate"] as const;

function makeListing(): ListingItem {
  return {
    id: crypto.randomUUID(),
    title: "",
    subtitle: "",
    price: "",
    address: "",
    propertyType: "",
    features: [
      { label: "Bedrooms", value: "" },
      { label: "Bathrooms", value: "" },
      { label: "Area", value: "" },
      { label: "Parking", value: "" },
    ],
    highlights: [""],
    photos: [],
    pages: [{ id: crypto.randomUUID(), heading: "Overview", body: "", photoIds: [] }],
  };
}

// Drafts store text only (no image data), so any restored listing comes back
// with an empty photo pool — and page photo assignments reference photos that
// no longer exist, so they're cleared too.
function hydrateListing(raw: unknown): ListingItem {
  const base = makeListing();
  const r = (raw ?? {}) as Partial<ListingItem>;
  return {
    ...base,
    id: typeof r.id === "string" ? r.id : base.id,
    title: typeof r.title === "string" ? r.title : "",
    subtitle: typeof r.subtitle === "string" ? r.subtitle : "",
    price: typeof r.price === "string" ? r.price : "",
    address: typeof r.address === "string" ? r.address : "",
    propertyType: typeof r.propertyType === "string" ? r.propertyType : "",
    features:
      Array.isArray(r.features) && r.features.length ? (r.features as Feature[]) : base.features,
    highlights:
      Array.isArray(r.highlights) && r.highlights.length ? (r.highlights as string[]) : base.highlights,
    photos: [],
    pages:
      Array.isArray(r.pages) && r.pages.length
        ? (r.pages as PageItem[]).map((p) => ({
            id: typeof p?.id === "string" ? p.id : crypto.randomUUID(),
            heading: typeof p?.heading === "string" ? p.heading : "",
            body: typeof p?.body === "string" ? p.body : "",
            photoIds: [],
          }))
        : base.pages,
  };
}

// Approximate on-screen pixel size of one page at 96dpi, for scaling the preview.
const PAGE_PX = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
};

/** Build the exact request the API expects — shared by the preview and Generate. */
function buildPayload(
  brand: Brand,
  cover: CoverDraft,
  listings: ListingItem[],
  options: Options,
  fallbackName: string,
): BrochureRequest {
  return {
    brand,
    cover: {
      title: cover.title.trim(),
      subtitle: cover.subtitle.trim(),
      ...(cover.photoDataUrl ? { photo: { dataUrl: cover.photoDataUrl, caption: "" } } : {}),
    },
    listings: listings.map((l) => ({
      title: l.title.trim(),
      subtitle: l.subtitle.trim(),
      price: l.price.trim(),
      address: l.address.trim(),
      propertyType: l.propertyType.trim(),
      features: l.features
        .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
        .filter((f) => f.value),
      highlights: l.highlights.map((h) => h.trim()).filter(Boolean),
      pages: l.pages
        .map((pg) => ({
          heading: pg.heading.trim(),
          body: pg.body.trim(),
          photos: pg.photoIds
            .map((pid) => l.photos.find((p) => p.id === pid))
            .filter((p): p is PhotoItem => Boolean(p))
            .map((p) => ({ dataUrl: p.dataUrl, caption: p.caption.trim() })),
        }))
        .filter((pg) => pg.heading || pg.body || pg.photos.length),
    })),
    options: { ...options, fileName: options.fileName.trim() || fallbackName },
  };
}

type ListingOps = {
  addListing: () => void;
  removeListing: (id: string) => void;
  updateListing: (id: string, fn: (l: ListingItem) => ListingItem) => void;
  addPhotos: (id: string, files: FileList | File[] | null, assignToPageId?: string) => void;
  removePhoto: (id: string, photoId: string) => void;
  setPhotoCaption: (id: string, photoId: string, caption: string) => void;
  addPage: (id: string) => void;
  removePage: (id: string, pageId: string) => void;
  movePage: (id: string, index: number, dir: -1 | 1) => void;
  setPageField: (id: string, pageId: string, patch: Partial<PageItem>) => void;
  togglePagePhoto: (id: string, pageId: string, photoId: string) => void;
};

export default function Wizard({ initialDraft }: { initialDraft?: AssistantDraft | null }) {
  const [step, setStep] = useState(0);
  const [brand, setBrand] = useState<Brand>(emptyBrand);
  const [cover, setCover] = useState<CoverDraft>(emptyCover);
  const [options, setOptions] = useState<Options>(defaultOptions);
  const [listings, setListings] = useState<ListingItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [brandDefault, setBrandDefault] = useState<Brand | null>(null);
  const [brandNotice, setBrandNotice] = useState<string | null>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistNotice, setAssistNotice] = useState<string | null>(null);
  const loaded = useRef(false);
  const draftApplied = useRef(false);
  const hasBrandDefault = brandDefault !== null;

  // Map an AI draft onto wizard state. Brand identity is left alone; only the
  // company name is filled when it's still blank.
  function applyDraft(draft: AssistantDraft) {
    if (draft.companyName) {
      setBrand((b) => (b.companyName.trim() ? b : { ...b, companyName: draft.companyName!.trim() }));
    }
    if (draft.coverTitle || draft.coverSubtitle) {
      setCover((c) => ({
        ...c,
        title: draft.coverTitle?.trim() || c.title,
        subtitle: draft.coverSubtitle?.trim() || c.subtitle,
      }));
    }
    setOptions((o) => ({
      ...o,
      template: draft.template ?? o.template,
      pageSize: draft.pageSize ?? o.pageSize,
    }));

    const mapped: ListingItem[] = draft.listings.map((dl) => {
      const base = makeListing();
      return {
        ...base,
        title: (dl.title || "").trim(),
        subtitle: (dl.subtitle || "").trim(),
        price: (dl.price || "").trim(),
        address: (dl.address || "").trim(),
        propertyType: (dl.propertyType || "").trim(),
        features:
          dl.features && dl.features.length
            ? dl.features.map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
            : base.features,
        highlights:
          dl.highlights && dl.highlights.length
            ? dl.highlights.map((h) => h.trim()).filter(Boolean)
            : base.highlights,
        pages:
          dl.pages && dl.pages.length
            ? dl.pages
                .map((p) => ({
                  id: crypto.randomUUID(),
                  heading: (p.heading || "").trim(),
                  body: (p.body || "").trim(),
                  photoIds: [] as string[],
                }))
                .filter((p) => p.heading || p.body)
            : base.pages,
      };
    });
    const withPages = mapped.map((l) =>
      l.pages.length ? l : { ...l, pages: makeListing().pages },
    );

    setListings(withPages);
    setActiveId(withPages[0].id);
    setStep(1);
    setAssistOpen(false);
    setAssistNotice(
      `Draft added — ${withPages.length} propert${withPages.length === 1 ? "y" : "ies"}. Review and edit below, then continue.`,
    );
  }

  // Restore text draft (never photos — too large for localStorage). The saved
  // brand default seeds Step 1 whenever the draft has no brand of its own.
  // One-time hydration from localStorage — can't run during render under SSR.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let savedBrand: Brand | null = null;
    try {
      const rawBrand = localStorage.getItem(BRAND_KEY);
      if (rawBrand) savedBrand = { ...emptyBrand, ...JSON.parse(rawBrand) };
    } catch {
      /* ignore corrupt brand default */
    }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const d = raw ? JSON.parse(raw) : null;
      if (d?.brand) setBrand({ ...emptyBrand, ...d.brand });
      else if (savedBrand) setBrand(savedBrand);
      if (d?.cover) setCover({ ...emptyCover, ...d.cover, photoDataUrl: "" });
      if (d?.options) setOptions({ ...defaultOptions, ...d.options });
      const restored =
        Array.isArray(d?.listings) && d.listings.length
          ? d.listings.map(hydrateListing)
          : [makeListing()];
      setListings(restored);
      setActiveId(restored[0].id);
    } catch {
      const l = makeListing();
      setListings([l]);
      setActiveId(l.id);
    }
    setBrandDefault(savedBrand);
    loaded.current = true;
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Apply a one-shot AI draft handed in from the landing page (once).
  useEffect(() => {
    if (!loaded.current || draftApplied.current || !initialDraft) return;
    draftApplied.current = true;
    applyDraft(initialDraft);
  }, [initialDraft, listings]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      const slim = listings.map((l) => ({
        ...l,
        photos: [],
        pages: l.pages.map((p) => ({ id: p.id, heading: p.heading, body: p.body, photoIds: [] })),
      }));
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          brand,
          cover: { ...cover, photoDataUrl: "" },
          // Watermark image can be large — keep it out of the text draft, like photos.
          options: { ...options, watermark: { ...options.watermark, imageDataUrl: "" } },
          listings: slim,
        }),
      );
    } catch {
      /* quota / private mode — non-fatal */
    }
  }, [brand, cover, options, listings]);

  function saveBrandDefault() {
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
      setBrandDefault(brand);
      setBrandNotice("Saved — new brochures will start with these brand details.");
    } catch {
      setBrandNotice("Couldn't save (storage full or private mode).");
    }
  }

  function resetBrandToDefault() {
    if (!brandDefault) return;
    setBrand(brandDefault);
    setBrandNotice("Brand details restored from your saved default.");
  }

  function forgetBrandDefault() {
    try {
      localStorage.removeItem(BRAND_KEY);
    } catch {
      /* non-fatal */
    }
    setBrandDefault(null);
    setBrandNotice("Saved brand default removed.");
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file, {
        maxEdge: 600,
        quality: 0.9,
        format: "auto",
        maxBytes: 1_500_000,
      });
      setBrand((b) => ({ ...b, logoDataUrl: dataUrl }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read logo image");
    }
  }

  async function onCoverPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file, { maxEdge: 2000, format: "jpeg" });
      setCover((c) => ({ ...c, photoDataUrl: dataUrl }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read cover image");
    }
  }

  async function onWatermarkImage(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file, {
        maxEdge: 800,
        quality: 0.9,
        format: "auto",
        maxBytes: 1_500_000,
      });
      setOptions((o) => ({ ...o, watermark: { ...o.watermark, imageDataUrl: dataUrl } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read watermark image");
    }
  }

  function updateListing(id: string, fn: (l: ListingItem) => ListingItem) {
    setListings((ls) => ls.map((l) => (l.id === id ? fn(l) : l)));
  }

  function addListing() {
    const l = makeListing();
    setListings((ls) => [...ls, l]);
    setActiveId(l.id);
  }

  function removeListing(id: string) {
    if (listings.length <= 1) return;
    const idx = listings.findIndex((l) => l.id === id);
    const next = listings.filter((l) => l.id !== id);
    setListings(next);
    if (activeId === id) setActiveId(next[Math.max(0, idx - 1)].id);
  }

  async function addPhotos(
    listingId: string,
    files: FileList | File[] | null,
    assignToPageId?: string,
  ) {
    if (!files?.length) return;
    setError(null);
    const incoming: PhotoItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        setError(`${file.name || "That file"} isn't an image`);
        continue;
      }
      try {
        const dataUrl = await fileToResizedDataUrl(file, { maxEdge: 1600, format: "jpeg" });
        incoming.push({ id: crypto.randomUUID(), dataUrl, caption: "", name: file.name });
      } catch (e) {
        setError(
          e instanceof Error ? `${file.name}: ${e.message}` : `Could not read ${file.name}`,
        );
      }
    }
    if (!incoming.length) return;
    updateListing(listingId, (l) => {
      const photos = [...l.photos, ...incoming].slice(0, 60);
      const kept = new Set(photos.map((p) => p.id));
      const newIds = incoming.map((p) => p.id).filter((id) => kept.has(id));
      // New photos are shown right away: put them on the chosen page, or page 1.
      const targetIdx = assignToPageId
        ? Math.max(0, l.pages.findIndex((pg) => pg.id === assignToPageId))
        : 0;
      const pages = l.pages.map((pg, i) =>
        i === targetIdx ? { ...pg, photoIds: [...pg.photoIds, ...newIds] } : pg,
      );
      return { ...l, photos, pages };
    });
  }

  function removePhoto(listingId: string, photoId: string) {
    updateListing(listingId, (l) => ({
      ...l,
      photos: l.photos.filter((p) => p.id !== photoId),
      pages: l.pages.map((pg) => ({ ...pg, photoIds: pg.photoIds.filter((x) => x !== photoId) })),
    }));
  }

  function setPhotoCaption(listingId: string, photoId: string, caption: string) {
    updateListing(listingId, (l) => ({
      ...l,
      photos: l.photos.map((p) => (p.id === photoId ? { ...p, caption } : p)),
    }));
  }

  function addPage(listingId: string) {
    updateListing(listingId, (l) => ({
      ...l,
      pages: [...l.pages, { id: crypto.randomUUID(), heading: "", body: "", photoIds: [] }].slice(0, 20),
    }));
  }

  function removePage(listingId: string, pageId: string) {
    updateListing(listingId, (l) =>
      l.pages.length <= 1 ? l : { ...l, pages: l.pages.filter((p) => p.id !== pageId) },
    );
  }

  function movePage(listingId: string, index: number, dir: -1 | 1) {
    updateListing(listingId, (l) => {
      const next = [...l.pages];
      const j = index + dir;
      if (j < 0 || j >= next.length) return l;
      [next[index], next[j]] = [next[j], next[index]];
      return { ...l, pages: next };
    });
  }

  function setPageField(listingId: string, pageId: string, patch: Partial<PageItem>) {
    updateListing(listingId, (l) => ({
      ...l,
      pages: l.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
    }));
  }

  function togglePagePhoto(listingId: string, pageId: string, photoId: string) {
    updateListing(listingId, (l) => ({
      ...l,
      pages: l.pages.map((p) =>
        p.id !== pageId
          ? p
          : {
              ...p,
              photoIds: p.photoIds.includes(photoId)
                ? p.photoIds.filter((x) => x !== photoId)
                : [...p.photoIds, photoId],
            },
      ),
    }));
  }

  const ops: ListingOps = {
    addListing,
    removeListing,
    updateListing,
    addPhotos,
    removePhoto,
    setPhotoCaption,
    addPage,
    removePage,
    movePage,
    setPageField,
    togglePagePhoto,
  };

  const firstTitle = listings[0]?.title.trim() ?? "";
  const listingsValid =
    listings.length > 0 &&
    listings.every(
      (l) =>
        l.title.trim().length > 0 &&
        l.pages.length > 0 &&
        l.pages.every((p) => p.heading.trim() || p.body.trim() || p.photoIds.length > 0),
    );

  const canContinue = [
    brand.companyName.trim().length > 0,
    listingsValid,
    (options.fileName.trim() || firstTitle).length > 0,
  ];

  // Live preview — same template the PDF uses, rebuilt (debounced) as you type.
  const previewPayload = useMemo(
    () => buildPayload(brand, cover, listings, options, firstTitle || "brochure"),
    [brand, cover, listings, options, firstTitle],
  );
  const [previewHtml, setPreviewHtml] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setPreviewHtml(buildBrochureHtml(previewPayload));
      } catch {
        /* mid-edit state that doesn't render — keep the last good preview */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [previewPayload]);
  const previewPageCount =
    2 + previewPayload.listings.reduce((n, l) => n + l.pages.length, 0);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload(brand, cover, listings, options, firstTitle);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "brochure.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Zenova Brochure Generator</h1>
        <p className="mt-1 text-sm text-neutral-500">
          One brand, any number of properties — a print-ready portfolio PDF out.
        </p>
      </header>

      <div className="mb-6">
        {assistOpen ? (
          <AssistantPanel
            ctaLabel="Fill the wizard"
            onDraft={(draft) => applyDraft(draft)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAssistOpen(true)}
            className="w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-neutral-400"
          >
            ✨ Describe the properties and let free local AI fill this in
          </button>
        )}
        {assistNotice && (
          <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {assistNotice}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside
          className={`${
            previewOpen ? "block" : "hidden"
          } lg:sticky lg:top-6 lg:block lg:w-[380px] lg:shrink-0`}
        >
          <BrochurePreview
            html={previewHtml}
            pageSize={options.pageSize}
            pageCount={previewPageCount}
          />
        </aside>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setPreviewOpen((o) => !o)}
            className="mb-4 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-600 lg:hidden"
          >
            {previewOpen ? "Hide preview" : "Show live preview"}
          </button>

          <ol className="mb-8 flex gap-2 text-sm">
            {STEPS.map((label, i) => (
              <li key={label} className="flex-1">
                <button
                  onClick={() => setStep(i)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    i === step
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
                  }`}
                >
                  <span className="opacity-60">{i + 1}.</span> {label}
                </button>
              </li>
            ))}
          </ol>

          <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-6">
            {step === 0 && (
          <BrandStep
            brand={brand}
            setBrand={setBrand}
            onLogo={onLogo}
            cover={cover}
            setCover={setCover}
            onCoverPhoto={onCoverPhoto}
            hasBrandDefault={hasBrandDefault}
            brandNotice={brandNotice}
            onSaveDefault={saveBrandDefault}
            onResetDefault={resetBrandToDefault}
            onForgetDefault={forgetBrandDefault}
          />
        )}
        {step === 1 && (
          <ListingsStep
            listings={listings}
            activeId={activeId}
            setActiveId={setActiveId}
            ops={ops}
          />
        )}
        {step === 2 && (
          <GenerateStep
            onWatermarkImage={onWatermarkImage}
            options={options}
            setOptions={setOptions}
            fallbackName={firstTitle}
            listingCount={listings.length}
            totalPages={previewPageCount}
          />
        )}
          </div>

          {error && (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="rounded-md px-4 py-2 text-sm text-neutral-600 disabled:opacity-40"
            >
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canContinue[step]}
                className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={generate}
                disabled={busy || !canContinue.every(Boolean)}
                className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "Generating…" : "Generate PDF"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BrochurePreview({
  html,
  pageSize,
  pageCount,
}: {
  html: string;
  pageSize: Options["pageSize"];
  pageCount: number;
}) {
  // Fluid: fit the parent column, never exceed 356px (the comfortable desktop size).
  const boxRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(320);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = (w: number) => setPreviewW(Math.max(200, Math.min(356, Math.floor(w))));
    apply(el.clientWidth - 16); // minus the p-2 padding on both sides
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dims = PAGE_PX[pageSize];
  const scale = previewW / dims.w;
  const totalH = dims.h * pageCount;

  return (
    <div ref={boxRef} className="rounded-lg border border-neutral-200 bg-neutral-100 p-2">
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-neutral-500">
        <span className="font-medium text-neutral-600">Live preview</span>
        <span>
          {pageCount} page{pageCount === 1 ? "" : "s"} · {pageSize}
        </span>
      </div>
      <div
        className="overflow-y-auto rounded bg-white shadow-inner"
        style={{ width: previewW, maxHeight: "calc(100vh - 9rem)" }}
      >
        <div
          style={{
            position: "relative",
            width: previewW,
            height: Math.max(totalH * scale, 120),
            overflow: "hidden",
          }}
        >
          {html ? (
            <iframe
              title="Brochure preview"
              srcDoc={html}
              tabIndex={-1}
              scrolling="no"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: dims.w,
                height: totalH,
                border: 0,
                background: "#fff",
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                pointerEvents: "none",
              }}
            />
          ) : (
            <div className="p-4 text-xs text-neutral-400">Building preview…</div>
          )}
        </div>
      </div>
      <p className="mt-2 px-1 text-[11px] leading-snug text-neutral-400">
        Approximate — the final PDF is rendered by headless Chrome and may differ
        slightly in font metrics.
      </p>
    </div>
  );
}

/* ---------------- Shared bits ---------------- */

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900";

/* ---------------- Step 1: Cover & brand ---------------- */

function CoverDropzone({
  cover,
  setCover,
  onCoverPhoto,
}: {
  cover: CoverDraft;
  setCover: React.Dispatch<React.SetStateAction<CoverDraft>>;
  onCoverPhoto: (f: File | undefined) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onCoverPhoto(e.dataTransfer.files?.[0]);
      }}
      className={`relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center transition lg:min-h-[440px] ${
        dragging ? "border-neutral-900 bg-neutral-50" : "border-neutral-300 hover:border-neutral-400"
      }`}
    >
      {cover.photoDataUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.photoDataUrl} alt="cover" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-xs text-white">
            <span>Cover photo</span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setCover((c) => ({ ...c, photoDataUrl: "" }));
              }}
              className="rounded bg-white/20 px-2 py-0.5"
            >
              Remove
            </button>
          </div>
        </>
      ) : (
        <div className="px-6 py-8 text-sm text-neutral-500">
          <span className="block text-base font-medium text-neutral-700">Brochure cover photo</span>
          <span className="mt-1 block text-xs">
            Drop an image here, or click to choose. Fills the front page of the PDF — optional, a
            plain branded cover is used if you skip it.
          </span>
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onCoverPhoto(e.target.files?.[0]);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function BrandStep({
  brand,
  setBrand,
  onLogo,
  cover,
  setCover,
  onCoverPhoto,
  hasBrandDefault,
  brandNotice,
  onSaveDefault,
  onResetDefault,
  onForgetDefault,
}: {
  brand: Brand;
  setBrand: React.Dispatch<React.SetStateAction<Brand>>;
  onLogo: (f: File | undefined) => void;
  cover: CoverDraft;
  setCover: React.Dispatch<React.SetStateAction<CoverDraft>>;
  onCoverPhoto: (f: File | undefined) => void;
  hasBrandDefault: boolean;
  brandNotice: string | null;
  onSaveDefault: () => void;
  onResetDefault: () => void;
  onForgetDefault: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <CoverDropzone cover={cover} setCover={setCover} onCoverPhoto={onCoverPhoto} />
        <Field label="Cover title" hint="Defaults to your company name">
          <input
            className={inputCls}
            value={cover.title}
            onChange={(e) => setCover((c) => ({ ...c, title: e.target.value }))}
            placeholder="Autumn Portfolio 2026"
          />
        </Field>
        <Field label="Cover subtitle">
          <input
            className={inputCls}
            value={cover.subtitle}
            onChange={(e) => setCover((c) => ({ ...c, subtitle: e.target.value }))}
            placeholder="Selected homes across New Cairo"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-md bg-neutral-50 px-3 py-2">
        <span className="text-xs text-neutral-500">
          {hasBrandDefault
            ? "Your brand default is applied to new brochures."
            : "Save your logo and details once, reuse them every time."}
        </span>
        <div className="ml-auto flex gap-2 text-xs">
          <button
            type="button"
            onClick={onSaveDefault}
            className="rounded border border-neutral-300 px-2 py-1 font-medium text-neutral-700 hover:border-neutral-400"
          >
            {hasBrandDefault ? "Update default" : "Save as default"}
          </button>
          {hasBrandDefault && (
            <>
              <button
                type="button"
                onClick={onResetDefault}
                className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:border-neutral-400"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onForgetDefault}
                className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:border-neutral-400"
              >
                Forget
              </button>
            </>
          )}
        </div>
        {brandNotice && (
          <span className="sm:col-span-2 basis-full text-xs text-neutral-500">{brandNotice}</span>
        )}
      </div>

      <div className="sm:col-span-2">
        <Field label="Company name">
          <input
            className={inputCls}
            value={brand.companyName}
            onChange={(e) => setBrand((b) => ({ ...b, companyName: e.target.value }))}
            placeholder="Skyline Real Estate"
          />
        </Field>
      </div>

      <Field label="Logo" hint="PNG with transparency looks best">
        <div className="flex items-center gap-3">
          {brand.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoDataUrl}
              alt="logo"
              className="h-12 w-12 rounded border border-neutral-200 object-contain"
            />
          ) : (
            <div className="h-12 w-12 rounded border border-dashed border-neutral-300" />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onLogo(e.target.files?.[0])}
            className="text-xs"
          />
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Primary colour">
          <input
            type="color"
            className="h-10 w-full rounded-md border border-neutral-300"
            value={brand.primaryColor}
            onChange={(e) => setBrand((b) => ({ ...b, primaryColor: e.target.value }))}
          />
        </Field>
        <Field label="Accent colour">
          <input
            type="color"
            className="h-10 w-full rounded-md border border-neutral-300"
            value={brand.accentColor}
            onChange={(e) => setBrand((b) => ({ ...b, accentColor: e.target.value }))}
          />
        </Field>
      </div>

      <Field label="Contact name">
        <input
          className={inputCls}
          value={brand.contactName}
          onChange={(e) => setBrand((b) => ({ ...b, contactName: e.target.value }))}
          placeholder="Jordan Lee"
        />
      </Field>
      <Field label="Phone">
        <input
          className={inputCls}
          value={brand.contactPhone}
          onChange={(e) => setBrand((b) => ({ ...b, contactPhone: e.target.value }))}
        />
      </Field>
      <Field
        label="WhatsApp number"
        hint="For the “Chat on WhatsApp” link at the end of the PDF. Include the country code; falls back to Phone if blank."
      >
        <input
          className={inputCls}
          value={brand.whatsapp}
          onChange={(e) => setBrand((b) => ({ ...b, whatsapp: e.target.value }))}
          placeholder="+20 100 123 4567"
        />
      </Field>
      <Field label="Email">
        <input
          className={inputCls}
          value={brand.contactEmail}
          onChange={(e) => setBrand((b) => ({ ...b, contactEmail: e.target.value }))}
        />
      </Field>
      <Field label="Website">
        <input
          className={inputCls}
          value={brand.website}
          onChange={(e) => setBrand((b) => ({ ...b, website: e.target.value }))}
          placeholder="skyline.example"
        />
      </Field>
      </div>
    </div>
  );
}

/* ---------------- Step 2: Listings ---------------- */

function ListingsStep({
  listings,
  activeId,
  setActiveId,
  ops,
}: {
  listings: ListingItem[];
  activeId: string;
  setActiveId: (id: string) => void;
  ops: ListingOps;
}) {
  const active = listings.find((l) => l.id === activeId) ?? listings[0];
  if (!active) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {listings.map((l, i) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setActiveId(l.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              l.id === active.id
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
            }`}
          >
            {l.title.trim() || `Property ${i + 1}`}
          </button>
        ))}
        <button
          type="button"
          onClick={ops.addListing}
          className="rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm text-neutral-500 hover:border-neutral-400"
        >
          + Add property
        </button>
      </div>

      <ListingEditor
        key={active.id}
        listing={active}
        canRemove={listings.length > 1}
        ops={ops}
      />
    </div>
  );
}

function ListingEditor({
  listing,
  canRemove,
  ops,
}: {
  listing: ListingItem;
  canRemove: boolean;
  ops: ListingOps;
}) {
  const set = (patch: Partial<ListingItem>) =>
    ops.updateListing(listing.id, (l) => ({ ...l, ...patch }));
  const setFeature = (i: number, patch: Partial<Feature>) =>
    ops.updateListing(listing.id, (l) => ({
      ...l,
      features: l.features.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    }));

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-700">Property details</h3>
        {canRemove && (
          <button
            type="button"
            onClick={() => ops.removeListing(listing.id)}
            className="text-xs text-red-600"
          >
            Remove this property
          </button>
        )}
      </div>

      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Headline">
            <input
              className={inputCls}
              value={listing.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Modern 4-Bedroom Villa with Sea View"
            />
          </Field>
          <Field label="Property type" hint="Shown as the section label, e.g. Villa / Apartment / Land">
            <input
              className={inputCls}
              value={listing.propertyType}
              onChange={(e) => set({ propertyType: e.target.value })}
              placeholder="Villa"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Subtitle">
            <input
              className={inputCls}
              value={listing.subtitle}
              onChange={(e) => set({ subtitle: e.target.value })}
              placeholder="Palm Hills, New Cairo"
            />
          </Field>
          <Field label="Price">
            <input
              className={inputCls}
              value={listing.price}
              onChange={(e) => set({ price: e.target.value })}
              placeholder="EGP 12,500,000"
            />
          </Field>
        </div>
        <Field label="Address">
          <input
            className={inputCls}
            value={listing.address}
            onChange={(e) => set({ address: e.target.value })}
          />
        </Field>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Key facts
        </span>
        <p className="mb-2 text-xs text-neutral-400">
          Each row becomes a tile in the PDF — the <strong>value</strong> big on top, the{" "}
          <strong>name</strong> under it (e.g. 4 / Bedrooms).
        </p>

        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Name
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Value
          </span>
          {listing.features.map((f, i) => {
            const unnamed = f.value.trim() && !f.label.trim();
            return (
              <Fragment key={i}>
                <input
                  className={`rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900 ${
                    unnamed ? "border-amber-400 bg-amber-50" : "border-neutral-300"
                  }`}
                  value={f.label}
                  onChange={(e) => setFeature(i, { label: e.target.value })}
                  placeholder="e.g. Bathrooms"
                />
                <input
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  value={f.value}
                  onChange={(e) => setFeature(i, { value: e.target.value })}
                  placeholder="e.g. 3"
                />
                {unnamed && (
                  <p className="col-span-2 -mt-1 text-[11px] text-amber-600">
                    Give this a name, or “{f.value.trim()}” prints with no label.
                  </p>
                )}
              </Fragment>
            );
          })}
        </div>
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            className="text-neutral-600 underline"
            onClick={() =>
              set({ features: [...listing.features, { label: "", value: "" }].slice(0, 12) })
            }
          >
            + add fact
          </button>
          {listing.features.length > 0 && (
            <button
              type="button"
              className="text-neutral-600 underline"
              onClick={() => set({ features: listing.features.slice(0, -1) })}
            >
              − remove last
            </button>
          )}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Highlights
        </span>
        <div className="grid gap-2">
          {listing.highlights.map((h, i) => (
            <input
              key={i}
              className={inputCls}
              value={h}
              onChange={(e) =>
                set({
                  highlights: listing.highlights.map((x, idx) => (idx === i ? e.target.value : x)),
                })
              }
              placeholder="Private garden and pool"
            />
          ))}
        </div>
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            className="text-neutral-600 underline"
            onClick={() => set({ highlights: [...listing.highlights, ""].slice(0, 12) })}
          >
            + add highlight
          </button>
          {listing.highlights.length > 1 && (
            <button
              type="button"
              className="text-neutral-600 underline"
              onClick={() => set({ highlights: listing.highlights.slice(0, -1) })}
            >
              − remove last
            </button>
          )}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Photos
        </span>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500 hover:border-neutral-400">
          <span className="font-medium text-neutral-700">Click to add photos</span>
          <span className="mt-1 text-xs">
            JPG or PNG · they go on page 1 straight away — move them between pages below
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => ops.addPhotos(listing.id, e.target.files)}
          />
        </label>
        {listing.photos.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {listing.photos.map((ph) => (
              <div key={ph.id} className="rounded border border-neutral-200 p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ph.dataUrl}
                  alt={ph.name}
                  className="aspect-[4/3] w-full rounded object-cover"
                />
                <input
                  className="mt-1 w-full rounded border border-neutral-200 px-1.5 py-1 text-[11px] outline-none focus:border-neutral-900"
                  value={ph.caption}
                  onChange={(e) => ops.setPhotoCaption(listing.id, ph.id, e.target.value)}
                  placeholder="Caption"
                />
                <button
                  type="button"
                  onClick={() => ops.removePhoto(listing.id, ph.id)}
                  className="mt-1 text-[11px] text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Pages
          </span>
          <span className="text-xs text-neutral-400">
            Page 1 also carries the headline, price and key facts
          </span>
        </div>
        <div className="grid gap-3">
          {listing.pages.map((page, i) => (
            <PageCard
              key={page.id}
              listing={listing}
              page={page}
              index={i}
              total={listing.pages.length}
              ops={ops}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => ops.addPage(listing.id)}
          className="mt-2 text-xs text-neutral-600 underline"
        >
          + add page
        </button>
      </div>
    </div>
  );
}

function PageCard({
  listing,
  page,
  index,
  total,
  ops,
}: {
  listing: ListingItem;
  page: PageItem;
  index: number;
  total: number;
  ops: ListingOps;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
        <span className="font-medium">Page {index + 1}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => ops.movePage(listing.id, index, -1)}
            disabled={index === 0}
            className="disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => ops.movePage(listing.id, index, 1)}
            disabled={index === total - 1}
            className="disabled:opacity-30"
          >
            ↓
          </button>
          {total > 1 && (
            <button
              type="button"
              onClick={() => ops.removePage(listing.id, page.id)}
              className="text-red-600"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <input
          className={inputCls}
          value={page.heading}
          onChange={(e) => ops.setPageField(listing.id, page.id, { heading: e.target.value })}
          placeholder="Page heading (optional)"
        />
        <textarea
          className={`${inputCls} min-h-20`}
          value={page.body}
          onChange={(e) => ops.setPageField(listing.id, page.id, { body: e.target.value })}
          placeholder="Page text (optional) — description, neighbourhood notes, terms…"
        />
      </div>

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">
            Photos on this page
          </span>
          <label className="cursor-pointer text-[11px] font-medium text-neutral-600 underline hover:text-neutral-900">
            + add photos here
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                ops.addPhotos(listing.id, e.target.files, page.id);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {listing.photos.length === 0 ? (
          <p className="text-xs text-neutral-400">
            No photos yet — use “+ add photos here”, or the Photos box above.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {listing.photos.map((ph) => {
              const pos = page.photoIds.indexOf(ph.id);
              const on = pos >= 0;
              return (
                <button
                  type="button"
                  key={ph.id}
                  onClick={() => ops.togglePagePhoto(listing.id, page.id, ph.id)}
                  className={`relative aspect-square overflow-hidden rounded border ${
                    on
                      ? "border-neutral-900 ring-2 ring-neutral-900"
                      : "border-neutral-200 opacity-60 hover:opacity-100"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.dataUrl} alt={ph.name} className="h-full w-full object-cover" />
                  {on && (
                    <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-medium text-white">
                      {pos + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Step 3: Generate ---------------- */

function GenerateStep({
  onWatermarkImage,
  options,
  setOptions,
  fallbackName,
  listingCount,
  totalPages,
}: {
  onWatermarkImage: (f: File | undefined) => void;
  options: Options;
  setOptions: React.Dispatch<React.SetStateAction<Options>>;
  fallbackName: string;
  listingCount: number;
  totalPages: number;
}) {
  const wm = options.watermark;
  const setWm = (patch: Partial<Options["watermark"]>) =>
    setOptions((o) => ({ ...o, watermark: { ...o.watermark, ...patch } }));
  return (
    <div className="grid gap-5">
      <Field
        label="PDF file name"
        hint={`Saved as "${(options.fileName.trim() || fallbackName || "brochure").replace(/\.pdf$/i, "")}.pdf"`}
      >
        <input
          className={inputCls}
          value={options.fileName}
          onChange={(e) => setOptions((o) => ({ ...o, fileName: e.target.value }))}
          placeholder={fallbackName || "Portfolio-Autumn-2026"}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template">
          <select
            className={inputCls}
            value={options.template}
            onChange={(e) =>
              setOptions((o) => ({ ...o, template: e.target.value as Options["template"] }))
            }
          >
            <option value="editorial">Editorial (serif, magazine style)</option>
            <option value="classic">Classic (traditional)</option>
            <option value="bold">Bold (large sans headlines)</option>
          </select>
        </Field>
        <Field label="Page size">
          <select
            className={inputCls}
            value={options.pageSize}
            onChange={(e) =>
              setOptions((o) => ({ ...o, pageSize: e.target.value as Options["pageSize"] }))
            }
          >
            <option value="A4">A4</option>
            <option value="Letter">US Letter</option>
          </select>
        </Field>
      </div>

      <div className="rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="block text-sm font-medium text-neutral-800">Watermark on every page</span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              One switch — stamps the whole brochure, cover to contact page.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wm.enabled}
            onClick={() => setWm({ enabled: !wm.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
              wm.enabled ? "bg-neutral-900" : "bg-neutral-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                wm.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {wm.enabled && (
          <div className="mt-4 grid gap-4">
            <div className="flex gap-2">
              {(["text", "image"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setWm({ type: t })}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm capitalize ${
                    wm.type === t
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {wm.type === "text" ? (
              <Field label="Watermark text">
                <input
                  className={inputCls}
                  value={wm.text}
                  onChange={(e) => setWm({ text: e.target.value })}
                  placeholder="DRAFT · Skyline Real Estate"
                  maxLength={60}
                />
              </Field>
            ) : (
              <Field label="Watermark image" hint="PNG with transparency works best">
                <div className="flex items-center gap-3">
                  {wm.imageDataUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={wm.imageDataUrl}
                        alt="watermark"
                        className="h-12 w-12 rounded border border-neutral-200 object-contain"
                      />
                      <button
                        type="button"
                        onClick={() => setWm({ imageDataUrl: "" })}
                        className="text-xs text-red-600"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <div className="h-12 w-12 rounded border border-dashed border-neutral-300" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => onWatermarkImage(e.target.files?.[0])}
                    className="text-xs"
                  />
                </div>
              </Field>
            )}

            <Field label={`Opacity — ${Math.round(wm.opacity * 100)}%`}>
              <input
                type="range"
                min={2}
                max={50}
                value={Math.round(wm.opacity * 100)}
                onChange={(e) => setWm({ opacity: Number(e.target.value) / 100 })}
                className="w-full"
              />
            </Field>
          </div>
        )}
      </div>

      <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        {listingCount} propert{listingCount === 1 ? "y" : "ies"} · {totalPages} pages total (cover +
        listing pages + contact)
      </p>
    </div>
  );
}
