import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { getVideoLayoutConfig, readSystemConfig } from '../utils/system_config.js';

/**
 * 动态加载并应用 .env 覆盖后的 LLM 密钥与配置，杜绝魔法值与硬编码
 */
function getProviderConfig(provider = 'gemini') {
  const systemConfig = readSystemConfig();
  const config = systemConfig.LLM_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  // 依据提供商自动挂载对应 .env 环境密钥
  let apiKey = "";
  if (provider === 'gemini') {
    apiKey = process.env.GEMINI_API_KEY;
  } else if (provider === 'deepseek') {
    apiKey = process.env.DEEPSEEK_API_KEY;
  } else if (provider === 'gpt') {
    apiKey = process.env.GPT_API_KEY;
  }

  // 兜底降级策略
  if (!apiKey || apiKey.trim() === "") {
    apiKey = config.api_key && !config.api_key.includes("YOUR_") ? config.api_key : process.env.API_KEY;
  }

  if (!apiKey || apiKey.trim() === "" || apiKey.includes("HERE") || apiKey.includes("KEY")) {
    throw new Error(`您尚未在 .env 或 system_config.json 中配置 ${provider} 的真实 API_KEY。`);
  }

  return {
    name: config.name,
    model: config.model,
    api_url: config.api_url,
    api_key: apiKey
  };
}

/**
 * 清理模型自带的预览缩放脚本与旧运行时，避免和统一注入的预览逻辑互相打架
 */
export function stripPreviewRuntimeConflicts(htmlContent) {
  let normalizedHtml = htmlContent
    .replace(/<style id="hf-preview-runtime-style">[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<script id="hf-preview-runtime-script">[\s\S]*?<\/script>\s*/gi, '')
    .replace(/<!--\s*(?:响应式缩放脚本|小巧的缩放 JS|小巧的缩放脚本|预览缩放脚本)[\s\S]*?-->\s*/gi, '');

  const previewScaleScriptPattern = /<script>\s*[\s\S]*?(?:const shell = document\.getElementById\(['"]previewShell['"]\)|const shell = document\.querySelector\(['"]\.preview-shell['"]\)|function fitShell\(|const BASE_W\s*=\s*\d+\s*,\s*BASE_H\s*=\s*\d+|window\.addEventListener\(['"]resize['"]\s*,\s*fitShell|stage\.style\.transform\s*=\s*`translateX\(-50%\) scale\(\$\{scale\}\)`)[\s\S]*?<\/script>\s*/gi;

  normalizedHtml = normalizedHtml.replace(previewScaleScriptPattern, '');
  return normalizedHtml;
}

/**
 * 为交互式 HTML 注入稳定的预览缩放运行时，避免固定舞台在窄窗口和 iframe 中被裁切不可见
 */
function injectPreviewRuntime(htmlContent, videoLayout) {
  if (!htmlContent.includes('class="preview-shell"') || !htmlContent.includes('id="video-stage"')) {
    console.log('[AI Generator] 未检测到 preview-shell / video-stage，跳过预览缩放运行时注入。');
    return htmlContent;
  }

  const previewRuntimeStyle = `
<style id="hf-preview-runtime-style">
  html, body {
    width: 100%;
    min-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }
  body {
    margin: 0;
    display: flex !important;
    flex-direction: column;
    align-items: center !important;
    justify-content: flex-start !important;
  }
  .preview-shell {
    position: relative !important;
    display: block !important;
    width: ${videoLayout.stage_width}px;
    height: ${videoLayout.stage_height}px;
    max-width: none !important;
    padding: 0 !important;
    margin: 24px auto !important;
    flex: 0 0 auto;
    transform: none !important;
  }
  #video-stage {
    position: absolute !important;
    top: 0;
    left: 0;
    width: ${videoLayout.stage_width}px;
    height: ${videoLayout.stage_height}px;
    transform-origin: top left !important;
  }
</style>
`.trim();

  const previewRuntimeScript = `
<script id="hf-preview-runtime-script">
(function () {
  const shell = document.querySelector('.preview-shell');
  const stage = document.querySelector('#video-stage');
  if (!shell || !stage) return;

  const stageWidth = ${videoLayout.stage_width};
  const stageHeight = ${videoLayout.stage_height};
  const previewMargin = 24;

  // 用外层壳体承接缩放后的物理尺寸，避免 transform 后布局尺寸仍按原始舞台计算而被 iframe 裁掉
  function syncPreviewScale() {
    const availableWidth = Math.max(window.innerWidth - previewMargin * 2, 320);
    const availableHeight = Math.max(window.innerHeight - previewMargin * 2, 320);
    const scale = Math.min(availableWidth / stageWidth, availableHeight / stageHeight, 1);
    const scaledWidth = Math.max(1, Math.round(stageWidth * scale));
    const scaledHeight = Math.max(1, Math.round(stageHeight * scale));

    shell.style.width = scaledWidth + 'px';
    shell.style.height = scaledHeight + 'px';
    shell.style.margin = previewMargin + 'px auto';
    stage.style.left = '0';
    stage.style.top = '0';
    stage.style.transformOrigin = 'top left';
    stage.style.transform = 'scale(' + scale + ')';
    document.body.style.minHeight = Math.max(window.innerHeight, scaledHeight + previewMargin * 2) + 'px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncPreviewScale, { once: true });
  } else {
    syncPreviewScale();
  }

  window.addEventListener('resize', syncPreviewScale, { passive: true });
})();
</script>
`.trim();

  let normalizedHtml = stripPreviewRuntimeConflicts(htmlContent);
  if (normalizedHtml.includes('</head>')) {
    normalizedHtml = normalizedHtml.replace('</head>', `${previewRuntimeStyle}\n</head>`);
  } else {
    normalizedHtml = `${previewRuntimeStyle}\n${normalizedHtml}`;
  }

  if (normalizedHtml.includes('</body>')) {
    normalizedHtml = normalizedHtml.replace('</body>', `${previewRuntimeScript}\n</body>`);
  } else {
    normalizedHtml = `${normalizedHtml}\n${previewRuntimeScript}`;
  }

  console.log('[AI Generator] 已注入稳定预览缩放运行时，确保 HTML 在窄窗口与 iframe 中可见。');
  return normalizedHtml;
}

/**
 * OpenAI / DeepSeek 兼容接口请求统一封装，支持自动捕捉截断并追问补全
 */
async function callOpenAICompatible(provider, systemPrompt, userPrompt) {
  const config = getProviderConfig(provider);
  const url = `${config.api_url}/v1/chat/completions`;

  console.log(`[AI Generator] Requesting OpenAI-compatible completions: ${url} (Model: ${config.model})`);

  const MAX_ATTEMPTS = 5;
  const MAX_OUTPUT_TOKENS = 8192;

  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  let fullContent = "";
  let shouldContinue = true;
  let attempt = 0;

  while (shouldContinue && attempt < MAX_ATTEMPTS) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.api_key}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${provider} API 响应错误(${response.status}): ${errText}`);
    }

    const resObj = await response.json();
    const choice = resObj.choices?.[0];
    const text = choice?.message?.content || "";
    if (!text && fullContent === "") {
      throw new Error(`${provider} 返回内容为空。`);
    }

    fullContent += text;
    const finishReason = choice?.finish_reason;

    if (finishReason === "length") {
      console.log(`[AI Generator] 检测到文本被截断 (finish_reason: length)。正在请求继续生成... (尝试 ${attempt + 1}/${MAX_ATTEMPTS})`);
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: "由于输出长度限制，你刚才的回答被截断了。请紧接着你刚才输出的最后一行代码，继续生成后面的内容，不要重复前面的内容，也不要用 markdown 代码块包裹。" });
      attempt++;
    } else {
      shouldContinue = false;
    }
  }

  return fullContent;
}

/**
 * 核心大模型生成第一步：仅生成一串纯页面大纲主题名字（JSON 数组）
 */
export async function generateOutline(topic, provider = 'gemini') {
  // 从外部配置文件中读取提示词，彻底解耦
  const promptPath = path.resolve('./config/outline_prompt.txt');
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Missing outline prompt file at: ${promptPath}`);
  }
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();

  const userPrompt = `请为技术主题【${topic}】规划极简的页面大纲列表。`;

  let rawText = "";

  if (provider === 'gemini') {
    const config = getProviderConfig('gemini');
    const genAI = new GoogleGenerativeAI(config.api_key);
    console.log(`[AI Generator] Requesting Gemini (${config.model}) to generate page outline for: ${topic}...`);
    
    const model = genAI.getGenerativeModel({ 
      model: config.model,
      systemInstruction: systemPrompt 
    });

    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json"
      }
    });
    rawText = response.response.text().trim();
  } else {
    rawText = await callOpenAICompatible(provider, systemPrompt, userPrompt);
    rawText = rawText.trim();
  }

  try {
    const outlines = JSON.parse(rawText);
    if (Array.isArray(outlines)) {
      console.log(`[AI Generator] Outline successfully generated with ${outlines.length} pages.`);
      return outlines;
    }
    throw new Error("Returned content is not a JSON Array.");
  } catch (err) {
    console.error("[AI Generator] Failed to parse outlines JSON. Raw response:", rawText);
    // Fallback cleanup
    const cleanText = rawText.replace(/```json|```html|```/gi, "").trim();
    try {
      return JSON.parse(cleanText);
    } catch {
      throw new Error(`Failed to parse AI generated outlines: ${err.message}`);
    }
  }
}

/**
 * 核心大模型生成第二步：根据微调后的页面主题列表，AI 自主绘制 SVG 架构图、手写 CSS 发光动效，并自主配好专业旁白台词，生成精美的 HTML
 */
export async function generateInteractiveDemoByOutline(outlines, voice = 'zh-CN-YunxiNeural', provider = 'gemini', topicWorkspace = 'workspace') {
  // 从外部配置文件中读取提示词并动态加载口播音色变量，彻底解耦
  const promptPath = path.resolve('./config/interactive_html_prompt.txt');
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Missing interactive HTML prompt file at: ${promptPath}`);
  }
  const videoLayout = getVideoLayoutConfig();
  let systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
  systemPrompt = systemPrompt
    .replaceAll('${voice}', voice)
    .replaceAll('${stageWidth}', String(videoLayout.stage_width))
    .replaceAll('${stageHeight}', String(videoLayout.stage_height))
    .replaceAll('${aspectRatio}', String(videoLayout.aspect_ratio))
    .replaceAll('${safePaddingX}', String(videoLayout.safe_padding_x))
    .replaceAll('${safePaddingY}', String(videoLayout.safe_padding_y)); // 动态注入画幅与安全区约束

  const userPrompt = `【已微调的页面主题列表】\n${JSON.stringify(outlines, null, 2)}\n\n请以此大纲为基础，生成完整的、带自动配音旁白和精美 SVG 动画的交互式分镜 HTML 文件。`;

  const SCENE_REGEX = /<!--\s*=*\s*场景\s*\d+/g;
  
  let htmlContent = "";
  const MAX_ATTEMPTS = 5;
  let attempt = 0;
  let shouldContinue = true;
  
  let openaiMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
  let geminiContents = [
    { role: "user", parts: [{ text: userPrompt }] }
  ];

  while (shouldContinue && attempt < MAX_ATTEMPTS) {
    let currentResponse = "";
    let finishReason = "";

    if (provider === 'gemini') {
      const config = getProviderConfig('gemini');
      const genAI = new GoogleGenerativeAI(config.api_key);
      console.log(`[AI Generator] Requesting Gemini (${config.model}) to synthesize HTML (Attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
      
      const model = genAI.getGenerativeModel({ 
        model: config.model,
        systemInstruction: systemPrompt 
      });

      const response = await model.generateContent({
        contents: geminiContents,
        generationConfig: { temperature: 0.7 }
      });

      const candidate = response.response.candidates?.[0];
      currentResponse = response.response.text();
      const rawFinish = candidate?.finishReason;
      finishReason = (rawFinish === 'MAX_TOKENS' || rawFinish === 'LENGTH') ? 'length' : 'stop';
    } else {
      const config = getProviderConfig(provider);
      const url = `${config.api_url}/v1/chat/completions`;
      console.log(`[AI Generator] Requesting ${provider} completions (Attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.api_key}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: openaiMessages,
          temperature: 0.7,
          max_tokens: 8192
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${provider} API 响应错误(${response.status}): ${errText}`);
      }

      const resObj = await response.json();
      const choice = resObj.choices?.[0];
      currentResponse = choice?.message?.content || "";
      finishReason = choice?.finish_reason || "stop";
    }

    if (!currentResponse) {
      throw new Error(`AI 返回内容为空。`);
    }

    let cleanResponse = currentResponse.trim();
    if (cleanResponse.startsWith('```')) {
      const lines = cleanResponse.split('\n');
      if (lines[0].startsWith('```')) lines.shift();
      if (lines[lines.length - 1].startsWith('```')) lines.pop();
      cleanResponse = lines.join('\n');
    }

    htmlContent += cleanResponse;

    if (finishReason === "length") {
      console.log(`[AI Generator] 检测到生成截断。进行场景对齐裁剪...`);
      
      let match;
      let lastSceneIndex = -1;
      const r = new RegExp(SCENE_REGEX.source, 'g');
      while ((match = r.exec(htmlContent)) !== null) {
        lastSceneIndex = match.index;
      }

      if (lastSceneIndex !== -1) {
        htmlContent = htmlContent.substring(0, lastSceneIndex);
        console.log(`[AI Generator] 已成功裁剪不完整场景部分。`);
      }

      const completedCount = (htmlContent.match(SCENE_REGEX) || []).length;
      console.log(`[AI Generator] 已完整生成 ${completedCount} 个场景。准备请求继续生成...`);

      const nextSceneNum = completedCount + 1;
      const continuePrompt = `由于输出长度限制，你刚才的回答被截断了。我们已经保留了前 ${completedCount} 个完整场景的 HTML。请从第 ${nextSceneNum} 个场景开始，紧接着生成剩余场景的 HTML 及最后的闭合标签，千万不要重复前面已经生成的场景，直接输出代码即可，不要用 markdown 代码块包裹。`;

      if (provider === 'gemini') {
        geminiContents.push({ role: 'model', parts: [{ text: currentResponse }] });
        geminiContents.push({ role: 'user', parts: [{ text: continuePrompt }] });
      } else {
        openaiMessages.push({ role: "assistant", content: currentResponse });
        openaiMessages.push({ role: "user", content: continuePrompt });
      }

      attempt++;
    } else {
      shouldContinue = false;
    }
  }
  
  // 清理 Markdown 代码块包裹 (如果存在的话)
  if (htmlContent.startsWith('```')) {
    const lines = htmlContent.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].startsWith('```')) lines.pop();
    htmlContent = lines.join('\n');
  }

  // 1. 强力清洗大模型因为截断可能在末尾留下的、未闭合或有语法错误的半截 script
  htmlContent = htmlContent.replace(/<script>(?:(?!<\/script>)[\s\S])*?$/i, '');
  // 同时清理可能存在的有潜在截断异常的控制脚本
  htmlContent = htmlContent.replace(/<script>[^<]*?(?:window\.addEventListener|document\.querySelector)[^<]*?<\/script>\s*<\/body>/i, '</body>');

  // 2. 注入绝对完整、高可靠的全局空格、方向键以及点击屏幕左右半区翻页脚本
  const pageControlScript = `
<script>
(function() {
  const scenes = document.querySelectorAll('.scene');
  let currentIndex = 0;
  const total = scenes.length;

  function showScene(index) {
    if (index < 0) index = 0;
    if (index >= total) index = total - 1;
    scenes.forEach((s, i) => {
      s.classList.toggle('active', i === index);
    });
    currentIndex = index;
  }

  // 键盘空格与方向键监听
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      showScene(currentIndex + 1);
    } else if (e.code === 'ArrowLeft' || e.key === 'ArrowLeft') {
      e.preventDefault();
      showScene(currentIndex - 1);
    } else if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
      e.preventDefault();
      showScene(currentIndex + 1);
    }
  });

  // 鼠标点击翻页 (点击屏幕右半区前进，左半区后退)
  document.body.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.closest('.card') || e.target.closest('input')) return;
    const midPoint = window.innerWidth / 2;
    if (e.clientX > midPoint) {
      showScene(currentIndex + 1);
    } else {
      showScene(currentIndex - 1);
    }
  });

  const initialActiveIndex = Array.from(scenes).findIndex((scene) => scene.classList.contains('active'));
  showScene(initialActiveIndex >= 0 ? initialActiveIndex : 0);
})();
</script>
`;

  if (htmlContent.includes('</body>')) {
    htmlContent = htmlContent.replace('</body>', `${pageControlScript}\n</body>`);
  } else {
    htmlContent = htmlContent.trim() + `\n${pageControlScript}\n</body>\n</html>`;
  }

  // 对大模型产物做最后一层预览壳修正，保证独立打开和前端 iframe 预览都稳定可见
  htmlContent = injectPreviewRuntime(htmlContent, videoLayout);

  // 保存到 workspace
  const workspaceDir = path.resolve(topicWorkspace);
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  
  const outputPath = path.join(workspaceDir, 'interactive_demo.html');
  fs.writeFileSync(outputPath, htmlContent, 'utf-8');
  console.log(`[AI Generator] Phase 4 HTML generated successfully with robust page-control injected at ${outputPath}`);
  
  return outputPath;
}
