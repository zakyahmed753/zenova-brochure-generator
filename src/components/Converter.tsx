"use client";

import { useState } from "react";

/**
 * Standalone "any file / photos → one PDF" tool, reached from the landing
 * screen. Files are uploaded in the listed order and merged server-side; images
 * become one page each, PDFs are merged as-is, and other documents go through
 * LibreOffice when it's available on the host.
 */

type Item = { id: string; file: File };
type PageSize = "A4" | "Letter";

const MAX_FILES = 40;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const inputCls =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900";

export default function Converter({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>("A4");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setError(null);
    setNotice(null);
    setItems((cur) =>
      [...cur, ...incoming.map((file) => ({ id: crypto.randomUUID(), file }))].slice(0, MAX_FILES),
    );
  }

  function remove(id: string) {
    setItems((cur) => cur.filter((it) => it.id !== id));
  }

  function move(index: number, dir: -1 | 1) {
    setItems((cur) => {
      const next = [...cur];
      const j = index + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  const totalBytes = items.reduce((n, it) => n + it.file.size, 0);

  async function convert() {
    if (!items.length || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      for (const it of items) fd.append("files", it.file, it.file.name);
      fd.append("pageSize", pageSize);
      if (fileName.trim()) fd.append("fileName", fileName.trim());

      const res = await fetch("/api/convert", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `Request failed (${res.status})`);
      }

      const skippedHeader = res.headers.get("X-Convert-Skipped");
      if (skippedHeader) {
        try {
          const skipped = JSON.parse(decodeURIComponent(skippedHeader)) as {
            name: string;
            reason: string;
          }[];
          if (skipped.length) {
            setNotice(
              `Left out ${skipped.length} file${skipped.length === 1 ? "" : "s"}: ` +
                skipped.map((s) => `${s.name} — ${s.reason}`).join("; "),
            );
          }
        } catch {
          /* ignore a malformed header */
        }
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "converted.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-neutral-500 hover:text-neutral-800"
      >
        ← All tools
      </button>

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Files &amp; photos → PDF</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Drop in images, PDFs, Word, Excel or PowerPoint files. They&apos;re merged into one PDF,
          in the order below.
        </p>
      </header>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center text-sm transition ${
          dragging
            ? "border-neutral-900 bg-neutral-50"
            : "border-neutral-300 text-neutral-500 hover:border-neutral-400"
        }`}
      >
        <span className="font-medium text-neutral-700">Click to choose files, or drop them here</span>
        <span className="mt-1 text-xs">Up to {MAX_FILES} files · 40 MB each · 120 MB total</span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {items.length > 0 && (
        <ol className="mt-4 grid gap-2">
          {items.map((it, i) => (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2"
            >
              <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-neutral-800">{it.file.name}</div>
                <div className="text-xs text-neutral-400">
                  {it.file.type || "unknown type"} · {humanSize(it.file.size)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-neutral-500">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="px-1 disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  className="px-1 disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  className="px-1 text-red-600"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            PDF file name
          </span>
          <input
            className={inputCls}
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="converted"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Image page size
          </span>
          <select
            className={inputCls}
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as PageSize)}
          >
            <option value="A4">A4</option>
            <option value="Letter">US Letter</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {notice && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <span className="text-xs text-neutral-400">
          {items.length
            ? `${items.length} file${items.length === 1 ? "" : "s"} · ${humanSize(totalBytes)}`
            : "No files yet"}
        </span>
        <button
          type="button"
          onClick={convert}
          disabled={busy || items.length === 0}
          className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Converting…" : "Convert to PDF"}
        </button>
      </div>
    </div>
  );
}
