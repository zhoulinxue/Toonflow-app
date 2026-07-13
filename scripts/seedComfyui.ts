/**
 * Seed script: Register ComfyUI vendor in the database
 * Run with: npx tsx scripts/seedComfyui.ts
 */
import dbClient from "../src/utils/db";

async function seedComfyui() {
  try {
    const existing = await dbClient("o_vendorConfig").where("id", "comfyui").first();
    if (existing) {
      console.log("ComfyUI vendor already registered in database (id=comfyui)");
      process.exit(0);
    }

    await dbClient("o_vendorConfig").insert({
      id: "comfyui",
      inputValues: JSON.stringify({ workflowDir: "", comfyuiUrl: "http://localhost:8188" }),
      models: JSON.stringify([]),
      enable: 1,
    });

    console.log("ComfyUI vendor registered successfully in o_vendorConfig table");
    process.exit(0);
  } catch (err: any) {
    console.error("Failed to register ComfyUI vendor:", err.message);
    process.exit(1);
  }
}

seedComfyui();
