import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import u from "@/utils";
import fs from "fs";
import path from "path";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    workflowDir: z.string(),
  }),
  async (req, res) => {
    try {
      const { workflowDir } = req.body;

      if (!workflowDir || !fs.existsSync(workflowDir)) {
        return res.status(200).send(error("工作流目录不存在"));
      }

      const workflowFiles: {
        name: string;
        filePath: string;
        lastModified: string;
        fileSize: number;
        workflowInfo?: Record<string, any>;
      }[] = [];

      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".json")) {
            try {
              const stats = fs.statSync(fullPath);
              const content = fs.readFileSync(fullPath, "utf-8");
              let workflowInfo: Record<string, any> | undefined;
              try {
                const parsed = JSON.parse(content);
                workflowInfo = {
                  hasExtra: !!parsed.extra,
                  nodeCount: Object.keys(parsed.nodes || parsed.workflow?.nodes || {}).length,
                };
                if (parsed.description) {
                  workflowInfo.description = parsed.description;
                }
                if (parsed.name || parsed.title) {
                  workflowInfo.title = parsed.name || parsed.title;
                }
              } catch {
                workflowInfo = undefined;
              }

              workflowFiles.push({
                name: entry.name.replace(/\.json$/, ""),
                filePath: fullPath,
                lastModified: stats.mtime.toISOString(),
                fileSize: stats.size,
                workflowInfo,
              });
            } catch {
              // Skip files that can't be read
            }
          }
        }
      };

      scanDir(workflowDir);

      // Sort by last modified descending
      workflowFiles.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

      // Save scanned workflows as vendor models in the database
      try {
        const vendorModels = workflowFiles.map((wf) => ({
          name: wf.name,
          modelName: "comfyui_" + wf.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_"),
          type: "image",
          mode: ["text", "singleImage"],
        }));
        await u
          .db("o_vendorConfig")
          .where("id", "comfyui")
          .update({
            models: JSON.stringify(vendorModels),
          });
      } catch (modelErr) {
        console.error("[ComfyUI] 保存工作流模型失败:", modelErr);
      }

      res.status(200).send(success(workflowFiles));
    } catch (err: any) {
      res.status(200).send(error(err.message || "刷新工作流列表失败"));
    }
  },
);
