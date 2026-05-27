# HyperFrame Auto-Studio (video-bot-hyperframe-1) 架构设计文档

## 1. 项目简介
本项目旨在实现真正的“一句话极简自动化视频生成”。与之前基于场景微调的模式不同，本作主打“双阶生成模式（Two-Step Generation）”，完全由 AI Agent 完成从文案、排版、配音、视频渲染到视频号自动发布的完整链路，极大地提高了生产效率。

## 2. 核心架构与技术栈
- **语言引擎**：Node.js + ES Modules
- **大模型支持**：Google Gemini 2.5 Pro (基于 `@google/generative-ai` SDK)
- **渲染引擎**：HyperFrames + 无头浏览器 (Playwright)
- **Web 服务与前端交互**：Express.js + SSE (Server-Sent Events) + Vanilla CSS/JS
- **配音引擎**：Edge-TTS

## 3. 工作流 (Pipeline) 设计

完整的自动化制片工作流由 `main.js` 编排，共分为 6 个核心自动化步骤：

1. **步骤 1：大模型交互初稿生成 (Phase 4)**
   - 调用 `src/generator/ai_generator.js`。
   - 大模型直接根据用户输入的 `topic`（一句话主题），生成包含 HTML、CSS 和少量 JS 的交互式演示文档。
   - 该文档直接在浏览器中可以被预览，并且每一个 `.scene` 中包含了隐式的旁白剧本数据（`<script type="application/json" class="scene-narration">`）。

2. **步骤 2：TTS 配音与精确测时**
   - 调用 `src/generator/audio_processor.js`。
   - 解析上一步生成的交互式 HTML，提取出每个 Scene 对应的旁白文本。
   - 依次调用 Edge-TTS 生成配音文件，并测量每段配音的精确物理时长（毫秒级）。
   - 最后拼接出全局的主音频轨道 `master_audio.mp3`。

3. **步骤 3：HyperFrames 编译 (Phase 5)**
   - 调用 `src/generator/hyperframes_compiler.js`。
   - 将交互式 HTML 和第二步获取的精确时长数组喂给大模型（作为编译器角色）。
   - 大模型负责将交互逻辑（CSS opacity 控制等）转换为标准的 HyperFrames 规范（包含 `#root`，分离出 `.clip`，并在 `window.__timelines["main"]` 注入关键帧动画配置），以此适配 Playwright 无头渲染器的抓取要求。

4. **步骤 4：无头浏览器视频渲染**
   - 调用 `src/render/renderer.js`。
   - 启动 Playwright，加载编译好的 HyperFrames HTML 页面，通过拦截并驱动动画时间轴，截取每一帧并合成 mp4 视频流。
   - 产物为无声版本的 `silent_video.mp4`。

5. **步骤 5：音视频混流 (Mixer)**
   - 调用 `src/render/mixer.js`。
   - 使用 FFmpeg 将 `silent_video.mp4` 与 `master_audio.mp3` 进行音轨合并。
   - 输出最终的发布版 `final_video.mp4`。

6. **步骤 6：视频号自动发布**
   - 调用 `src/publish/channels_uploader.js`。
   - 使用 Playwright 自动化登录（或复用 `.chrome_session`），模拟用户在微信视频号创作者中心的点击行为，填写由大模型生成的 `title` 与 `description`。
   - 根据前端传入的 `publishMode`，自动将成片存放至草稿箱或公开发布，并归类到对应的 `collectionName`。

## 4. UI 设计与状态监控流
- **端口配置**：后端运行在 `3001` 端口，避免与旧版双列界面项目（占用 3000 端口）冲突。
- **SSE 日志流推送**：前端点击【✨ 立即启动全自动制片流程】后，后端 `server.js` 会通过 `spawn` 派生子进程，拦截所有控制台输出，并通过 Server-Sent Events (SSE) 协议，将日志实时推送到前端页面底部的 Terminal 窗口。
- **状态同步更新**：前端通过正则匹配特定日志输出（例如 `[Main] 步骤 1`），自动将对应的阶段高亮点亮为“进行中”，并在特定阶段（如第一步完成时）直接用 iframe 加载生成的中间态 HTML 进行播放展示。

## 5. 项目结构
```text
/d:/work/video-bot-hyperframe-1
├── main.js                  # 核心全自动管线总控脚本
├── server.js                # Web 控制台服务 (Port: 3001)
├── package.json
├── .env                     # API Key 与配置
├── docs/
│   └── design_document.md   # 架构设计文档 (本文档)
├── public/                  # 极简炫酷风前端页面
│   ├── index.html           # 页面结构
│   ├── style.css            # 科技感发光样式
│   └── app.js               # SSE 与 UI 联动逻辑
├── src/
│   ├── generator/           # 包含 AI 生成、配音处理、HyperFrames 编译等核心代码
│   ├── publish/             # 视频号上传及发布逻辑
│   ├── render/              # FFmpeg 混流与无头浏览器渲染引擎
│   └── utils/               # 环境变量加载、日志与常量定义
└── workspace/               # 运行时产生的产物 (交互HTML, mp4, mp3 等)
```
