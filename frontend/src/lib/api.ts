import type {
  Billing,
  Brief,
  ChatMessage,
  CreativeBrief,
  FalModel,
  FalModelInfo,
  GenCategory,
  Generation,
  GenTask,
  Me,
  Members,
  ProjectDetail,
  ProjectSummary,
  Scene,
  SocialAccount,
  Story,
  StylesInfo,
  Tier,
  Video,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data: unknown,
  ) {
    super(message);
  }
}

const BASE = "/api/v1";
const ORG_KEY = "postlume.orgId";

function cookie(name: string) {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? "";
}

let csrfReady: Promise<unknown> | null = null;
function ensureCsrf() {
  if (cookie("csrftoken")) return Promise.resolve();
  csrfReady ??= fetch(`${BASE}/auth/csrf`, { credentials: "include" });
  return csrfReady;
}

export function getActiveOrg() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_KEY);
}

export function setActiveOrg(id: number | null) {
  if (id === null) window.localStorage.removeItem(ORG_KEY);
  else window.localStorage.setItem(ORG_KEY, String(id));
}

function messageFrom(data: unknown, status: number): { code: string; message: string } {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return { code: String(d.error ?? "error"), message: d.detail };
    const first = Object.entries(d)[0];
    if (first) {
      const [field, value] = first;
      const text = Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : v?.msg ?? JSON.stringify(v))).join(" ") : String(value);
      return { code: "validation", message: field === "non_field_errors" ? text : `${field}: ${text}` };
    }
  }
  return { code: "error", message: `Request failed (${status})` };
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== "GET") await ensureCsrf();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRFToken"] = cookie("csrftoken");
  const org = getActiveOrg();
  if (org) headers["X-Org-Id"] = org;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const { code, message } = messageFrom(data, res.status);
    throw new ApiError(res.status, code, message, data);
  }
  if (method !== "GET") notifyCredits();
  return data as T;
}

export async function uploadFile(file: File): Promise<{ url: string; name: string; contentType: string }> {
  await ensureCsrf();
  const headers: Record<string, string> = { Accept: "application/json", "X-CSRFToken": cookie("csrftoken") };
  const org = getActiveOrg();
  if (org) headers["X-Org-Id"] = org;
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/generate/upload`, { method: "POST", headers, credentials: "include", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const { code, message } = messageFrom(data, res.status);
    throw new ApiError(res.status, code, message, data);
  }
  return data;
}

export function notifyCredits() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("postlume:credits"));
}

export const api = {
  me: () => request<Me>("GET", "/auth/me"),
  login: (email: string, password: string) => request<Me>("POST", "/auth/login", { email, password }),
  signupStatus: () => request<{ enabled: boolean }>("GET", "/auth/signup-status"),
  register: (body: { email: string; password: string; name?: string; organizationName?: string; inviteToken?: string }) =>
    request<Me>("POST", "/auth/register", body),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),

  createOrg: (name: string) => request<Me>("POST", "/orgs", { name }),
  switchOrg: (id: number) => request<Me>("POST", `/orgs/${id}/switch`),
  members: () => request<Members>("GET", "/orgs/current/members"),
  updateMember: (id: number, role: string) => request("PATCH", `/orgs/current/members/${id}`, { role }),
  removeMember: (id: number) => request("DELETE", `/orgs/current/members/${id}`),
  invite: (email: string, role: string) =>
    request<{ id: number; email: string; role: string; token: string }>("POST", "/orgs/current/invitations", { email, role }),
  acceptInvite: (token: string) => request<Me>("POST", `/invitations/${token}/accept`),

  social: () => request<{ accounts: SocialAccount[]; configured: Record<string, boolean> }>("GET", "/social"),
  disconnect: (id: number) => request("DELETE", `/social/${id}`),
  connectUrl: (platform: string) => `${BASE}/social/${platform}/connect`,

  styles: () => request<StylesInfo>("GET", "/styles"),
  projects: () => request<ProjectSummary[]>("GET", "/projects"),
  createProject: (body: { title?: string; stylePreset?: string }) => request<ProjectDetail>("POST", "/projects", body),
  project: (id: number) => request<ProjectDetail>("GET", `/projects/${id}`),
  updateProject: (id: number, body: { title?: string; stylePreset?: string }) => request("PATCH", `/projects/${id}`, body),
  deleteProject: (id: number) => request("DELETE", `/projects/${id}`),
  sendMessage: (id: number, text: string, stylePreset?: string) =>
    request<{ task: GenTask; userMessage: ChatMessage }>("POST", `/projects/${id}/messages`, {
      text,
      stylePreset,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  confirmBrief: (id: number, brief: CreativeBrief) => request<Brief>("POST", `/projects/${id}/brief`, { brief }),
  generateStory: (id: number, briefId?: number) => request<GenTask>("POST", `/projects/${id}/stories`, { briefId }),
  task: (id: number) => request<GenTask>("GET", `/tasks/${id}`),

  updateStory: (id: number, body: Partial<Story> & { status?: "approved" }) => request<Story>("PATCH", `/stories/${id}`, body),
  rewriteStory: (id: number, instruction: string) => request<GenTask>("POST", `/stories/${id}/rewrite`, { instruction }),
  restoreStory: (id: number) => request<Story>("POST", `/stories/${id}/restore`),
  startRender: (id: number, body: { tier: Tier; aspectRatio?: string; voiceId?: string; musicMood?: string; captions?: boolean }) =>
    request<Video>("POST", `/stories/${id}/videos`, body),

  genCategories: () => request<{ categories: GenCategory[]; configured: boolean; usdPerCredit: number; chargeCredits: boolean; bestVideoModel: string }>("GET", "/generate/categories"),
  genModels: (category: string) => request<FalModel[]>("GET", `/generate/models?category=${encodeURIComponent(category)}`),
  genSchema: (endpoint: string) => request<FalModelInfo>("GET", `/generate/schema?endpoint=${encodeURIComponent(endpoint)}`),
  generations: () => request<Generation[]>("GET", "/generations"),
  generate: (body: { endpointId: string; modelName: string; category: string; input: Record<string, unknown>; totalSeconds?: number }) =>
    request<Generation>("POST", "/generations", body),
  deleteGeneration: (id: number) => request("DELETE", `/generations/${id}`),

  videos: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request<Video[]>("GET", `/videos${q ? `?${q}` : ""}`);
  },
  video: (id: number) => request<Video>("GET", `/videos/${id}`),
  updateVideo: (id: number, body: { voiceId?: string; musicMood?: string; captions?: boolean; apply?: boolean }) =>
    request<Video>("PATCH", `/videos/${id}`, body),
  deleteVideo: (id: number) => request("DELETE", `/videos/${id}`),
  retryVideo: (id: number) => request<Video>("POST", `/videos/${id}/retry`),
  reassemble: (id: number) => request<Video>("POST", `/videos/${id}/reassemble`),
  duplicateVideo: (id: number) => request<ProjectDetail>("POST", `/videos/${id}/duplicate`),
  downloadUrl: (id: number) => `${BASE}/videos/${id}/download`,
  updateScene: (videoId: number, sceneId: number, body: Partial<Pick<Scene, "captionText" | "imagePrompt" | "motionPrompt">>) =>
    request<Scene>("PATCH", `/videos/${videoId}/scenes/${sceneId}`, body),
  regenerateScene: (videoId: number, sceneId: number, body: { imagePrompt?: string; motionPrompt?: string; narration?: string }) =>
    request<Video>("POST", `/videos/${videoId}/scenes/${sceneId}/regenerate`, body),

  billing: () => request<Billing>("GET", "/billing"),
  switchPlan: (plan: string) => request<Billing>("PATCH", "/billing", { plan }),
};

export function videoCredits(perTen: Record<Tier, number>, tier: Tier, seconds: number) {
  return Math.max(1, Math.ceil(seconds / 10) * perTen[tier]);
}
