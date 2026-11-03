export type Role = "owner" | "admin" | "creator" | "viewer";
export type Tier = "lite" | "standard" | "premium";
export type AspectRatio = "9:16" | "16:9" | "1:1";
export type StylePreset =
  | "animated_3d"
  | "cartoon"
  | "anime_2d"
  | "anime_action"
  | "cinematic"
  | "storybook"
  | "comic"
  | "documentary"
  | "custom";

export interface OrgRef {
  id: number;
  name: string;
  role: Role;
}

export interface Me {
  user: { id: number; email: string; name: string };
  organizations: OrgRef[];
  activeOrganization: OrgRef | null;
}

export interface CreativeBrief {
  stylePreset: StylePreset;
  customStyle?: string | null;
  idea: string;
  genre: string;
  aspectRatio: AspectRatio;
  targetSeconds: number;
  language: string;
  narration: boolean;
  voiceId?: string | null;
  musicMood?: string | null;
}

export interface Brief extends CreativeBrief {
  id: number;
  projectId: number;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  brief: CreativeBrief | null;
  createdAt: string;
}

export interface Character {
  name: string;
  role: string;
  visualDescription: string;
}

export interface Story {
  id: number;
  projectId: number;
  briefId: number;
  version: number;
  title: string;
  logline: string;
  hook: string;
  script: string;
  characters: Character[];
  estimatedSeconds: number;
  status: "draft" | "approved";
  source: string;
  createdAt: string;
}

export type VideoStatus =
  | "queued"
  | "planning"
  | "references"
  | "keyframes"
  | "clips"
  | "voice"
  | "assembling"
  | "ready"
  | "failed";

export interface Scene {
  id: number;
  idx: number;
  narration: string;
  captionText: string;
  durationMs: number;
  shot: string;
  camera: string;
  characters: string[];
  imagePrompt: string;
  motionPrompt: string;
  keyframeUrl: string;
  clipUrl: string;
  audioUrl: string;
  status: string;
}

export interface Video {
  id: number;
  projectId: number;
  storyId: number;
  storyVersion: number;
  title: string;
  tier: Tier;
  aspectRatio: AspectRatio;
  stylePreset: StylePreset;
  status: VideoStatus;
  progress: number;
  outputUrl: string;
  thumbnailUrl: string;
  durationMs: number;
  voiceId: string;
  musicMood: string;
  captions: boolean;
  costUsd: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  scenes?: Scene[];
  references?: { characters?: Record<string, { url: string; remote: string }> };
}

export interface ProjectSummary {
  id: number;
  title: string;
  stylePreset: string;
  createdAt: string;
  updatedAt: string;
  latestVideo: { id: number; status: VideoStatus; thumbnailUrl: string } | null;
}

export interface GenTask {
  id: number;
  projectId: number;
  kind: "director" | "story" | "rewrite";
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  progress: number;
  stages: { id: string; label: string }[];
  partial: Record<string, unknown>;
  result: unknown;
  error: string;
  createdAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  messages: ChatMessage[];
  briefs: Brief[];
  stories: Story[];
  videos: Video[];
  tasks: GenTask[];
}

export interface StylesInfo {
  presets: { id: StylePreset; label: string; guide: string }[];
  genres: string[];
  voices: { id: string; label: string }[];
  musicMoods: string[];
  aspectRatios: AspectRatio[];
  lengths: number[];
  providers: Record<string, string>;
}

export interface Plan {
  name: string;
  monthly_credits: number;
  tiers: Tier[];
  max_seconds: number;
}

export interface Billing {
  plan: string;
  planInfo: Plan;
  creditsBalance: number;
  plans: Record<string, Plan>;
  quotes: {
    story_generate: number;
    video_reassemble: number;
    video_render_per_10s: Record<Tier, number>;
    scene_regenerate_per_10s: Record<Tier, number>;
  };
  providerCostUsd: number;
  usage: {
    id: number;
    action: string;
    credits: number;
    note: string;
    refunded: boolean;
    videoId: number | null;
    storyId: number | null;
    estimatedCostUsd: number;
    createdAt: string;
  }[];
}

export interface SocialAccount {
  id: number;
  platform: "youtube" | "facebook" | "instagram";
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  status: "active" | "needs_reconnect" | "disconnected";
  tokenExpiresAt: string | null;
  scopes: string[];
  createdAt: string;
}

export interface Members {
  members: { id: number; userId: number; email: string; name: string; role: Role }[];
  invitations: { id: number; email: string; role: Role; token: string | null }[];
}

export interface GenCategory {
  id: string;
  label: string;
  output: "video" | "image" | "audio";
}

export interface FalModel {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  tags: string[];
  category: string;
  featured: boolean;
}

export interface FalField {
  name: string;
  title: string;
  description: string;
  type: "text" | "string" | "enum" | "boolean" | "integer" | "number" | "file" | "files" | "json";
  default: unknown;
  required: boolean;
  nullable: boolean;
  advanced: boolean;
  options?: (string | number)[];
  min?: number | null;
  max?: number | null;
  accept?: "image" | "video" | "audio" | "any";
  maxItems?: number | null;
  maxLength?: number | null;
}

export interface FalModelInfo {
  id: string;
  category: string;
  thumbnail: string;
  fields: FalField[];
  price: { unitPrice: number; unit: string; currency: string } | null;
}

export interface GenMedia {
  type: "video" | "image" | "audio";
  url: string;
  remote: string;
}

export interface Generation {
  id: number;
  endpointId: string;
  category: string;
  modelName: string;
  input: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  queuePosition: number | null;
  logs: string[];
  media: GenMedia[];
  costUsd: number;
  credits: number;
  error: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  seconds: number;
  plan: { totalSeconds: number; clipSeconds: number; count: number; done: number } | null;
}
