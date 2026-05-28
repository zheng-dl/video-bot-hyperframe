document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const tabBtnScript = document.getElementById("tab-btn-script");
  const tabBtnChannel = document.getElementById("tab-btn-channel");
  const tabBtnPlayer = document.getElementById("tab-btn-player");
  
  const tabContentScript = document.getElementById("tab-content-script");
  const tabContentChannel = document.getElementById("tab-content-channel");
  const tabContentPlayer = document.getElementById("tab-content-player");
  
  const promptInput = document.getElementById("prompt-input");
  const btnAiGenerate = document.getElementById("btn-ai-generate");
  const aiModelSelect = document.getElementById("ai-model-select");
  
  const publishModeSelect = document.getElementById("publish-mode");
  const archiveCollectionInput = document.getElementById("archive-collection");
  const voiceSelect = document.getElementById("voice-select");
  const speedSelect = document.getElementById("speed-select");
  
  const btnAddScene = document.getElementById("btn-add-scene");
  const scriptForm = document.getElementById("script-form");
  
  const btnExecuteHtml = document.getElementById("btn-execute-html");
  const btnExecuteAll = document.getElementById("btn-execute-all");
  const btnClearLogs = document.getElementById("btn-clear-logs");
  const enableResumeCache = document.getElementById("enable-resume-cache");
  
  const terminalLogBody = document.getElementById("terminal-log-body");
  const statusDot = document.querySelector(".status-dot");
  const statusText = document.getElementById("status-text");
  
  const iframePreview = document.getElementById("interactive-html-preview");
  const finalVideoPlayer = document.getElementById("final-video-player");
  const playerCurrentSource = document.getElementById("player-current-source");
  const playerInteractiveSource = document.getElementById("player-interactive-source");

  // Tab switcher
  const tabs = [
    { btn: tabBtnScript, content: tabContentScript },
    { btn: tabBtnChannel, content: tabContentChannel },
    { btn: tabBtnPlayer, content: tabContentPlayer }
  ];

  function switchTab(targetId) {
    tabs.forEach(tab => {
      if (tab.btn.id === targetId) {
        tab.btn.classList.add("active");
        tab.content.classList.remove("hidden");
      } else {
        tab.btn.classList.remove("active");
        tab.content.classList.add("hidden");
      }
    });
  }

  tabs.forEach(tab => {
    tab.btn.addEventListener("click", () => switchTab(tab.btn.id));
  });

  // Log functions
  function addLog(text, type = "") {
    const line = document.createElement("div");
    line.className = `terminal-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    terminalLogBody.appendChild(line);
    terminalLogBody.scrollTop = terminalLogBody.scrollHeight;
  }

  btnClearLogs.addEventListener("click", () => {
    terminalLogBody.innerHTML = '<div class="terminal-line system-msg">[系统] 日志已清空。</div>';
  });

  // Stage indicator controls
  function setStageState(stageId, state, statusTextVal) {
    const item = document.getElementById(`stage-${stageId}`);
    if (!item) return;
    
    item.classList.remove("running", "success", "error");
    const statusTextEl = item.querySelector(".item-status-text");
    if (statusTextEl && statusTextVal) {
      statusTextEl.textContent = statusTextVal;
    }

    if (state === "running") {
      item.classList.add("running");
    } else if (state === "success") {
      item.classList.add("success");
    } else if (state === "error") {
      item.classList.add("error");
    }
  }

  function resetAllStages() {
    ["html", "tts", "check", "render", "upload"].forEach(stage => {
      setStageState(stage, "", "等待开始");
    });
  }

  // 后台异常中断或失败应急响应函数，实现无魔法值卡片全线置红
  function handlePipelineFailure() {
    statusDot.className = "status-dot error";
    statusText.textContent = "后台任务异常中止";
    
    ["html", "tts", "check", "render", "upload"].forEach(stage => {
      const item = document.getElementById(`stage-${stage}`);
      if (item && (item.classList.contains("running") || (!item.classList.contains("success") && !item.classList.contains("error")))) {
        setStageState(stage, "error", "执行中断/失败");
      }
    });
  }

  // Load dynamic LLM models matrix
  async function loadLlmModels() {
    try {
      const res = await fetch("/api/llm-models");
      const data = await res.json();
      if (data.providers) {
        aiModelSelect.innerHTML = "";
        Object.keys(data.providers).forEach(key => {
          const opt = document.createElement("option");
          opt.value = key;
          opt.textContent = data.providers[key].name;
          if (key === data.active) {
            opt.selected = true;
          }
          aiModelSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.error("Failed to load LLM models list", e);
    }
  }

  loadLlmModels();

  // 自动拉取本地最新缓存的页面大纲与主题，恢复现场，规避硬编码
  async function loadCurrentOutlines() {
    try {
      const res = await fetch("/api/get-current-outlines");
      const data = await res.json();
      if (data.topic) {
        promptInput.value = data.topic;
      }
      if (data.outlines && data.outlines.length > 0) {
        renderOutlineCards(data.outlines);
        addLog(`[Client] 已自动加载本地最新生成的页面大纲与核心主题。`, "sys");
      }
    } catch (e) {
      console.error("Failed to load current outlines", e);
    }
  }

  loadCurrentOutlines();

  // SSE Connect
  let evtSource = null;
  function connectSSE() {
    if (evtSource) return;
    evtSource = new EventSource('/api/logs');
    
    evtSource.onopen = () => {
      addLog("[网络] 成功建立或恢复后台实时通信链路 (SSE)。", "sys");
      if (statusText.textContent.includes("断开") || statusText.textContent.includes("重连")) {
        statusDot.className = "status-dot";
        statusText.textContent = "控制后台运行正常";
      }
    };
    
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const log = data.log || "";
        
        let type = "";
        if (log.includes("[ERR") || log.includes("[error") || log.includes("失败") || log.includes("FATAL")) {
          type = "err";
        } else if (log.includes("[SYSTEM") || log.includes("启动") || log.includes("结束")) {
          type = "sys";
        }
        
        addLog(log, type);

        // Auto state transition matcher
        if (log.includes("--- 步骤 1") || log.includes("生成交互式 HTML")) {
          statusDot.className = "status-dot busy";
          statusText.textContent = "正在生成交互网页...";
          setStageState("html", "running", "大模型手绘网页中...");
        }
        if (log.includes("交互式演示生成完毕") || log.includes("发现已存在的交互式 HTML") || log.includes("已复用已存在 HTML")) {
          setStageState("html", "success", "交互网页生成完毕");
        }
        if (log.includes("--- 步骤 2") || log.includes("生成配音并测量精确时长")) {
          setStageState("html", "success", "交互网页生成完毕"); // 兜底保障
          setStageState("tts", "running", "配音合成中...");
        }
        if (log.includes("音频处理完毕") || log.includes("Concatenating") || log.includes("已存在主音频与时长缓存")) {
          setStageState("tts", "success", "口播合成成功");
        }
        if (log.includes("--- 步骤 3") || log.includes("LLM 编译器转换为 HyperFrames")) {
          setStageState("check", "running", "正在转换为 HyperFrames 格式...");
        }
        // 拦截动态路径广播协议，免魔法值更新预览源
        if (log.includes("[OUTPUT_HTML_PATH]:")) {
          const htmlPath = log.split("[OUTPUT_HTML_PATH]:")[1].trim();
          iframePreview.src = htmlPath + "?" + new Date().getTime();
          playerInteractiveSource.textContent = `当前交互源：${htmlPath} (就绪)`;
        }
        if (log.includes("[OUTPUT_VIDEO_PATH]:")) {
          const videoPath = log.split("[OUTPUT_VIDEO_PATH]:")[1].trim();
          finalVideoPlayer.src = videoPath + "?" + new Date().getTime();
          playerCurrentSource.textContent = `当前视频源：${videoPath} (就绪)`;
        }

        if (log.includes("HyperFrames 源文件编译完毕") || log.includes("已编译 of HyperFrames 页面") || log.includes("已编译的 HyperFrames 页面")) {
          setStageState("check", "success", "HyperFrames 适配编译成功");
        }
        if (log.includes("--- 步骤 4") || log.includes("渲染无声视频")) {
          setStageState("render", "running", "Playwright 驱动渲染帧...");
        }
        if (log.includes("视频帧渲染完毕") || log.includes("已存在已渲染 of 无声视频") || log.includes("已存在已渲染的无声视频")) {
          setStageState("render", "success", "视频帧抓取成功");
        }
        if (log.includes("--- 步骤 5") || log.includes("混合音频与视频")) {
          setStageState("render", "success", "合成最终 MP4 视频中...");
        }
        if (log.includes("最终视频产出")) {
          setStageState("render", "success", "视频合成成功");
        }
        if (log.includes("--- 步骤 6") || log.includes("自动发布到视频号")) {
          setStageState("upload", "running", "视频号自动挂载上传中...");
        }
        if (log.includes("发布成功") || log.includes("流程执行完毕")) {
          setStageState("upload", "success", "最终发布成功");
          statusDot.className = "status-dot";
          statusText.textContent = "控制后台运行正常";
        }
        // Handle skip-render bypass matching，精准匹配真正跳过渲染时的唯一日志，规避“免渲染测试: 否”引发的前端状态误判
        if (log.includes("已应用 --skip-render 开关") || log.includes("跳过耗时的浏览器视频渲染。")) {
          setStageState("render", "success", "已跳过 (免渲染测试)");
          setStageState("upload", "success", "已跳过 (免渲染测试)");
          statusDot.className = "status-dot";
          statusText.textContent = "控制后台运行正常";
        }
        
        // 捕获各种致命和通用报错，执行卡片全置红与警报应急处理，杜绝无限转圈卡死
        if (log.includes("[SYSTEM_FATAL_ERR]") || log.includes("[Main ERR]") || log.includes("流程执行失败") || log.includes("异常")) {
          handlePipelineFailure();
        }
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    evtSource.onerror = () => {
      console.warn("SSE disconnected. Reconnecting...");
      statusDot.className = "status-dot busy";
      statusText.textContent = "通信意外断开，正在尝试自动重连...";
      addLog("[网络异常] 实时通信链路断开，正在自动尝试重连...", "err");
      
      evtSource.close();
      evtSource = null;
      setTimeout(connectSSE, 3000);
    };
  }

  connectSSE();

  // Scene outline DOM helper
  function renderOutlineCards(outlines) {
    scriptForm.innerHTML = "";
    if (!outlines || outlines.length === 0) {
      scriptForm.innerHTML = '<div class="no-data-tip">等待生成页面大纲...</div>';
      return;
    }
    
    outlines.forEach((title, index) => {
      addOutlineCard(title, index + 1);
    });
  }

  function addOutlineCard(title = "", pageNum = null) {
    const noData = scriptForm.querySelector(".no-data-tip");
    if (noData) noData.remove();

    const actualNum = pageNum || (scriptForm.querySelectorAll(".scene-card").length + 1);
    const card = document.createElement("div");
    card.className = "scene-card";
    card.innerHTML = `
      <div class="scene-card-header">
        <span class="scene-number">PAGE ${actualNum}</span>
        <button class="scene-delete" type="button">删除当前页</button>
      </div>
      <div class="form-group">
        <label>页面大纲主题 (Slide Title / 极简描述)</label>
        <input type="text" class="scene-title-input" value="${title}" placeholder="如：Redis 的单线程为什么快，或者 简单画一下持久化原理">
      </div>
    `;

    // Bind delete event
    card.querySelector(".scene-delete").addEventListener("click", () => {
      card.remove();
      // Re-index remaining pages
      scriptForm.querySelectorAll(".scene-card").forEach((c, idx) => {
        c.querySelector(".scene-number").textContent = `PAGE ${idx + 1}`;
      });
      if (scriptForm.querySelectorAll(".scene-card").length === 0) {
        scriptForm.innerHTML = '<div class="no-data-tip">等待生成页面大纲...</div>';
      }
    });

    scriptForm.appendChild(card);
  }

  btnAddScene.addEventListener("click", () => {
    addOutlineCard("");
  });

  // Action 1: Generate Outline
  btnAiGenerate.addEventListener("click", async () => {
    const topic = promptInput.value.trim();
    if (!topic) {
      alert("请输入核心技术主题或大纲点子！");
      return;
    }

    btnAiGenerate.disabled = true;
    btnAiGenerate.innerHTML = `⏳ 正在梳理页面大纲...`;
    
    const provider = aiModelSelect.value;
    try {
      addLog(`[Client] 正在以大脑 [${provider}] 为主题《${topic}》规划大纲...`, "sys");
      const res = await fetch("/api/generate-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, provider })
      });
      const data = await res.json();
      
      if (data.error) {
        addLog(`[AI Outline ERR] ${data.error}`, "err");
        alert(data.error);
      } else {
        renderOutlineCards(data.outlines);
        addLog(`[AI Outline] 大纲生成成功！共规划了 ${data.outlines.length} 页技术主题。请在右侧第一 Tab 微调。`, "sys");
        switchTab("tab-btn-script");
      }
    } catch (err) {
      addLog(`[Network Error] ${err.message}`, "err");
    } finally {
      btnAiGenerate.disabled = false;
      btnAiGenerate.innerHTML = `✨ 1. 智能生成页面大纲`;
    }
  });

  // Helper to extract outlines from form
  function getOutlinesFromForm() {
    const inputs = scriptForm.querySelectorAll(".scene-title-input");
    const arr = [];
    inputs.forEach(input => {
      const val = input.value.trim();
      if (val) arr.push(val);
    });
    return arr;
  }

  // Core execution flow trigger
  async function triggerExecution(skipRender) {
    const outlines = getOutlinesFromForm();
    if (outlines.length === 0) {
      alert("大纲中至少需要包含一个页面主题！");
      return;
    }

    const topic = promptInput.value.trim();
    const publishMode = publishModeSelect.value;
    const collectionName = archiveCollectionInput.value.trim();
    const voice = voiceSelect.value;
    const speed = speedSelect.value;
    const resume = enableResumeCache ? enableResumeCache.checked : false;

    btnExecuteHtml.disabled = true;
    btnExecuteAll.disabled = true;
    resetAllStages();
    
    switchTab("tab-btn-channel");
    addLog(`[Client] 开始提交流程，大纲页数: ${outlines.length}, skipRender: ${skipRender}, resume: ${resume}`, "sys");

    const provider = aiModelSelect.value;
    try {
      const res = await fetch("/api/generate-html-by-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlines,
          topic,
          publishMode,
          collectionName,
          voice,
          speed,
          skipRender,
          provider,
          resume
        })
      });
      
      const data = await res.json();
      if (data.error) {
        addLog(`[Client API ERR] ${data.error}`, "err");
        alert(data.error);
      } else {
        addLog(`[Client] 管道流程任务已派生启动！请实时关注下方 SSE 控制台。`, "sys");
      }
    } catch (err) {
      addLog(`[Network Error] ${err.message}`, "err");
    } finally {
      btnExecuteHtml.disabled = false;
      btnExecuteAll.disabled = false;
    }
  }

  btnExecuteHtml.addEventListener("click", () => triggerExecution(true));
  btnExecuteAll.addEventListener("click", () => triggerExecution(false));
});
