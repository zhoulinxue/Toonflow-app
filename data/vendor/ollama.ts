/**
 * Toonflow AI Vendor - Ollama (Local)
 * @version 2.0
 */

// ============================================================
// Type definitions
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

interface ImageConfig {
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  imageBase64?: string[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// Global declarations
// ============================================================

declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

// ============================================================
// Vendor config
// ============================================================

const vendor: VendorConfig = {
  id: "ollama",
  version: "2.0",
  author: "Toonflow",
  name: "Ollama (Local)",
  description: "Ollama local LLM runtime with OpenAI-compatible API.\n\nDefault: http://localhost:11434/v1\n\nEnsure Ollama is installed and running with models pulled.",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API Key (optional)", type: "password", required: false, placeholder: "Leave empty for local install" },
    { key: "baseUrl", label: "Base URL", type: "url", required: true, placeholder: "http://localhost:11434/v1" },
  ],
  inputValues: {
    apiKey: "ollama",
    baseUrl: "http://localhost:11434/v1",
  },
  models: [
    { name: "Qwen 2.5 (7B)", modelName: "qwen2.5:7b", type: "text", think: false },
    { name: "Qwen 2.5 (14B)", modelName: "qwen2.5:14b", type: "text", think: false },
    { name: "Qwen 2.5 (32B)", modelName: "qwen2.5:32b", type: "text", think: false },
    { name: "Qwen 2.5 (72B)", modelName: "qwen2.5:72b", type: "text", think: false },
    { name: "Qwen 3 (8B)", modelName: "qwen3:8b", type: "text", think: false },
    { name: "Qwen 3 (14B)", modelName: "qwen3:14b", type: "text", think: false },
    { name: "Qwen 3.5 (9B)", modelName: "qwen3.5:9b", type: "text", think: false },
    { name: "Llama 3.1 (8B)", modelName: "llama3.1:8b", type: "text", think: false },
    { name: "Llama 3.2 (3B)", modelName: "llama3.2:3b", type: "text", think: false },
    { name: "DeepSeek R1 (7B)", modelName: "deepseek-r1:7b", type: "text", think: true },
    { name: "DeepSeek R1 (14B)", modelName: "deepseek-r1:14b", type: "text", think: true },
    { name: "Mistral (7B)", modelName: "mistral:7b", type: "text", think: false },
    { name: "Gemma 2 (9B)", modelName: "gemma2:9b", type: "text", think: false },
  ],
};

// ============================================================
// Adapter functions
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  const apiKey = vendor.inputValues.apiKey || "ollama";
  const baseUrl = vendor.inputValues.baseUrl || "http://localhost:11434/v1";

  return createOpenAICompatible({
    baseURL: baseUrl,
    apiKey,
  }).chatModel(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  return "";
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  return "";
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// Exports
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export { };
