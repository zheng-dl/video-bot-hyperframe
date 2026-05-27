import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { generateInteractiveDemoByOutline } from './src/generator/ai_generator.js';
import { processAudio } from './src/generator/audio_processor.js';
import { compileToHyperFrames } from './src/generator/hyperframes_compiler.js';
import { renderHyperFrames } from './src/render/renderer.js';
import { mixAudioAndVideo } from './src/render/mixer.js';
import { ChannelsUploader } from './src/publish/channels_uploader.js';

// 极简命令行参数解析，防止硬编码
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--outlines' && i + 1 < argv.length) {
      args.outlinesPath = argv[i + 1];
      i++;
    } else if (arg === '--publishMode' && i + 1 < argv.length) {
      args.publishMode = argv[i + 1];
      i++;
    } else if (arg === '--collectionName' && i + 1 < argv.length) {
      args.collectionName = argv[i + 1];
      i++;
    } else if (arg === '--voice' && i + 1 < argv.length) {
      args.voice = argv[i + 1];
      i++;
    } else if (arg === '--speed' && i + 1 < argv.length) {
      args.speed = argv[i + 1];
      i++;
    } else if (arg === '--provider' && i + 1 < argv.length) {
      args.provider = argv[i + 1];
      i++;
    } else if (arg === '--skip-render') {
      args.skipRender = true;
    } else if (arg === '--resume') {
      args.resume = true;
    } else if (arg === '--topic' && i + 1 < argv.length) {
      args.topic = argv[i + 1];
      i++;
    }
  }
  return args;
}

function sanitizeTopic(topic) {
  if (!topic) return "default_topic";
  // 只保留中文、英文字母、数字和短横线、下划线，彻底杜绝硬编码字符
  let clean = topic.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '').trim();
  if (!clean) clean = "default_topic";
  return clean.substring(0, 50);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  let outlines = [];
  if (parsed.outlinesPath && fs.existsSync(parsed.outlinesPath)) {
    try {
      const rawData = JSON.parse(fs.readFileSync(parsed.outlinesPath, 'utf-8'));
      // 兼容可能仅包含数组的旧版大纲格式，杜绝魔法值
      if (Array.isArray(rawData)) {
        outlines = rawData;
      } else {
        outlines = rawData.outlines || [];
      }
    } catch (e) {
      console.error(`[Main ERR] 无法读取大纲配置文件:`, e.message);
      process.exit(1);
    }
  } else {
    // 降级兜底大纲，绝对不带硬编码，做安全校验
    console.error(`[Main ERR] 必须指定合法的 --outlines 配置文件路径。`);
    process.exit(1);
  }

  const publishMode = parsed.publishMode || "draft";
  const collectionName = parsed.collectionName || "";
  const voice = parsed.voice || "zh-CN-YunxiNeural";
  const skipRender = parsed.skipRender || false;
  const provider = parsed.provider || "gemini";
  const resume = parsed.resume || false;
  const topic = parsed.topic || "";

  // 依据主题建立专属子目录，规避覆盖与混淆问题
  const safeTopicDir = sanitizeTopic(topic || (outlines[0] ? outlines[0] : "default_topic"));
  const topicWorkspace = path.resolve('workspace', safeTopicDir);
  const topicHfDir = path.resolve('hyperframes-native', safeTopicDir);

  if (!fs.existsSync(topicWorkspace)) fs.mkdirSync(topicWorkspace, { recursive: true });
  if (!fs.existsSync(topicHfDir)) fs.mkdirSync(topicHfDir, { recursive: true });

  console.log(`\n==========================================`);
  console.log(`[Main] 启动自动化视频生成双阶管道流程`);
  console.log(`[Main] 核心主题: ${topic || '未指定'}`);
  console.log(`[Main] 主题工作目录: ${topicWorkspace}`);
  console.log(`[Main] 大纲页数: ${outlines.length} 页`);
  console.log(`[Main] 创作大脑: ${provider}`);
  console.log(`[Main] 口播配置: 音色=${voice}, 发布模式=${publishMode}, 合集=${collectionName || '无'}`);
  console.log(`[Main] 跳过渲染 (免渲染测试): ${skipRender ? "是" : "否"}`);
  console.log(`[Main] 启用断点续作复用缓存: ${resume ? "是" : "否"}`);
  console.log(`==========================================\n`);

  try {
    // 1. 根据微调后的大纲，大模型生成交互式演示 HTML (AI-Native 视觉与隐藏旁白设计)
    const cachedHtmlPath = path.join(topicWorkspace, 'interactive_demo.html');
    let interactiveHtmlPath = cachedHtmlPath;
    
    if (resume && fs.existsSync(cachedHtmlPath)) {
      console.log(`\n--- [断点复用] 步骤 1: 发现已存在的交互式 HTML，跳过 LLM 生成 ---`);
      console.log(`[Main] 已复用已存在 HTML: ${cachedHtmlPath}`);
    } else {
      console.log(`\n--- 步骤 1: LLM 生成交互式 HTML ---`);
      interactiveHtmlPath = await generateInteractiveDemoByOutline(outlines, voice, provider, topicWorkspace);
      console.log(`[Main] 交互式演示生成完毕: ${interactiveHtmlPath}`);
    }
    // 动态日志广播协议头输出给前端，实现免魔法值预览
    console.log(`[OUTPUT_HTML_PATH]: /workspace/${safeTopicDir}/interactive_demo.html`);

    // 2. 音频处理 (TTS + 测时)
    const cachedMasterAudio = path.join(topicWorkspace, 'master_audio.mp3');
    const audioMetaPath = path.join(topicWorkspace, 'audio_meta.json');
    let audioResult = null;

    if (resume && fs.existsSync(cachedMasterAudio) && fs.existsSync(audioMetaPath)) {
      console.log(`\n--- [断点复用] 步骤 2: 发现已存在的主音频与时长缓存，跳过 TTS 生成 ---`);
      console.log(`[Main] 已复用音频文件: ${cachedMasterAudio}`);
      audioResult = JSON.parse(fs.readFileSync(audioMetaPath, 'utf-8'));
    } else {
      console.log(`\n--- 步骤 2: 生成配音并测量精确时长 ---`);
      audioResult = await processAudio(interactiveHtmlPath, topicWorkspace);
      // 写入轻量级元数据缓存以便断点续作复用
      fs.writeFileSync(audioMetaPath, JSON.stringify(audioResult, null, 2), 'utf-8');
      console.log(`[Main] 音频处理完毕. 新的音频与元数据已成功缓存。`);
    }
    const { durations, masterAudioPath, meta } = audioResult;
    console.log(`[Main] 当前音频总幕数: ${durations.length}, 主音频路径: ${masterAudioPath}`);

    // 3. AI-Native 编译器 (重构为 HyperFrames 规范源文件)
    const cachedHfHtml = path.join(topicHfDir, 'index.html');
    let hfHtmlPath = cachedHfHtml;

    if (resume && fs.existsSync(cachedHfHtml)) {
      console.log(`\n--- [断点复用] 步骤 3: 发现已编译的 HyperFrames HTML，跳过 LLM 编译器 ---`);
      console.log(`[Main] 已复用已编译 HTML: ${cachedHfHtml}`);
    } else {
      console.log(`\n--- 步骤 3: LLM 编译器转换为 HyperFrames ---`);
      hfHtmlPath = await compileToHyperFrames(interactiveHtmlPath, durations, provider, topicHfDir);
      console.log(`[Main] HyperFrames 源文件编译完毕: ${hfHtmlPath}`);
    }

    // 免渲染极速测试开关判定
    if (skipRender) {
      console.log(`\n==========================================`);
      console.log(`[Main] 页面大纲编译与交互 HTML 预览构建完成！`);
      console.log(`[Main] 已应用 --skip-render 开关，跳过耗时的浏览器视频渲染。`);
      console.log(`[Main] 您现在可以直接在右侧 Tab 2 查看 0 延时的高清交互网页分镜！`);
      console.log(`==========================================\n`);
      return;
    }

    // 4. 视频渲染
    const cachedSilentVideoPath = path.join(topicWorkspace, 'silent_video.mp4');
    let silentVideoPath = cachedSilentVideoPath;

    if (resume && fs.existsSync(cachedSilentVideoPath)) {
      console.log(`\n--- [断点复用] 步骤 4: 发现已渲染的无声视频，跳过 Playwright 渲染 ---`);
      console.log(`[Main] 已复用无声视频: ${cachedSilentVideoPath}`);
    } else {
      console.log(`\n--- 步骤 4: 渲染无声视频 ---`);
      const renderedVideo = await renderHyperFrames(topicHfDir);
      
      // 1. 如果返回的是正常的物理路径字符串，直接复制并应用，规避魔法值
      if (typeof renderedVideo === 'string' && fs.existsSync(renderedVideo)) {
        fs.copyFileSync(renderedVideo, cachedSilentVideoPath);
        silentVideoPath = cachedSilentVideoPath;
        console.log(`[Main] 无声视频已成功转移到工作空间: ${cachedSilentVideoPath}`);
      } else {
        // 2. 双重兼容兜底：如果返回了 true，尝试遍历 renders 目录与根目录自动捕获刚生成的文件
        const searchDirs = [
          path.join(topicHfDir, 'renders'),
          topicHfDir
        ];
        let foundPath = null;
        let maxMtime = 0;
        for (const dir of searchDirs) {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              if (file.toLowerCase().endsWith('.mp4')) {
                const fullPath = path.join(dir, file);
                try {
                  const stat = fs.statSync(fullPath);
                  if (stat.isFile() && stat.mtimeMs > maxMtime) {
                    maxMtime = stat.mtimeMs;
                    foundPath = fullPath;
                  }
                } catch (e) {
                  // 忽略异常
                }
              }
            }
          }
        }
        
        if (foundPath) {
          fs.copyFileSync(foundPath, cachedSilentVideoPath);
          silentVideoPath = cachedSilentVideoPath;
          console.log(`[Main] 兜底扫描并转移了最新视频分镜: ${cachedSilentVideoPath}`);
        } else {
          // 3. 实在找不到，直接抛出业务异常，杜绝将布尔值传给 ffmpeg
          throw new Error(`[Main ERR] 无法找到渲染出的无声视频文件。请检查 hyperframes 渲染结果。`);
        }
      }
      console.log(`[Main] 视频帧渲染完毕: ${silentVideoPath}`);
    }

    // 5. 混合音视频
    console.log(`\n--- 步骤 5: 混合音频与视频 ---`);
    const finalVideoPath = path.join(topicWorkspace, 'final_video.mp4');
    await mixAudioAndVideo(silentVideoPath, masterAudioPath, finalVideoPath);
    console.log(`[Main] 最终视频产出: ${finalVideoPath}`);
    // 动态日志广播协议头输出给前端，动态挂载视频成片
    console.log(`[OUTPUT_VIDEO_PATH]: /workspace/${safeTopicDir}/final_video.mp4`);

    // 6. 发布到视频号
    console.log(`\n--- 步骤 6: 自动发布到视频号 ---`);
    const title = meta.title || `科普视频`;
    const description = meta.description || `技术科普 #编程`;
    const uploader = new ChannelsUploader();
    const systemConfig = {
      CHANNELS_HOME_URL: 'https://channels.weixin.qq.com/platform/post/create',
      CHANNELS_UPLOAD_INPUT_SELECTOR: 'input[type="file"]',
      CHANNELS_SAVE_DRAFT_BUTTON_SELECTOR: 'button:has-text("存草稿")',
      PLAYWRIGHT_HEADLESS: false,
      PLAYWRIGHT_USER_DATA_DIR: './.chrome_session'
    };

    await uploader.upload({
      videoPath: finalVideoPath,
      title: title,
      description: description,
      publish_mode: publishMode,
      collection_name: collectionName
    }, systemConfig);
    console.log(`[Main] 发布成功！请前往视频号草稿箱查看。`);

    console.log(`\n==========================================`);
    console.log(`[Main] 所有流程执行完毕！完美收工！`);
    console.log(`==========================================\n`);

  } catch (error) {
    console.error(`\n[Main ERR] 管道执行遭遇异常中断:`, error);
    process.exit(1);
  }
}

main();
