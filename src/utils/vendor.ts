import { transform } from "sucrase";
import fs from "fs";
import path from "path";
import u from "@/utils";

export function writeCode(id: string | number, tsCode: string) {
  const rootDir = u.getPath("vendor")
  fs.mkdirSync(rootDir, { recursive: true })
  if (fs.existsSync(path.join(rootDir,  `${id}.ts`))) {
    fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
  }
  fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
}

export function getCode(id: string): string {
  const rootDir = u.getPath("vendor");
  const targetFile = path.join(rootDir, `${id}.ts`);
  if (!fs.existsSync(targetFile)) return "";
  return fs.readFileSync(targetFile, "utf-8");
}

export async function getModelList(id: string): Promise<Array<any>> {
  const row = await u.db("o_vendorConfig").where("id", id).select("models", "inputValues").first();
  if (!row) return [];

  if (id === "comfyui") {
    return scanComfyUIWorkflows(row.inputValues, row.models);
  }

  if (!row.models) return [];
  const code = getCode(id);
  if (!code) return [];
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  if(!vendorData || !vendorData.vendor || !vendorData.vendor.models) return [];
  const combined = [...JSON.parse(JSON.stringify(vendorData.vendor.models)), ...JSON.parse(row.models ?? "[]")];
  const map = new Map<string, any>();
  for (const m of combined) {
    map.set(m.modelName, m);
  }
  return [...map.values()];
}

function scanComfyUIWorkflows(inputValuesJson: string, dbModelsJson: string): Array<any> {
  let inputValues: Record<string, string> = {};
  try { inputValues = JSON.parse(inputValuesJson || "{}"); } catch {}

  const workflowDir = inputValues.workflowDir;
  console.log("[ComfyUI] scanComfyUIWorkflows called, workflowDir:", workflowDir, "inputValues:", inputValuesJson);

  if (!workflowDir || !fs.existsSync(workflowDir)) {
    console.log("[ComfyUI] workflowDir empty or does not exist, returning DB models");
    const dbModels = JSON.parse(dbModelsJson || "[]");
    return dbModels;
  }

  console.log("[ComfyUI] scanning directory:", workflowDir);
  const workflows: Array<any> = [];

  function detectWorkflowType(nodes: Record<string, any>): { type: string; mode: string[] } {
    const types: string[] = [...new Set(Object.values(nodes).map((n: any) => n.class_type || n.type))];

    const hasVideoOutput = types.some((t: string) => t && (
      t === "SaveVideo" || t === "CreateVideo" || t.includes("VHS_") || t.includes("LTXV") ||
      t.includes("Wan") || t.includes("FxAiVideo") || t.includes("FxAiFrameGenerator") ||
      t === "VideoCombine" || t.includes("VideoGen") || t.includes("ToVideo")
    ));

    const hasAudioOutput = types.some((t: string) => t && (
      t === "PreviewAudio" || t === "SaveAudio" || t.includes("AudioGen") ||
      t.includes("AudioSeparation") || t.includes("AudioEncoder")
    ));

    const isAudioGen = hasAudioOutput && !hasVideoOutput;

    if (hasVideoOutput) return { type: "video", mode: ["startEndRequired", "endFrameOptional", "text"] };
    if (isAudioGen) return { type: "tts", mode: ["text"] };
    return { type: "image", mode: ["text", "singleImage"] };
  }

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const name = entry.name.replace(/\.json$/, "");
        let wfType = "image";
        let wfMode: string[] = ["text", "singleImage"];

        try {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const data = JSON.parse(raw);
          const nodes = data.nodes || {};
          if (Object.keys(nodes).length > 0) {
            const detected = detectWorkflowType(nodes);
            wfType = detected.type;
            wfMode = detected.mode;
          }
        } catch {}

        const modelName = "comfyui_" + name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_");
        console.log("[ComfyUI] found workflow:", name, "type:", wfType);
        workflows.push({ name: "ComfyUI: " + name, modelName, type: wfType, mode: wfMode });
      }
    }
  }

  scanDir(workflowDir);
  console.log("[ComfyUI] total workflows found:", workflows.length);
  workflows.sort((a, b) => a.name.localeCompare(b.name));

  const dbModels = JSON.parse(dbModelsJson || "[]");
  const combined = [...workflows, ...dbModels];
  const map = new Map<string, any>();
  for (const m of combined) map.set(m.modelName, m);
  return [...map.values()];
}


export function getVendor(id: string) {
  const code = getCode(id);
  if (!code) return [];
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  return vendorData.vendor;
}
