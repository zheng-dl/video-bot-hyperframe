import 'dotenv/config';
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import { generateOutline } from "./src/generator/ai_generator.js";

const app = express();
const port = process.env.PORT || 3001;
const staticDir = path.resolve("./public");

app.use(express.json());
app.use(express.static(staticDir));
app.use("/workspace", express.static(path.resolve("./workspace")));
app.use("/hyperframes-native", express.static(path.resolve("./hyperframes-native")));

// SSE logs broadcaster
const sseClients = new Set();
export const logEmitter = new EventEmitter();

function broadcastLog(logLine) {
  for (const client of sseClients) {
    client.write(`data: ${JSON.stringify({ log: logLine })}\n\n`);
  }
}

logEmitter.on("log", (message) => {
  broadcastLog(message);
});

// SSE endpoint
app.get("/api/logs", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  const heartbeatInterval = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  sseClients.add(res);
  console.log(`[Server] Web client connected. Active clients: ${sseClients.size}`);

  req.on("close", () => {
    clearInterval(heartbeatInterval);
    sseClients.delete(res);
    console.log(`[Server] Web client disconnected. Active clients: ${sseClients.size}`);
  });
});

// 1. API: 提供支持的大脑模型矩阵列表供前端渲染选择
app.get("/api/llm-models", (req, res) => {
  try {
    const configPath = path.resolve("./config/system_config.json");
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: "Missing config file." });
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const safeProviders = {};

    Object.keys(config.LLM_PROVIDERS).forEach((key) => {
      safeProviders[key] = {
        name: config.LLM_PROVIDERS[key].name
      };
    });

    res.json({
      active: config.ACTIVE_LLM_PROVIDER || "gemini",
      providers: safeProviders
    });
  } catch (err) {
    console.error("[Server ERR] Failed to load LLM providers:", err.message);
    res.status(500).json({ error: "Failed to load LLM options." });
  }
});

// 5. API: 获取当前最新已生成保存的页面大纲与主题（零硬编码，兼容历史数组）
app.get("/api/get-current-outlines", (req, res) => {
  try {
    const outlinesJsonPath = path.resolve("./workspace/current_outlines.json");
    if (fs.existsSync(outlinesJsonPath)) {
      const data = JSON.parse(fs.readFileSync(outlinesJsonPath, 'utf-8'));
      if (Array.isArray(data)) {
        return res.json({ topic: "", outlines: data });
      }
      return res.json({ topic: data.topic || "", outlines: data.outlines || [] });
    }
    res.json({ topic: "", outlines: [] });
  } catch (err) {
    console.error("[Server ERR] Failed to load current outlines:", err.message);
    res.status(500).json({ error: "Failed to load current outlines." });
  }
});

// 2. API: 生成纯页面大纲主题列表
app.post("/api/generate-outline", async (req, res) => {
  const { topic, provider } = req.body;
  if (!topic || topic.trim() === "") {
    return res.status(400).json({ error: "请输入核心技术主题。" });
  }

  try {
    console.log(`[Server] Requesting outline for: ${topic} (Provider: ${provider || 'default'})`);
    const outlines = await generateOutline(topic.trim(), provider);

    // 零魔法值与零硬编码，动态创建并保存大纲到本地缓存，供前端秒级初始化还原
    const workspaceDir = path.resolve("./workspace");
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }
    const outlinesJsonPath = path.join(workspaceDir, "current_outlines.json");
    fs.writeFileSync(
      outlinesJsonPath,
      JSON.stringify({ topic: topic.trim(), outlines }, null, 2),
      "utf-8"
    );

    res.json({ outlines });
  } catch (err) {
    console.error(`[Server ERR] Failed to generate outline:`, err.message);
    res.status(500).json({ error: `AI 大纲规划失败: ${err.message}` });
  }
});

// 统一管道子进程执行器
function spawnPipelineProcess(outlinesJsonPath, topic, publishMode, collectionName, voice, speed, skipRender, provider, resume, res) {
  const args = [
    "main.js",
    "--outlines", outlinesJsonPath,
    "--publishMode", publishMode || "draft",
    "--collectionName", collectionName || "",
    "--voice", voice || "zh-CN-YunxiNeural",
    "--speed", speed || "5",
    "--provider", provider || "gemini",
    "--topic", topic || ""
  ];

  if (skipRender) {
    args.push("--skip-render");
  }

  if (resume) {
    args.push("--resume");
  }

  console.log(`[Server] Spawning pipeline: node ${args.join(" ")}`);
  broadcastLog(`[SYSTEM]: 启动双阶视频制作管道流程...`);

  const child = spawn("node", args, {
    cwd: process.cwd(),
    env: { ...process.env },
    shell: false,
  });

  child.stdout.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      output.split("\n").forEach((line) => {
        console.log(line);
        broadcastLog(line);
      });
    }
  });

  child.stderr.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      output.split("\n").forEach((line) => {
        console.error(line);
        broadcastLog(`[ERR/WARN]: ${line}`);
      });
    }
  });

  child.on("close", (code) => {
    console.log(`[Server] Pipeline exited with code ${code}`);
    if (code !== 0) {
      broadcastLog(`[SYSTEM_FATAL_ERR]: 管道流程执行遭遇异常，子进程以退出码 ${code} 异常中止。`);
    } else {
      broadcastLog(`[SYSTEM]: 制作管道流程执行完毕，退出码 ${code}`);
    }
  });

  res.json({ message: "流程已启动" });
}

// 3. API: 接收微调大纲并启动整套管线
app.post("/api/generate-html-by-outline", (req, res) => {
  const { outlines, topic, publishMode, collectionName, voice, speed, skipRender, provider, resume } = req.body;
  if (!outlines || !Array.isArray(outlines) || outlines.length === 0) {
    return res.status(400).json({ error: "大纲数据非法，至少需要包含一个主题。" });
  }

  const workspaceDir = path.resolve("./workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  
  const outlinesJsonPath = path.join(workspaceDir, "current_outlines.json");
  // 结构化写入，规避魔法值硬编码
  fs.writeFileSync(outlinesJsonPath, JSON.stringify({ topic: topic || "", outlines }, null, 2), "utf-8");

  spawnPipelineProcess(outlinesJsonPath, topic || "", publishMode, collectionName, voice, speed, skipRender, provider, resume, res);
});

// 4. API: 一句话自动出片极速兼容
app.post("/api/hf-native-auto", async (req, res) => {
  const { prompt, skipRender, provider } = req.body;
  if (!prompt || prompt.trim() === "") {
    return res.status(400).json({ error: "请输入核心技术主题。" });
  }

  try {
    const targetProvider = provider || "gemini";
    broadcastLog(`[SYSTEM]: 启动一句话原生自动出片... 正在用 [${targetProvider}] 规划大纲...`);
    const outlines = await generateOutline(prompt.trim(), targetProvider);
    
    const workspaceDir = path.resolve("./workspace");
    if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
    
    const outlinesJsonPath = path.join(workspaceDir, "current_outlines.json");
    // 一句话出片写入完整的结构
    fs.writeFileSync(outlinesJsonPath, JSON.stringify({ topic: prompt, outlines }, null, 2), "utf-8");

    spawnPipelineProcess(outlinesJsonPath, prompt, "draft", "", "zh-CN-YunxiNeural", "5", skipRender, targetProvider, false, res);
  } catch (err) {
    console.error(`[Server ERR] One-click failed:`, err.message);
    res.status(500).json({ error: `一句话自动化出片失败: ${err.message}` });
  }
});

app.listen(port, () => {
  console.log("=========================================");
  console.log(`Web Console Server is running on: http://localhost:${port}`);
  console.log("=========================================");
});
