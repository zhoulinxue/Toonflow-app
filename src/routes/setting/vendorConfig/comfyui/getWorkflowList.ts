import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
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
      }[] = [];

      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".json")) {
            workflowFiles.push({
              name: entry.name.replace(/\.json$/, ""),
              filePath: fullPath,
            });
          }
        }
      };

      scanDir(workflowDir);

      // Sort alphabetically by name
      workflowFiles.sort((a, b) => a.name.localeCompare(b.name));

      res.status(200).send(success(workflowFiles));
    } catch (err: any) {
      res.status(200).send(error(err.message || "获取工作流列表失败"));
    }
  },
);
