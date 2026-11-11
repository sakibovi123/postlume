"use client";

import { AudioLines, ChevronDown, Clapperboard, Film, ImageIcon, Images, Mic, Sparkles, Wand2, Zap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldInput } from "@/components/generate/FieldInput";
import { GenerationCard } from "@/components/generate/GenerationCard";
import { ModelPicker } from "@/components/generate/ModelPicker";
import { useSession } from "@/components/session";
import { Button, cx, Empty, ErrorText, PageLoading } from "@/components/ui";
import { api } from "@/lib/api";
import type { FalField, FalModel, FalModelInfo, GenCategory, Generation } from "@/lib/types";

const ICONS: Record<string, typeof Film> = {
  "text-to-video": Clapperboard,
  "image-to-video": Film,
  "video-to-video": Wand2,
  "text-to-image": ImageIcon,
  "image-to-image": Images,
  "text-to-audio": AudioLines,
  "text-to-speech": Mic,
};

const PREFERRED: Record<string, string[]> = {
  "text-to-video": ["minimax/h3-max/text-to-video", "kling/v4/text-to-video"],
  "image-to-video": ["fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "kling/v4/image-to-video"],
  "text-to-image": ["fal-ai/flux/schnell"],
  "text-to-speech": ["fal-ai/kokoro/american-english"],
};

type Values = Record<string, unknown>;

function defaultsFor(info: FalModelInfo): Values {
  const out: Values = {};
  for (const f of info.fields) if (f.default !== null && f.default !== undefined && f.type !== "json") out[f.name] = f.default;
  return out;
}

function num(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function estimate(info: FalModelInfo, values: Values) {
  const p = info.price;
  if (!p) return null;
  const unit = p.unit.toLowerCase();
  let qty = 1;
  if (unit.startsWith("second")) qty = num(values.duration, 5);
  else if (["video", "image", "request", "generation", "unit", "call"].includes(unit.replace(/s$/, ""))) qty = num(values.num_images ?? values.num_outputs, 1);
  else if (unit.includes("character")) qty = Math.max(1, String(values.prompt ?? values.text ?? "").length) / num(unit, 1);
  else if (unit.includes("megapixel")) qty = num(values.num_images, 1);
  return { usd: p.unitPrice * qty, unitPrice: p.unitPrice, unit: p.unit };
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export default function GenerateStudio() {
  const search = useSearchParams();
  const { can } = useSession();
  const [meta, setMeta] = useState<{ categories: GenCategory[]; configured: boolean; usdPerCredit: number; chargeCredits: boolean } | null>(null);
  const [category, setCategory] = useState(search.get("category") ?? "text-to-video");
  const [models, setModels] = useState<Record<string, FalModel[]>>({});
  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    const m = search.get("model");
    return m ? { [search.get("category") ?? "text-to-video"]: m } : {};
  });
  const [info, setInfo] = useState<{ id: string; data: FalModelInfo | null; error?: unknown } | null>(null);
  const [values, setValues] = useState<{ endpoint: string; data: Values } | null>(null);
  const [gens, setGens] = useState<Generation[] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.genCategories().then(setMeta).catch(setError);
    api.generations().then(setGens).catch(setError);
  }, []);

  useEffect(() => {
    if (models[category]) return;
    api
      .genModels(category)
      .then((list) => setModels((m) => ({ ...m, [category]: list })))
      .catch((e) => {
        setError(e);
        setModels((m) => ({ ...m, [category]: [] }));
      });
  }, [category, models]);

  const list = models[category] ?? null;
  const model = useMemo(() => {
    if (chosen[category]) return chosen[category];
    if (!list?.length) return "";
    return (PREFERRED[category] ?? []).find((id) => list.some((m) => m.id === id)) ?? list[0].id;
  }, [chosen, category, list]);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    api
      .genSchema(model)
      .then((data) => !cancelled && setInfo({ id: model, data }))
      .catch((e) => !cancelled && setInfo({ id: model, data: null, error: e }));
    return () => {
      cancelled = true;
    };
  }, [model]);

  const active = gens?.some((g) => g.status === "queued" || g.status === "running");
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => api.generations().then(setGens).catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [active, gens]);

  const schema = info?.id === model ? info.data : null;
  const schemaError = info?.id === model ? info.error : null;
  const form: Values = schema ? (values?.endpoint === model ? values.data : defaultsFor(schema)) : {};
  const set = (name: string, v: unknown) => setValues({ endpoint: model, data: { ...form, [name]: v } });

  const primary = schema?.fields.filter((f) => !f.advanced) ?? [];
  const advanced = schema?.fields.filter((f) => f.advanced) ?? [];
  const missing = schema?.fields.filter((f) => f.required && isEmpty(form[f.name])) ?? [];
  const cost = schema ? estimate(schema, form) : null;
  const credits = meta && cost ? Math.max(1, Math.ceil(cost.usd / meta.usdPerCredit - 1e-9)) : 1;
  const current = list?.find((m) => m.id === model);

  async function generate() {
    if (!schema) return;
    setBusy(true);
    setError(null);
    try {
      const input = Object.fromEntries(Object.entries(form).filter(([, v]) => !isEmpty(v)));
      const g = await api.generate({ endpointId: model, modelName: current?.name ?? model, category, input });
      setGens((list) => [g, ...(list ?? [])]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function reuse(g: Generation) {
    const cat = g.category && meta?.categories.some((c) => c.id === g.category) ? g.category : category;
    setCategory(cat);
    setChosen((c) => ({ ...c, [cat]: g.endpointId }));
    setValues({ endpoint: g.endpointId, data: g.input });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(g: Generation) {
    if (!confirm("Delete this generation?")) return;
    try {
      await api.deleteGeneration(g.id);
      setGens((list) => list?.filter((x) => x.id !== g.id) ?? null);
    } catch (e) {
      setError(e);
    }
  }

  if (!meta) return error ? <ErrorText error={error} /> : <PageLoading />;

  const renderField = (f: FalField) => <FieldInput key={`${model}:${f.name}`} field={f} value={form[f.name]} onChange={(v) => set(f.name, v)} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="animate-fade-up">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Generate <span className="text-gradient">anything</span>
          </h1>
          <p className="mt-2 text-sm text-mute">Hundreds of AI models for video, images and audio, in one place.</p>
        </div>
      </div>

      {!meta.configured && (
        <p className="rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          AI models aren&apos;t available right now. Please try again later.
        </p>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {meta.categories.map((c) => {
          const Icon = ICONS[c.id] ?? Sparkles;
          return (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={cx(
                "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm transition",
                category === c.id ? "accent-gradient font-semibold" : "border border-white/10 bg-white/[0.03] text-mute hover:text-ink",
              )}
            >
              <Icon className="size-4" /> {c.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[440px_1fr]">
        <aside className="glass space-y-5 self-start rounded-3xl p-5 lg:sticky lg:top-24">
          <ModelPicker models={list} value={model} onChange={(id) => setChosen((c) => ({ ...c, [category]: id }))} />
          {current?.description && <p className="line-clamp-3 text-xs leading-relaxed text-mute">{current.description}</p>}

          {list && list.length === 0 && <Empty title="No models in this category" />}
          {schemaError ? <ErrorText error={schemaError} /> : null}
          {model && !schema && !schemaError && (
            <div className="space-y-3">
              <div className="skeleton h-28 rounded-2xl" />
              <div className="skeleton h-10 rounded-xl" />
              <div className="skeleton h-10 rounded-xl" />
            </div>
          )}

          {schema && (
            <div key={model} className="animate-fade-in space-y-5">
              {primary.map(renderField)}
              {advanced.length > 0 && (
                <div className="rounded-2xl border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm text-mute hover:text-ink"
                  >
                    Advanced settings · {advanced.length}
                    <ChevronDown className={cx("size-4 transition", showAdvanced && "rotate-180")} />
                  </button>
                  {showAdvanced && <div className="animate-fade-in space-y-5 border-t border-white/[0.06] p-4">{advanced.map(renderField)}</div>}
                </div>
              )}
            </div>
          )}

          <ErrorText error={error} />

          {schema && can("creator") && (
            <div className="space-y-2 border-t border-white/[0.06] pt-4">
              <div className="flex items-center justify-between text-xs text-mute">
                <span>
                  {cost ? (
                    <>
                      ≈ <b className="text-ink">${cost.usd.toFixed(cost.usd < 0.1 ? 3 : 2)}</b> · ${cost.unitPrice} per {cost.unit.replace(/s$/, "")}
                    </>
                  ) : (
                    "Price not listed"
                  )}
                </span>
                {missing.length > 0 && <span className="text-warn">Needs {missing.map((f) => f.title.toLowerCase()).join(", ")}</span>}
              </div>
              <Button variant="primary" className="w-full py-3.5 text-base" loading={busy} disabled={missing.length > 0} onClick={generate}>
                <Sparkles className="size-5" /> Generate
                {meta.chargeCredits && (
                  <span className="flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-sm">
                    <Zap className="size-3.5 fill-black" /> {credits}
                  </span>
                )}
              </Button>
            </div>
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Your creations</h2>
            {active && (
              <span className="flex items-center gap-2 text-xs text-accent">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Live
              </span>
            )}
          </div>
          {!gens ? (
            <PageLoading />
          ) : gens.length === 0 ? (
            <Empty title="Nothing generated yet">Pick a model, write a prompt and hit Generate.</Empty>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {gens.map((g) => (
                <GenerationCard key={g.id} gen={g} onReuse={reuse} onDelete={remove} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
