# 🛠️ HyperFrame Auto-Studio

> **纯大纲驱动、AI 视觉驱动的双阶技术视频全自动制作与发布系统**

HyperFrame Auto-Studio 是一套面向未来的、全自动化技术视频生产流水线。它将大语言模型（LLM）的创造力与无头浏览器像素级渲染、FFmpeg 高效混音、以及 Playwright 自动化上传完美融合。您只需输入一个您想科普的核心技术主题，系统即可自动规划大纲、手绘 SVG 科幻交互视觉、合成逼真 TTS 口播旁白，最终一键产出高清技术短视频，并自动上传发布至视频号。

---

## 💎 核心硬核特性 (Key Features)

### 🧠 1. 纯大纲智能驱动与微调
输入任意技术主题，系统即刻由 AI 大脑为您科学规划极简页面大纲。支持在 Web 控制台中直接进行页面卡片级的二次微调（修改文案、增删分镜、添加新页面），完美实现“人机协同创作”。

### 🎨 2. 双阶智能视频制作管道
* **第一阶段 (AI 视觉设计)**：LLM 动态渲染出带有精美 SVG 动效、科幻发光和隐藏式口播旁白（Narrations）的交互分镜 HTML 文件。
* **第二阶段 (HyperFrames 编译器)**：系统自动调用 TTS 语音引擎测量每幕旁白的精确发音时长，智能编译器在此基础上将网页重构编译为严格契合时间轴的 **HyperFrames 原生源文件**。

### 🎬 3. 无头渲染与高清音视频混合
使用 Playwright 无头浏览器像素级捕捉 HyperFrames 动态网页帧并生成无声视频；随后配合 FFmpeg 工具链将无声视频与 TTS 主配音音频合并，快速混音输出高清 MP4 成品视频。

### ⚡ 4. 智能断点续作模式 (Resume Cache)
内置基于步骤特征的断点复用技术。当重启工作流时，系统会自动检测本地已生成的 HTML、配音音频、无声视频文件，进行**秒级复用**，彻底杜绝大模型 Token 重复消耗和时间浪费。

### 📁 5. 主题专属工作空间隔离 (Sanitized Topic Directory)
自动通过安全字符清洗函数 `sanitizeTopic` 依您的技术主题名称在本地建立专属子文件夹（如 `workspace/Docker比虚拟机轻量/`、`hyperframes-native/Docker比虚拟机轻量/`），所有中间产物与最终成品按主题完美隔离，彻底避免文件被后来的流程重名覆盖。

### 🚀 6. 视频号助手自动挂载发布
集成 Playwright 自动化发布助手。渲染混合完毕后，自动唤起有头/无头浏览器进入视频号创作者助手，自动上传 MP4、填写大纲标题、挂载归档合集，并安全地为您存入草稿箱或一键直接发布。

### 📺 7. 极客科技风 Web GUI 控制台
* **实时 SSE 日志流**：通过 Server-Sent Events 实现毫秒级服务器管道日志动态广播。
* **意外断连自愈提示**：当后台网络连接波动或服务中止时，控制台小绿灯会瞬间转化为**黄色呼吸闪烁重连状态**，并实时指引重连。
* **故障熔断卡片全置红**：如果大语言模型请求失败或 FFmpeg 混音崩溃（子进程非 0 状态码退出），系统会立即响应，**自动将当前运行中和未开始的状态卡片强行扭转为红色 Error 状态**，杜绝卡死无限转圈的体验 bug。

---

## 🛠️ 技术栈 (Tech Stack)

* **后端服务**：Node.js, Express, Playwright (Automation), fluent-ffmpeg (内置 ffmpeg-static / ffprobe-static 依赖)
* **前端界面**：极客科技风 Vanilla CSS Grid, Vanilla JS, EventSource (SSE)
* **AI 创作大脑**：Google Generative AI (Gemini), DeepSeek Chat, OpenAI GPT, MsEdgeTTS (内置微软 Edge 24kHz/48kbps 高清语音流)

---

## 📂 纯净的项目目录结构 (Project Structure)

```bash
├── config/                     # 双阶提示词与全局系统配置
│   ├── system_config.json      # 提供商模型矩阵与参数配置
│   ├── outline_prompt.txt      # 大纲规划 AI System Prompt
│   ├── interactive_html_prompt.txt # 第一阶手绘网页 AI System Prompt
│   └── hyperframes_compile_prompt.txt # 第二阶编译器时间轴重构 System Prompt
├── public/                     # 极客科技风 Web 客户端
│   ├── index.html              # 主控中心 UI 界面
│   ├── app.js                  # SSE 实时通信与卡片状态扭转控制逻辑 (0硬编码)
│   └── style.css               # 毛玻璃科幻发光 UI 样式
├── src/                        # 核心业务组件
│   ├── generator/              # AI 规划、网页手绘、HyperFrames 编译驱动器
│   ├── publish/                # 视频号自动化助手
│   ├── render/                 # 视频帧截图渲染与 FFmpeg 混音器
│   └── utils/                  # 环境变量、常量与日志处理工具
├── workspace/                  # 依技术主题自动生成的专属媒体工作目录 (被 Git 忽略)
├── hyperframes-native/         # 编译后的 HyperFrames 物理目录 (被 Git 忽略)
├── .env                        # 本地 API 密钥与环境变量 (被 Git 忽略)
├── .gitignore                  # 绝对可靠的防敏感数据泄露忽略清单
├── main.js                     # 命令行纯管道执行器
└── server.js                   # Web 控制台后台服务器 (Express 驱动)
```

---

## 🚀 快速启动指引 (Getting Started)

### 1. 克隆与依赖安装
确保您本地已安装了 **Node.js (>= 18)**，随后在项目根目录运行安装依赖：
```bash
npm install
```
系统将自动为您配置 Playwright 浏览器依赖以及 FFmpeg 静态二进制工具。

### 2. 配置密钥与环境
在项目根目录下创建一个 `.env` 文件，用于存放您的 API 密钥（**该文件已被安全写入 `.gitignore`，绝对不会泄露**）：
```ini
GEMINI_API_KEY=您的Gemini真实API_KEY
DEEPSEEK_API_KEY=您的DeepSeek真实API_KEY
GPT_API_KEY=您的OpenAI真实API_KEY
```

### 3. 运行 Web GUI 主控台
启动本地 Express 控制后台服务器：
```bash
node server.js
```
启动成功后，打开浏览器访问控制台：
👉 **`http://localhost:3001`**

在控制台内，输入您想生成的任何技术主题（如：`详解 Go 语言的 Goroutine 高并发机制`），点击 **“智能生成页面大纲”**，即可开始开启全自动的技术短视频创作之旅！

---

## 🛡️ 隐私与防泄露机制

为了杜绝在 GitHub 公开库中的敏感资产泄露，本项目内置了**无懈可击的安全 `.gitignore` 清单**，以下机密文件夹和个人数据已被全局强制忽略，禁止上传：
* `.env`（各提供商的 API 私钥）
* `.chrome_session/`（包含您在本地登录微信视频号生成的全部敏感 Cookie 状态）
* `workspace/`（包含您在本地制作的全部大纲、TTS 配音音频和成品视频成品）

---

## 📄 许可证

本项目基于 MIT 许可证开源。请遵守各大语言模型的使用规范以及视频号平台的合理使用指南进行创作。
