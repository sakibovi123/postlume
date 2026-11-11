"use client";

import { ArrowUp, Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";

import { GenerationCard, length } from "@/components/generate/GenerationCard";
import { ModelPicker } from "@/components/generate/ModelPicker";
import { Chip, Empty, ErrorText, PageLoading, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { FalField, FalModel, FalModelInfo, Generation } from "@/lib/types";

type Opt = string | number;
const SETTINGS = [
  { name: "duration", label: "Length" },
  { name: "aspect_ratio", label: "Ratio" },
  { name: "resolution", label: "Quality" },
];

function optionsFor(f: FalField): Opt[] {
  if (f.type === "enum") return (f.options ?? []) as Opt[];
  if ((f.type === "integer" || f.type === "number") && f.name === "duration") {
    const lo = f.min ?? 1;
    const hi = f.max ?? 10;
    return [5, 10, 15, 20, 30].filter((d) => d >= lo && d <= hi);
  }
  return [];
}

const LONG = [30, 60, 120, 180, 300, 600];
const isNum = (o: Opt) => /^\d+(\.\d+)?$/.test(String(o));
const fmt = (name: string, o: Opt) => (name === "duration" && isNum(o) ? length(Number(o)) : String(o));

export default function VideoSandbox() {
  const [models, setModels] = useState<FalModel[] | null>(null);
  const [model, setModel] = useState("");
  const [schema, setSchema] = useState<{ id: string; info: FalModelInfo } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [picked, setPicked] = useState<Record<string, Opt>>({ duration: 10 });
  const [gens, setGens] = useState<Generation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.genCategories().then((m) => setModel((cur) => cur || m.bestVideoModel)).catch(setError);
    api.genModels("text-to-video").then(setModels).catch((e) => (setError(e), setModels([])));
    api.generations().then(setGens).catch(setError);
  }, []);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    api
      .genSchema(model)
      .then((info) => !cancelled && setSchema({ id: model, info }))
      .catch((e) => !cancelled && setError(e));
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

  const info = schema?.id === model ? schema.info : null;
  const promptField = info?.fields.find((f) => f.name === "prompt") ?? info?.fields.find((f) => f.type === "text");
  const settings = SETTINGS.flatMap(({ name, label }) => {
    const f = info?.fields.find((x) => x.name === name);
    let options = f ? optionsFor(f) : [];
    if (name === "duration" && options.length) {
      const max = Math.max(...options.filter(isNum).map(Number));
      options = [...options, ...LONG.filter((d) => d > max)];
    }
    if (!f || options.length < 2) return [];
    const want = picked[name];
    const value = options.find((o) => String(o) === String(want)) ?? options.find((o) => String(o) === String(f.default)) ?? options[0];
    return [{ name, label, options, value }];
  });
  const missing = info?.fields.filter((f) => f.required && f.default == null && f !== promptField) ?? [];
  const current = models?.find((m) => m.id === model);
  const unit = info?.price;
  const durationField = info?.fields.find((f) => f.name === "duration");
  const nativeMax = durationField ? Math.max(0, ...optionsFor(durationField).filter(isNum).map(Number)) : 0;
  const seconds = Number(settings.find((s) => s.name === "duration")?.value ?? 5);
  const long = nativeMax > 0 && seconds > nativeMax;
  const shots = long ? Math.ceil(seconds / nativeMax) : 1;
  const clipSeconds = long ? nativeMax : seconds;
  const usd = unit ? (unit.unit.toLowerCase().startsWith("second") ? unit.unitPrice * clipSeconds : unit.unitPrice) * shots : null;

  async function generate() {
    if (!prompt.trim() || !info || !promptField) return;
    setBusy(true);
    setError(null);
    try {
      const input: Record<string, unknown> = { [promptField.name]: prompt.trim() };
      for (const s of settings) if (!(long && s.name === "duration")) input[s.name] = s.value;
      if (long && usd !== null && usd > 3 && !confirm(`This makes ${shots} clips and costs about $${usd.toFixed(2)}. Continue?`)) return;
      const g = await api.generate({
        endpointId: model, modelName: current?.name ?? model, category: "text-to-video", input,
        totalSeconds: long ? seconds : undefined,
      });
      setGens((list) => [g, ...(list ?? [])]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function reuse(g: Generation) {
    setModel(g.endpointId);
    setPrompt(String(g.input.prompt ?? g.input.text ?? ""));
    const next: Record<string, Opt> = {};
    for (const { name } of SETTINGS) if (typeof g.input[name] === "string" || typeof g.input[name] === "number") next[name] = g.input[name] as Opt;
    if (g.plan) next.duration = g.plan.totalSeconds;
    setPicked((p) => ({ ...p, ...next }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(g: Generation) {
    if (!confirm("Delete this video?")) return;
    try {
      await api.deleteGeneration(g.id);
      setGens((list) => list?.filter((x) => x.id !== g.id) ?? null);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="animate-fade-up space-y-2 pt-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Type it. <span className="text-gradient">Watch it.</span>
        </h1>
        <p className="text-sm text-mute">Prompt in, video out — pick any AI video model.</p>
      </div>

      <div className="glass glow relative z-10 animate-fade-up space-y-3 rounded-3xl p-4">
        <div className="max-w-md">
          <ModelPicker models={models} value={model} onChange={setModel} />
        </div>
        <textarea
          autoFocus
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && generate()}
          placeholder="Describe the video: characters, action, camera, style, sound…"
          className="w-full resize-none bg-transparent px-2 py-1 text-base leading-relaxed outline-none placeholder:text-mute/60"
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-white/[0.06] pt-3">
          {!info && model && <span className="skeleton h-7 w-64 rounded-full" />}
          {settings.map((s) => (
            <div key={s.name} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-mute">{s.label}</span>
              {s.options.map((o) => (
                <Chip key={String(o)} active={o === s.value} onClick={() => setPicked((p) => ({ ...p, [s.name]: o }))}>
                  {fmt(s.name, o)}
                </Chip>
              ))}
            </div>
          ))}
          <div className="ml-auto flex items-center gap-3">
            {usd !== null && (
              <span className="text-xs text-mute">
                {long && <>{shots} shots · </>}≈ ${usd.toFixed(2)}
              </span>
            )}
            <button
              onClick={generate}
              disabled={busy || !prompt.trim() || !info || !promptField}
              className="accent-gradient flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? <Spinner className="size-4" /> : <ArrowUp className="size-4" strokeWidth={2.5} />} Generate
            </button>
          </div>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-warn">This model also needs {missing.map((f) => f.title.toLowerCase()).join(", ")} — use All models for full settings.</p>
        )}
      </div>
      <ErrorText error={error} />

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Clapperboard className="size-5 text-accent" /> Your videos
        </h2>
        {!gens ? (
          <PageLoading />
        ) : gens.length === 0 ? (
          <Empty title="No videos yet">Write a prompt above and hit Generate.</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {gens.map((g) => (
              <GenerationCard key={g.id} gen={g} onReuse={reuse} onDelete={remove} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
