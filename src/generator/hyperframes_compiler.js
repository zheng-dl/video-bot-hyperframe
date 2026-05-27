import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

/**
 * 内部读取全局 system_config.json，获取对应的 API Key 与模型信息
 */
function getProviderConfig(provider = 'gemini') {
  const configPath = path.resolve('./config/system_config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing system config file at: ${configPath}`);
  }

  const systemConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const config = systemConfig.LLM_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  let apiKey = "";
  if (provider === 'gemini') {
    apiKey = process.env.GEMINI_API_KEY;
  } else if (provider === 'deepseek') {
    apiKey = process.env.DEEPSEEK_API_KEY;
  } else if (provider === 'gpt') {
    apiKey = process.env.GPT_API_KEY;
  }

  // 兜底策略
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
 * 兼容 OpenAI / DeepSeek 的接口请求封装，支持自动捕捉截断并追问补全
 */
async function callOpenAICompatible(provider, systemPrompt, userPrompt) {
  const config = getProviderConfig(provider);
  const url = `${config.api_url}/v1/chat/completions`;

  console.log(`[HyperFrames Compiler] Requesting OpenAI-compatible completions: ${url} (Model: ${config.model})`);

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
        temperature: 0.2, // 低温保障代码重构的严谨性
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
      console.log(`[HyperFrames Compiler] 检测到文本被截断 (finish_reason: length)。正在请求继续生成... (尝试 ${attempt + 1}/${MAX_ATTEMPTS})`);
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: "由于输出长度限制，你刚才的回答被截断了。请紧接着你刚才输出的最后一行代码，继续生成后面的内容，不要重复前面的内容，也不要用 markdown 代码块包裹。" });
      attempt++;
    } else {
      shouldContinue = false;
    }
  }

  return fullContent;
}

export async function compileToHyperFrames(interactiveHtmlPath, durations, provider = 'gemini', topicHfDir = 'hyperframes-native') {
  const interactiveHtml = fs.readFileSync(interactiveHtmlPath, 'utf-8');

  // 计算每幕的确切开始时间和持续时间
  let timelineContext = '';
  let currentStart = 0;
  for (let i = 0; i < durations.length; i++) {
    // 增加一点余量让声音不会那么紧凑
    const dur = parseFloat((durations[i] + 0.3).toFixed(2)); 
    timelineContext += `场景 [${i}]: data-start="${currentStart.toFixed(2)}", data-duration="${dur}"\n`;
    currentStart += dur;
  }
  const totalDuration = Math.ceil(currentStart + 1.0); // 留一点结尾

  // 从外部配置文件中动态加载提示词并注入变量，彻底解耦
  const promptPath = path.resolve('./config/hyperframes_compile_prompt.txt');
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Missing hyperframes compile prompt file at: ${promptPath}`);
  }
  let systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
  systemPrompt = systemPrompt.replace('${totalDuration}', totalDuration.toString()); // 动态替换总时长

  const userPrompt = `【时间轴要求】\n${timelineContext}\n总时长: ${totalDuration}s\n\n【交互式HTML源码】\n${interactiveHtml}\n\n请将以上源码严格按照 HyperFrames 规范重构并返回最终 HTML。`;

  const SCENE_REGEX = /<!--\s*=*\s*场景\s*\d+/g;
  
  let hfHtml = "";
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
      console.log(`[HyperFrames Compiler] Sending to Gemini (Attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
      
      const model = genAI.getGenerativeModel({ 
        model: config.model,
        systemInstruction: systemPrompt 
      });

      const response = await model.generateContent({
        contents: geminiContents,
        generationConfig: { temperature: 0.2 }
      });

      const candidate = response.response.candidates?.[0];
      currentResponse = response.response.text();
      const rawFinish = candidate?.finishReason;
      finishReason = (rawFinish === 'MAX_TOKENS' || rawFinish === 'LENGTH') ? 'length' : 'stop';
    } else {
      const config = getProviderConfig(provider);
      const url = `${config.api_url}/v1/chat/completions`;
      console.log(`[HyperFrames Compiler] Sending to ${provider} completions (Attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.api_key}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: openaiMessages,
          temperature: 0.2,
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

    hfHtml += cleanResponse;

    if (finishReason === "length") {
      console.log(`[HyperFrames Compiler] 检测到生成截断。进行场景对齐裁剪...`);
      
      let match;
      let lastSceneIndex = -1;
      const r = new RegExp(SCENE_REGEX.source, 'g');
      while ((match = r.exec(hfHtml)) !== null) {
        lastSceneIndex = match.index;
      }

      if (lastSceneIndex !== -1) {
        hfHtml = hfHtml.substring(0, lastSceneIndex);
        console.log(`[HyperFrames Compiler] 已成功裁剪不完整场景部分。`);
      }

      const completedCount = (hfHtml.match(SCENE_REGEX) || []).length;
      console.log(`[HyperFrames Compiler] 已完整编译 ${completedCount} 个场景。准备请求继续生成...`);

      const nextSceneNum = completedCount + 1;
      const continuePrompt = `由于输出长度限制，你刚才的编译回答被截断了。我们已经保留了前 ${completedCount} 个编译好的场景的 HTML。请从第 ${nextSceneNum} 个场景开始，紧接着编译剩余的场景并闭合 HTML，千万不要重复前面已经生成的场景，直接输出代码即可，不要用 markdown 代码块包裹。`;

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

  if (hfHtml.startsWith('```')) {
    const lines = hfHtml.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].startsWith('```')) lines.pop();
    hfHtml = lines.join('\n');
  }

  const outDir = path.resolve(topicHfDir);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const outputPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outputPath, hfHtml, 'utf-8');
  console.log(`[HyperFrames Compiler] HyperFrames HTML successfully compiled at ${outputPath}`);
  
  return outputPath;
}
