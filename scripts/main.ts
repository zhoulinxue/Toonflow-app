import { app, BrowserWindow, protocol, systemPreferences } from "electron";
import path from "path";
import fs from "fs";
import Module from "module";

// 加速 Electron 启动：跳过 GPU 信息收集，减少初始化耗时
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const TARGET_ENTRIES = new Set(["assets", "models", "serve", "skills", "web", "vendor"]);

function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.existsSync(d) || fs.copyFileSync(s, d);
  }
}

declare const __APP_VERSION__: string;

function compareVersions(a: string, b: string): number {
  const pa = a
    .split(".")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n));
  const pb = b
    .split(".")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function initializeData(): void {
  const srcDir = path.join(process.resourcesPath, "data");
  const destDir = path.join(app.getPath("userData"), "data");
  const versionFilePath = path.join(destDir, "version.txt");

  let shouldForceReplace = false;
  if (!fs.existsSync(versionFilePath)) {
    shouldForceReplace = true;
  } else {
    const localVersion = fs.readFileSync(versionFilePath, "utf-8").trim();
    if (compareVersions(localVersion, __APP_VERSION__) < 0) {
      shouldForceReplace = true;
    }
  }

  for (const dir of TARGET_ENTRIES) {
    const targetDir = path.join(destDir, dir);
    if (shouldForceReplace) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      copyDir(path.join(srcDir, dir), targetDir);
      continue;
    }
    if (!fs.existsSync(targetDir)) {
      copyDir(path.join(srcDir, dir), targetDir);
    }
  }

  if (shouldForceReplace) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(versionFilePath, `${__APP_VERSION__}\n`, "utf-8");
  }
}

//获取全部依赖路径，优先从 unpacked 加载原生模块，其他模块从 asar 加载
function getNodeModulesPaths(): string[] {
  const paths: string[] = [];
  if (app.isPackaged) {
    // external 依赖（原生模块）在 unpacked 目录
    const unpackedNodeModules = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules");
    if (fs.existsSync(unpackedNodeModules)) {
      paths.push(unpackedNodeModules);
    }
    // 普通依赖在 asar 内
    const asarNodeModules = path.join(process.resourcesPath, "app.asar", "node_modules");
    paths.push(asarNodeModules);
  } else {
    paths.push(path.join(process.cwd(), "node_modules"));
  }
  return paths;
}
// Strategy: combine NODE_PATH (for general module resolution) with
// a _resolveFilename redirect (for native modules that need unpacked dir).
// NODE_PATH adds asar node_modules to globalPaths so modules in the asar
// are findable from userData. The redirect ensures native .node modules
// load from the unpacked directory where DLLs are present.
const NATIVE_REDIRECTS = new Set([
  "better-sqlite3", "sharp", "sqlite3", "onnxruntime-node",
]);

let _setupDone = false;

function requireWithCustomPaths(modulePath: string): any {
  const appNodeModulesPaths = getNodeModulesPaths();
  const unpackedPath = appNodeModulesPaths[0];

  if (!_setupDone) {
    _setupDone = true;
    
    // 1. Set NODE_PATH so modules in the asar are findable
    const existing = process.env.NODE_PATH || "";
    process.env.NODE_PATH = [...appNodeModulesPaths, existing].filter(Boolean).join(require("path").delimiter);
    require("module")._initPaths();

    // 2. Redirect native modules to unpacked path (where DLLs are)
    if (unpackedPath) {
      const realModule = require("module");
      const origResolve = realModule._resolveFilename;
      const pathMod = require("path");

      realModule._resolveFilename = function(request: string, parent: any, isMain: boolean, options: any) {
        if (NATIVE_REDIRECTS.has(request)) {
          try {
            const alt = pathMod.join(unpackedPath, request);
            return origResolve.call(this, alt, parent, isMain, options);
          } catch (_) {}
        }
        return origResolve.call(this, request, parent, isMain, options);
      };
    }
  }

  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 500,
      frame: false,
      show: false,
      autoHideMenuBar: true,
      resizable: true,
      thickFrame: true,
    });
    mainWindow = win;
    win.setMenuBarVisibility(false);
    win.removeMenu();

    win.on("closed", () => {
      mainWindow = null;
    });

    win.once("ready-to-show", () => {
      win.show();
      resolve();
    });

    const isDev = process.env.NODE_ENV === "dev" || !app.isPackaged;
    if (process.env.VITE_DEV) {
      void win.loadURL("http://localhost:50188");
    } else {
      const htmlPath = isDev
        ? path.join(process.cwd(), "data", "web", "index.html")
        : path.join(app.getPath("userData"), "data", "web", "index.html");
      void win.loadFile(htmlPath);
    }
  });
}

let closeServeFn: (() => Promise<void>) | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "toonflow",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.whenReady().then(async () => {
  try { require("fs").appendFileSync(require("path").join(require("electron").app.getPath("userData"), "startup.log"), "START\n"); } catch(e) {}

  try { require("fs").appendFileSync(require("path").join(app.getPath("userData"), "debug.log"), "WHEN_READY\n"); } catch(e) {}
  try {
    let servePath: string;
    if (app.isPackaged) {
      // 生产环境：让出主线程一次，确保 loading 窗口渲染后再做耗时文件拷贝
      await new Promise((r) => setTimeout(r, 0));
      initializeData();
      servePath = path.join(app.getPath("userData"), "data", "serve", "app.js");
    } else {
      // 开发环境：直接加载源码（tsx 通过 -r tsx 注册了 require 钩子）
      servePath = path.join(process.cwd(), "src", "app.ts");
    }
    // 使用自定义路径加载模块

    const mod = requireWithCustomPaths(servePath);

    closeServeFn = mod.closeServe;

    const port = await mod.default(true);
    try { require("fs").appendFileSync(require("path").join(require("electron").app.getPath("userData"), "startup.log"), "PORT=" + port + "\n"); } catch(e) {}


    process.env.PORT = port;
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        resolve();
      }, 2000);
    });
    // 注册协议处理器
    protocol.handle("toonflow", (request) => {
      const url = new URL(request.url);
      const pathname = url.hostname.toLowerCase();
      const handlers: Record<string, () => object> = {
        getappurl: () => ({ url: process.env.URL ?? `http://localhost:${port}/api` }),
        windowminimize: () => {
          mainWindow?.minimize();
          return { ok: true };
        },
        windowmaximize: () => {
          if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
          } else {
            mainWindow?.maximize();
          }
          return { ok: true };
        },
        windowclose: () => {
          app.exit(0);
          return { ok: true };
        },
        apprestart: () => {
          // 延迟执行，让响应先返回给前端
          setTimeout(() => {
            app.relaunch();
            app.exit(0);
          }, 500);
          return { ok: true, message: "应用即将重启" };
        },
        windowismaximized: () => ({
          maximized: mainWindow?.isMaximized() ?? false,
        }),
        opendevtool: () => {
          mainWindow?.webContents.openDevTools();
          return { ok: true };
        },
        openurlwithbrowser: () => {
          const search = url.searchParams;
          const targetUrl = search.get("url");
          if (targetUrl) {
            const { shell } = require("electron");
            shell.openExternal(targetUrl);
            return { ok: true };
          } else {
            return { ok: false, error: "缺少url参数" };
          }
        },
        getlocallanguage: () => {
          // 获取应用区域设置

          // macOS系统特定方法
          if (process.platform === "darwin") {
            const systemLocale = systemPreferences.getUserDefault("AppleLocale", "string");
            return { ok: true, local: systemLocale };
          }
          const appLocale = app.getLocale();
          return { ok: true, local: appLocale };
        },
      };

      const handler = handlers[pathname];

      const responseData = handler ? handler() : { error: "未知接口" };
      return new Response(JSON.stringify(responseData), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    });

    // 服务启动成功，创建主窗口（主窗口 ready-to-show 时自动关闭loading）
    await createMainWindow();
  } catch (err) {
    try { require("fs").appendFileSync(require("path").join(require("electron").app.getPath("userData"), "startup.log"), "ERROR: " + (err.stack || err.message || String(err)) + "\n"); } catch(e) {}
    try { require("fs").appendFileSync(require("path").join(require("electron").app.getPath("userData"), "startup.log"), "ERROR: " + (err.stack || err.message || String(err)) + "\n"); } catch(e) {}
    try { require("fs").appendFileSync(require("path").join(require("electron").app.getPath("userData"), "startup.log"), "ERROR: " + (err.stack || err.message || String(err)) + "\n"); } catch(e) {}

    console.error("[服务启动失败]:", err);
    await createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", async (event) => {
  if (closeServeFn) await closeServeFn();
});
