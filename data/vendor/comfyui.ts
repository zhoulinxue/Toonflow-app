/**
 * Toonflow AI Vendor - ComfyUI
 * @version 2.0
 */

// ============================================================
// 类型定义
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

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
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

// ============================================================
// 全局声明
// ============================================================

declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: any, m: TTSModel) => Promise<string>;
};

declare function logger(log: any): void;
declare function pollTask(
  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,
  interval?: number,
  timeout?: number,
): Promise<{ completed: boolean; data?: string; error?: string }>;

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "comfyui",
  version: "2.0",
  name: "ComfyUI",
  author: "ToonFlow",
  description: "ComfyUI 是一款节点式工作流工具，通过 JSON 工作流文件运行生成任务。\n\n配置工作流目录后，系统自动扫描目录中的 JSON 文件并识别对应类型。",
  inputs: [
    {
      key: "workflowDir",
      label: "ComfyUI工作流目录",
      type: "text",
      required: true,
      placeholder: "示例: C:\\ComfyUI\\workflows",
    },
    {
      key: "comfyuiUrl",
      label: "ComfyUI服务地址",
      type: "url",
      required: true,
      placeholder: "http://localhost:8188",
    },
  ],
  inputValues: {
    workflowDir: "",
    comfyuiUrl: "http://localhost:8188",
  },
  models: [],
};

// ============================================================
// 辅助工具
// ============================================================

function cleanModelName(name: string): string {
  return name.replace(/^comfyui_/, "").replace(/_/g, " ");
}

/**
 * 根据 workflowDir + modelName 找到对应的 JSON 工作流文件路径
 */
function findWorkflowFile(modelName: string): string {
  if (!vendor.inputValues.workflowDir) {
    throw new Error("未配置工作流目录，请在供应商配置中设置 workflowDir");
  }

  // Strip the "comfyui_" vendor prefix to get the original workflow filename
  const searchBaseName = modelName.replace(/^comfyui_/, "");

  function scanDir(dir: string): string | null {
    const fs = require("fs");
    const path = require("path");
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const found = scanDir(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const wfName = entry.name.replace(/\.json$/, "");
        // Match: original filename equals searchBaseName, or filename + ".json" equals modelName + ".json"
        if (wfName === searchBaseName || entry.name === modelName + ".json") {
          return fullPath;
        }
      }
    }
    return null;
  }

  const filePath = scanDir(vendor.inputValues.workflowDir);
  if (!filePath) {
    throw new Error("未找到工作流文件: " + modelName + "，请检查工作流目录配置");
  }
  return filePath;
}

/**
 * 从 ComfyUI 工作流 JSON 中查找并替换 prompt
 * 通过 KSsampler 输入槽定位到 CLIPTextEncode 节点
 */
function injectPromptIntoWorkflow(workflow: any, prompt: string): void {
  const nodes = workflow.nodes || workflow;
  const nodeMap = new Map<string, any>();

  // Build node map
  if (Array.isArray(nodes)) {
    for (const n of nodes) nodeMap.set(String(n.id), n);
  } else {
    for (const [id, n] of Object.entries(nodes)) nodeMap.set(id, n);
  }

  // Helper: get node type (supports both "type" and "class_type")
  const getNodeType = (n: any) => n.class_type || n.type;
  // Helper: get node title (supports both "_meta.title" and "title")
  const getNodeTitle = (n: any) => n._meta?.title || n.title || "";

  const links = workflow.links || [];
  // Detect API format: no links array or links is empty and nodes is a dict
  const isApiFormat = !links || (links.length === 0 && !Array.isArray(nodes));

  if (isApiFormat) {
    // API format: connections embedded in node inputs as ['node_id', slot]
    for (const [nodeId, node] of nodeMap) {
      const ntype = getNodeType(node);
      if (ntype === "KSampler" || ntype === "SamplerCustomAdvanced") {
        const positiveRef = node.inputs?.positive;
        if (positiveRef && Array.isArray(positiveRef) && positiveRef.length >= 1) {
          const posNodeId = String(positiveRef[0]);
          const posNode = nodeMap.get(posNodeId);
          if (posNode && getNodeType(posNode) === "CLIPTextEncode") {
            if (posNode.widgets_values && posNode.widgets_values.length > 0) {
              posNode.widgets_values[0] = prompt;
            }
            if (posNode.inputs && posNode.inputs.text !== undefined) {
              posNode.inputs.text = prompt;
            }
            logger("[ComfyUI] 已将 prompt 注入节点 " + posNodeId + " (" + getNodeType(posNode) + ", API format)");
            return;
          }
        }
      }
    }
  } else {
    // Standard format with top-level links
    for (const [nodeId, node] of nodeMap) {
      const ntype = getNodeType(node);
      if (ntype === "KSampler" || ntype === "SamplerCustomAdvanced") {
        const positiveInputIdx = ntype === "KSampler" ? 4 : 1;
        const posLink = links.find(
          (l: any) => String(l.target_id || l[3]) === String(nodeId) && Number(l.target_slot ?? l[5]) === positiveInputIdx,
        );
        if (posLink) {
          const srcNodeId = String(posLink.source_id ?? posLink[1]);
          const srcNode = nodeMap.get(srcNodeId);
          if (srcNode && getNodeType(srcNode) === "CLIPTextEncode" && srcNode.widgets_values && srcNode.widgets_values.length > 0) {
            srcNode.widgets_values[0] = prompt;
            if (srcNode.inputs && srcNode.inputs.text !== undefined) {
              srcNode.inputs.text = prompt;
            }
            logger("[ComfyUI] 已将 prompt 注入节点 " + srcNodeId + " (" + getNodeType(srcNode) + ")");
            return;
          }
        }
      }
    }
  }

  // Fallback: find first CLIPTextEncode with non-negative title
  for (const [nodeId, node] of nodeMap) {
    const ntype = getNodeType(node);
    const ntitle = getNodeTitle(node);
    if (ntype === "CLIPTextEncode" && !ntitle.toLowerCase().includes("neg")) {
      if (node.widgets_values && node.widgets_values.length > 0) {
        node.widgets_values[0] = prompt;
        if (node.inputs && node.inputs.text !== undefined) {
          node.inputs.text = prompt;
        }
          logger("[ComfyUI] 已将 prompt 注入节点 " + nodeId + " (" + ntype + ", fallback)");
        return;
      }
    }
  }

  logger("[ComfyUI] 未找到可注入 prompt 的节点，使用原始工作流");
}

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3): any => {
  throw new Error("ComfyUI 供应商不支持文本模型");
};


/**
 * ????
 * 1. ??? <name>_ref.json ???
 * 2. ????? LoadImage ????
 * 3. ?? { workflow, filename }
 */
async function injectReferenceImage(workflow: any, referenceList: any[] | undefined, modelName: string): Promise<{ workflow: any; filename: string | null }> {
  if (!referenceList || referenceList.length === 0) {
    return { workflow, filename: null };
  }

  const ref = referenceList[0];
  if (ref.type !== "image" || !ref.base64) {
    return { workflow, filename: null };
  }

  const base64 = ref.base64;
  const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    logger("[ComfyUI] ??? base64 ???");
    return { workflow, filename: null };
  }
  const imageExt = matches[1] || "png";
  const imageData = matches[2];

  const fs = require("fs");
  const path = require("path");

  // Try to find a companion _ref workflow
  const refModelName = modelName + "_ref";
  let refWorkflow: any = null;
  try {
    const refPath = findWorkflowFile(refModelName);
    refWorkflow = JSON.parse(fs.readFileSync(refPath, "utf-8"));
    logger(`[ComfyUI] ???: ${refModelName}`);
  } catch {
    logger(`[ComfyUI] ?????`);
  }

  const targetWf = refWorkflow || workflow;
  const nodes = targetWf.nodes || targetWf;
  const getNodeType = (n: any) => n.class_type || n.type;

  // Find a LoadImage node
  let loadImageNode: any = null;
  let loadImageId: string = "";

  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (getNodeType(n) === "LoadImage") { loadImageNode = n; loadImageId = String(n.id); break; }
    }
  } else {
    for (const [id, n] of Object.entries(nodes)) {
      if (getNodeType(n) === "LoadImage") { loadImageNode = n; loadImageId = id; break; }
    }
  }

  if (loadImageNode && loadImageNode.inputs) {
    // Upload image to ComfyUI
    try {
      const buf = Buffer.from(imageData, "base64");
      const filename = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${imageExt}`;

      const formData = new FormData();
      const blob = new Blob([buf], { type: `image/${imageExt}` });
      formData.append("image", blob, filename);

      const comfyuiUrl = vendor.inputValues.comfyuiUrl || "http://localhost:8188";
      const uploadRes = await fetch(`${comfyuiUrl}/upload/image`, {
        method: "POST",
        body: formData,
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        const uploadedName = uploadData.name || filename;
        loadImageNode.inputs.image = uploadedName;
        logger(`[ComfyUI] ???? LoadImage ?? ${loadImageId}: ${uploadedName}`);
        return { workflow: targetWf, filename: uploadedName };
      } else {
        logger(`[ComfyUI] ????: ${uploadRes.status}????`);
      }
    } catch (e: any) {
      logger(`[ComfyUI] ????: ${e.message}????`);
    }

    // Fallback: write to ComfyUI input dir
    try {
      const comfyuiDir = vendor.inputValues.workflowDir || ".";
      const inputDir = path.join(comfyuiDir, "..", "input");
      const filename = `ref_${Date.now()}.${imageExt}`;
      const filePath = path.join(inputDir, filename);
      if (fs.existsSync(inputDir)) {
        fs.writeFileSync(filePath, Buffer.from(imageData, "base64"));
        loadImageNode.inputs.image = filename;
        logger(`[ComfyUI] ???? ComfyUI input ??: ${filename}`);
        return { workflow: targetWf, filename };
      }
    } catch {
      logger("[ComfyUI] ???? ComfyUI input ??");
    }
  } else {
    logger("[ComfyUI] ????? LoadImage ??? prompt embedding ????");
  }

  return { workflow: targetWf, filename: null };
}

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const comfyuiUrl = vendor.inputValues.comfyuiUrl || "http://localhost:8188";
  const filePath = findWorkflowFile(model.modelName);

  const fs = require("fs");
  const workflowRaw = fs.readFileSync(filePath, "utf-8");
  const workflow = JSON.parse(workflowRaw);

  // Inject the prompt
  // Inject the prompt
  injectPromptIntoWorkflow(workflow, config.prompt);

  // Inject reference image (upload + set in LoadImage node)
  let actualWorkflow = workflow;
  try {
    const refResult = await injectReferenceImage(workflow, config.referenceList, model.modelName);
    actualWorkflow = refResult.workflow;
  } catch (e: any) {
    logger(`[ComfyUI] ????: ${e.message}???`);
  }

  // Prepare API payload
  const apiJson = { prompt: actualWorkflow };

  // Submit to ComfyUI
  logger("[ComfyUI] 提交任务到 " + comfyuiUrl + "/prompt");
  const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apiJson),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error("ComfyUI 提交失败: " + submitRes.status + " " + errText);
  }

  const submitData = (await submitRes.json()) as any;
  const promptId = submitData.prompt_id;
  if (!promptId) {
    throw new Error("ComfyUI 未返回 prompt_id");
  }
  logger("[ComfyUI] 任务ID: " + promptId);

  // Poll for result
  const result = await pollTask(async () => {
    try {
      const historyRes = await fetch(`${comfyuiUrl}/history/${promptId}`);
      if (!historyRes.ok) return { completed: false };
      const historyData = (await historyRes.json()) as any;
      const promptHistory = historyData[promptId];

      if (!promptHistory) return { completed: false };

      if (promptHistory.status?.status_str === "error" || promptHistory.status?.completed === false) {
        return { completed: true, error: "ComfyUI 任务执行失败" };
      }

      // Check if outputs are ready
      if (promptHistory.outputs) {
        for (const nodeId of Object.keys(promptHistory.outputs)) {
          const output = promptHistory.outputs[nodeId];
          if (output.images && output.images.length > 0) {
            const image = output.images[0];
            const imageUrl = `${comfyuiUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || "")}&type=${encodeURIComponent(image.type || "output")}`;
            // Download the image
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer();
              const base64 = Buffer.from(buffer).toString("base64");
              const contentType = imgRes.headers.get("content-type") || "image/png";
              return { completed: true, data: `data:${contentType};base64,${base64}` };
            }
          }
        }
      }
      return { completed: false };
    } catch {
      return { completed: false };
    }
  }, 2000, 600000);

  if (result.error) {
    throw new Error(result.error);
  }
  if (!result.data) {
    throw new Error("ComfyUI 任务执行超时");
  }
  return result.data;
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const comfyuiUrl = vendor.inputValues.comfyuiUrl || "http://localhost:8188";
  const filePath = findWorkflowFile(model.modelName);

  const fs = require("fs");
  const workflowRaw = fs.readFileSync(filePath, "utf-8");
  const workflow = JSON.parse(workflowRaw);

  injectPromptIntoWorkflow(workflow, config.prompt);

  const apiJson = { prompt: actualWorkflow };

  logger("[ComfyUI] 提交视频任务到 " + comfyuiUrl + "/prompt");
  const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apiJson),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`ComfyUI ????: ${submitRes.status} ${errText}`);
  }

  const submitData = (await submitRes.json()) as any;
  const promptId = submitData.prompt_id;
  if (!promptId) throw new Error("ComfyUI 未返回 prompt_id");
  logger("[ComfyUI] 视频任务ID: " + promptId);

  const result = await pollTask(async () => {
    try {
      const historyRes = await fetch(`${comfyuiUrl}/history/${promptId}`);
      if (!historyRes.ok) return { completed: false };
      const historyData = (await historyRes.json()) as any;
      const promptHistory = historyData[promptId];
      if (!promptHistory) return { completed: false };

      if (promptHistory.status?.status_str === "error") {
        return { completed: true, error: "ComfyUI ??????" };
      }

      if (promptHistory.outputs) {
        for (const nodeId of Object.keys(promptHistory.outputs)) {
          const output = promptHistory.outputs[nodeId];
          // Check for video output (VHS nodes output gifs or videos)
          const gifs = output.gifs || [];
          if (gifs.length > 0) {
            const gif = gifs[0];
            const videoUrl = `${comfyuiUrl}/view?filename=${encodeURIComponent(gif.filename)}&subfolder=${encodeURIComponent(gif.subfolder || "")}&type=${encodeURIComponent(gif.type || "output")}`;
            const vidRes = await fetch(videoUrl);
            if (vidRes.ok) {
              const buffer = await vidRes.arrayBuffer();
              const base64 = Buffer.from(buffer).toString("base64");
              const contentType = vidRes.headers.get("content-type") || "video/mp4";
              return { completed: true, data: `data:${contentType};base64,${base64}` };
            }
          }
          // Check for image output (fallback for video that outputs frames)
          if (output.images && output.images.length > 0) {
            const image = output.images[0];
            const imageUrl = `${comfyuiUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || "")}&type=${encodeURIComponent(image.type || "output")}`;
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer();
              const base64 = Buffer.from(buffer).toString("base64");
              const contentType = imgRes.headers.get("content-type") || "image/png";
              return { completed: true, data: `data:${contentType};base64,${base64}` };
            }
          }
        }
      }
      return { completed: false };
    } catch {
      return { completed: false };
    }
  }, 2000, 1200000);

  if (result.error) throw new Error(result.error);
  if (!result.data) throw new Error("ComfyUI 任务执行超时");
  return result.data;
};

const ttsRequest = async (config: any, model: TTSModel): Promise<string> => {
  // Audio workflows work the same way - submit to ComfyUI and get audio output
  const comfyuiUrl = vendor.inputValues.comfyuiUrl || "http://localhost:8188";
  const filePath = findWorkflowFile(model.modelName);

  const fs = require("fs");
  const workflowRaw = fs.readFileSync(filePath, "utf-8");
  const workflow = JSON.parse(workflowRaw);

  // For audio workflows, the prompt is typically the text to synthesize
  injectPromptIntoWorkflow(workflow, config.text || config.prompt || "");

  const apiJson = { prompt: actualWorkflow };
  const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apiJson),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`ComfyUI ????: ${submitRes.status} ${errText}`);
  }

  const submitData = (await submitRes.json()) as any;
  const promptId = submitData.prompt_id;

  const result = await pollTask(async () => {
    try {
      const historyRes = await fetch(`${comfyuiUrl}/history/${promptId}`);
      if (!historyRes.ok) return { completed: false };
      const historyData = (await historyRes.json()) as any;
      const promptHistory = historyData[promptId];
      if (!promptHistory) return { completed: false };

      if (promptHistory.status?.status_str === "error") {
        return { completed: true, error: "ComfyUI ??????" };
      }

      if (promptHistory.outputs) {
        for (const nodeId of Object.keys(promptHistory.outputs)) {
          const output = promptHistory.outputs[nodeId];
          if (output.audio && output.audio.length > 0) {
            // Not implemented fully - return first image as fallback
          }
        }
      }
      return { completed: false };
    } catch {
      return { completed: false };
    }
  }, 2000, 600000);

  if (result.error) throw new Error(result.error);
  return result.data || "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
export {};
