"use client";

import { FileUp, Link2, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";

import { Chip, cx, Input, Label, Select, Textarea } from "@/components/ui";
import { uploadFile } from "@/lib/api";
import type { FalField } from "@/lib/types";

const ACCEPT = { image: "image/*", video: "video/*", audio: "audio/*", any: "image/*,video/*,audio/*" };

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className={cx("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-accent" : "bg-white/10")}>
      <span className={cx("absolute top-0.5 size-5 rounded-full shadow transition-all", on ? "left-[22px] bg-black" : "left-0.5 bg-white")} />
    </button>
  );
}

function Preview({ url, kind }: { url: string; kind: string }) {
  const k = kind === "any" ? (/\.(mp4|webm|mov)/i.test(url) ? "video" : /\.(mp3|wav|m4a|ogg)/i.test(url) ? "audio" : "image") : kind;
  if (k === "video") return <video src={url} muted playsInline loop autoPlay className="size-full object-cover" />;
  if (k === "audio") return <audio src={url} controls className="w-full px-2" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-full object-cover" />;
}

function FileDrop({ value, accept, onChange }: { value: string; accept: FalField["accept"]; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState(false);
  const kind = accept ?? "any";

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange((await uploadFile(file)).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (value)
    return (
      <div className="group relative grid h-36 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30">
        <Preview url={value} kind={kind} />
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/70 text-white/80 backdrop-blur hover:text-bad"
        >
          <X className="size-4" />
        </button>
      </div>
    );

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files[0]);
        }}
        className={cx(
          "flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed text-sm transition",
          drag ? "border-accent bg-accent/[0.07] text-accent" : "border-white/15 text-mute hover:border-white/30 hover:text-ink",
        )}
      >
        {busy ? <Loader2 className="size-5 animate-spin text-accent" /> : <FileUp className="size-5" />}
        {busy ? "Uploading…" : `Drop or click to upload ${kind === "any" ? "a file" : `an ${kind}`}`}
      </button>
      <input ref={input} type="file" accept={ACCEPT[kind]} className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      {paste ? (
        <Input autoFocus placeholder="https://…" onBlur={(e) => e.target.value && onChange(e.target.value.trim())} />
      ) : (
        <button type="button" onClick={() => setPaste(true)} className="flex items-center gap-1 text-xs text-mute hover:text-ink">
          <Link2 className="size-3" /> or paste a URL
        </button>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <Textarea
        rows={3}
        value={text}
        placeholder="JSON"
        className={cx("font-mono text-xs", bad && "border-bad/60")}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setBad(false);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <p className="mt-1 text-xs text-bad">Not valid JSON yet.</p>}
    </>
  );
}

export function FieldInput({ field, value, onChange }: { field: FalField; value: unknown; onChange: (v: unknown) => void }) {
  const hint = field.required ? "required" : undefined;
  const label = (
    <span title={field.description}>
      {field.title}
    </span>
  );

  if (field.type === "boolean")
    return (
      <label className="flex items-center justify-between gap-4" title={field.description}>
        <span className="text-sm">{field.title}</span>
        <Toggle on={Boolean(value)} onChange={onChange} />
      </label>
    );

  let control;
  switch (field.type) {
    case "text":
      control = (
        <Textarea
          rows={field.name === "prompt" ? 5 : 2}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.description.slice(0, 120)}
          className={field.name === "prompt" ? "text-base" : undefined}
        />
      );
      break;
    case "enum": {
      const opts = field.options ?? [];
      const short = opts.length <= 7 && opts.every((o) => String(o).length <= 14);
      control = short ? (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => (
            <Chip key={String(o)} active={String(value) === String(o)} onClick={() => onChange(o)}>
              {String(o)}
            </Chip>
          ))}
        </div>
      ) : (
        <Select value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(opts.find((o) => String(o) === e.target.value) ?? e.target.value)}>
          {!field.required && <option value="">Default</option>}
          {opts.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o).replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      );
      break;
    }
    case "integer":
    case "number": {
      const step = field.type === "integer" ? 1 : field.max !== null && field.max !== undefined && field.max <= 1 ? 0.01 : 0.1;
      const ranged = field.min !== null && field.min !== undefined && field.max !== null && field.max !== undefined && field.max - field.min <= 200;
      const num = (raw: string) => (raw === "" ? undefined : field.type === "integer" ? parseInt(raw, 10) : parseFloat(raw));
      control = ranged ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={field.min!}
            max={field.max!}
            step={step}
            value={Number(value ?? field.min)}
            onChange={(e) => onChange(num(e.target.value))}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <Input type="number" step={step} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(num(e.target.value))} className="w-20 py-1.5 text-center" />
        </div>
      ) : (
        <Input type="number" step={step} min={field.min ?? undefined} max={field.max ?? undefined} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(num(e.target.value))} placeholder={field.name === "seed" ? "random" : undefined} />
      );
      break;
    }
    case "file":
      control = <FileDrop value={String(value ?? "")} accept={field.accept} onChange={(v) => onChange(v || undefined)} />;
      break;
    case "files": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      const max = field.maxItems ?? 8;
      control = (
        <div className="grid grid-cols-2 gap-2">
          {list.map((url, i) => (
            <FileDrop key={url} value={url} accept={field.accept} onChange={(v) => onChange(v ? list.map((x, j) => (j === i ? v : x)) : list.filter((_, j) => j !== i))} />
          ))}
          {list.length < max && <FileDrop key={list.length} value="" accept={field.accept} onChange={(v) => v && onChange([...list, v])} />}
        </div>
      );
      break;
    }
    case "json":
      control = <JsonField value={value} onChange={onChange} />;
      break;
    default:
      control = <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div>
      <Label hint={hint}>{label}</Label>
      {control}
    </div>
  );
}
