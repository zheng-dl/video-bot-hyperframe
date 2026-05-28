import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { getVideoLayoutConfig } from '../utils/system_config.js';

/**
 * 编译器核心配置常量，彻底规避魔法值与硬编码
 */
const COMPILER_CONFIG = {
  COMPOSITION_ID: 'main',
  DEFAULT_SCENE_DURATION: 3.0,
  DURATION_BUFFER: 0.3,
  TAIL_BUFFER: 1.0,
  GSAP_CDN: 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js',
  DEFAULT_SCENE_ID_PREFIX: 'scene-'
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendClassName(existingClassName = '', className) {
  const classNames = new Set(String(existingClassName).split(/\s+/).filter(Boolean));
  classNames.add(className);
  return Array.from(classNames).join(' ');
}

function isPreviewRuntimeScript(scriptContent = '') {
  return (
    scriptContent.includes('function fitShell') ||
    scriptContent.includes('const shell = document.querySelector(\'.preview-shell\')') ||
    scriptContent.includes('const shell = document.getElementById(\'previewShell\')') ||
    scriptContent.includes('syncPreviewScale') ||
    scriptContent.includes('showScene')
  );
}

function cleanupNativeOnlyPreviewArtifacts($) {
  $('style#hf-preview-runtime-style').remove();
  $('script#hf-preview-runtime-script').remove();
  $('script').each((_, script) => {
    const content = $(script).html() || '';
    if (content.includes('window.__timelines') || isPreviewRuntimeScript(content)) {
      $(script).remove();
    }
  });
}

function remapStageSelectorStyles($, sourceSelector, targetSelector) {
  if (!sourceSelector || sourceSelector === targetSelector) {
    return;
  }

  const selectorPattern = new RegExp(escapeRegExp(sourceSelector), 'g');
  $('style').each((_, styleEl) => {
    const styleContent = $(styleEl).html() || '';
    if (!styleContent.includes(sourceSelector)) {
      return;
    }
    $(styleEl).html(styleContent.replace(selectorPattern, targetSelector));
  });
}

/**
 * 本地确定性 HyperFrames 编译器 (Cheerio DOM 装配版)
 * 完全杜绝大模型二次 HTML 编译所导致的截断、闭合残缺和拼装崩溃问题
 */
export async function compileToHyperFrames(interactiveHtmlPath, durations, provider = 'gemini', topicHfDir = 'hyperframes-native') {
  console.log(`[HyperFrames Compiler] Starting deterministic Cheerio DOM compilation for: ${interactiveHtmlPath}`);

  if (!fs.existsSync(interactiveHtmlPath)) {
    throw new Error(`[HyperFrames Compiler ERR] Source HTML file not found: ${interactiveHtmlPath}`);
  }

  const interactiveHtml = fs.readFileSync(interactiveHtmlPath, 'utf-8');
  const $ = cheerio.load(interactiveHtml);
  const videoLayout = getVideoLayoutConfig();
  const canvasWidth = videoLayout.stage_width;
  const canvasHeight = videoLayout.stage_height;
  const stageSelector = videoLayout.stage_selector || '#video-stage';
  cleanupNativeOnlyPreviewArtifacts($);
  remapStageSelectorStyles($, stageSelector, '#root');

  // 1. 根据精确音频时长计算绝对时间线
  let currentStart = 0;
  const clipTimeframes = [];
  for (let i = 0; i < durations.length; i++) {
    const dur = parseFloat((durations[i] + COMPILER_CONFIG.DURATION_BUFFER).toFixed(2)); 
    clipTimeframes.push({
      start: currentStart,
      duration: dur
    });
    currentStart += dur;
  }
  const totalDuration = Math.ceil(currentStart + COMPILER_CONFIG.TAIL_BUFFER);
  console.log(`[HyperFrames Compiler] Calculated Timeline - Total Duration: ${totalDuration}s (Clips count: ${clipTimeframes.length})`);

  // 2. 优先抽取固定视频舞台，彻底隔离外层响应式预览壳对最终成片的干扰
  let $root = null;
  const $stage = $(stageSelector).first();
  if ($stage.length > 0) {
    const stageHtml = $.html($stage);
    $('body').html(stageHtml);
    $root = $('body').children().first();
    console.log(`[HyperFrames Compiler] Using configured video stage selector: ${stageSelector}`);
  } else {
    $root = $('#root');
    if ($root.length === 0) {
      $('body').wrapInner('<div id="root"></div>');
      $root = $('#root');
    }
    console.log(`[HyperFrames Compiler] Video stage selector not found, falling back to body/root wrapping.`);
  }
  
  $root.attr({
    'id': 'root',
    'data-composition-id': COMPILER_CONFIG.COMPOSITION_ID,
    'data-start': '0',
    'data-duration': totalDuration.toString(),
    'data-width': canvasWidth.toString(),
    'data-height': canvasHeight.toString()
  });
  // 3. 场景容器物理重洗与时间戳绑定 (采用父级追溯法，具有极强命名容错性并物理保留原始ID)
  const narrationScripts = $('script.scene-narration');
  if (narrationScripts.length > 0) {
    console.log(`[HyperFrames Compiler] Using parent-tracing method to locate scene clips.`);
    narrationScripts.each((index, el) => {
      const $container = $(el).parent();
      const timeframe = clipTimeframes[index] || { start: 0, duration: COMPILER_CONFIG.DEFAULT_SCENE_DURATION };

      // 物理保留第一阶段场景原始 ID，防止专属 CSS 样式选择器踩空
      const originalId = $container.attr('id') || `${COMPILER_CONFIG.DEFAULT_SCENE_ID_PREFIX}${index + 1}`;
      const originalClassName = $container.attr('class') || '';

      $container.attr('class', appendClassName(originalClassName, 'clip'))
                .attr('id', originalId)
                .attr('data-track-index', '0')
                .attr('data-start', timeframe.start.toFixed(2))
                .attr('data-duration', timeframe.duration.toFixed(2));
    });
  } else {
    console.log(`[HyperFrames Compiler] Falling back to class name selector for locating scene clips.`);
    // 兼容可能遗漏口播标签 of 异常场景
    const scenes = $('.scene, .page, .clip');
    scenes.each((index, el) => {
      const $el = $(el);
      const timeframe = clipTimeframes[index] || { start: 0, duration: COMPILER_CONFIG.DEFAULT_SCENE_DURATION };

      // 物理保留第一阶段场景原始 ID，防止专属 CSS 样式选择器踩空
      const originalId = $el.attr('id') || `${COMPILER_CONFIG.DEFAULT_SCENE_ID_PREFIX}${index + 1}`;
      const originalClassName = $el.attr('class') || '';

      $el.attr('class', appendClassName(originalClassName, 'clip'))
         .attr('id', originalId)
         .attr('data-track-index', '0')
         .attr('data-start', timeframe.start.toFixed(2))
         .attr('data-duration', timeframe.duration.toFixed(2));
    });
  }
  // 4. Viewport 元数据强制合规
  if ($('meta[name="viewport"]').length === 0) {
    $('head').prepend(`<meta name="viewport" content="width=${canvasWidth}, initial-scale=1">`);
  } else {
    $('meta[name="viewport"]').attr('content', `width=${canvasWidth}, initial-scale=1`);
  }

  // 5. 强制全局样式与防 seek 物理冲突过渡覆盖规则
  const requiredStyles = `
<style>
  html, body {
    width: ${canvasWidth}px;
    height: ${canvasHeight}px;
    overflow: hidden;
    margin: 0;
    padding: 0;
    background-color: #05060b;
  }
  #root {
    width: ${canvasWidth}px;
    height: ${canvasHeight}px;
    position: relative;
    overflow: hidden;
  }
  #root > .clip {
    position: absolute;
    top: 0;
    left: 0;
    width: ${canvasWidth}px;
    height: ${canvasHeight}px;
    display: none;
    opacity: 0;
    box-sizing: border-box;
  }
  /* 强制屏蔽所有可能与 GSAP 寻帧 Timeline 冲突的原生 CSS 过渡，物理上根除 seek 时抖动 */
  .clip, .clip * {
    transition: none !important;
    animation: none !important;
  }
</style>
`;
  $('head').append(requiredStyles);

  // 6. 清理老旧脚本，物理强注 GSAP CDN 库与反射匹配引擎
  $('script[src*="gsap"]').remove();
  $('script').each((i, script) => {
    const content = $(script).html() || '';
    if (content.includes('window.__timelines') || isPreviewRuntimeScript(content)) {
      $(script).remove();
    }
  });

  const engineScript = `
<!-- 必须手动显式引入 GSAP 核心库，防止静态分析器漏包导致 gsap is not defined 崩溃 -->
<script src="${COMPILER_CONFIG.GSAP_CDN}"></script>
<script>
(function () {
  var stageWidth = ${canvasWidth};
  var stageHeight = ${canvasHeight};

  // 1. 自动重置所有 .clip 场景的位置和透明度
  gsap.set('#root > .clip', { display: 'none', opacity: 0 });

  // 2. 初始化暂停的 GSAP Timeline
  var tl = gsap.timeline({ paused: true });

  // 3. 遍历所有直接子场景 .clip 并全自动匹配时间轴与错落动效
  var clips = document.querySelectorAll('#root > .clip');
  clips.forEach(function (clip) {
    var startTime = parseFloat(clip.getAttribute('data-start'));
    var duration = parseFloat(clip.getAttribute('data-duration'));
    var endTime = startTime + duration;
    var id = '#' + clip.id;

    // A. 画面显隐全自动精确对齐口播时间轴（淡入 + 提前淡出 + 物理隐藏防残留）
    tl.set(id, { display: 'flex', opacity: 0, visibility: 'visible' }, startTime)
      .to(id, { opacity: 1, duration: 0.4 }, startTime)
      .to(id, { opacity: 0, duration: 0.35, ease: 'power2.in' }, endTime - 0.35)
      .set(id, { display: 'none', visibility: 'hidden' }, endTime);

    // B. 子元素（标题、卡片、代码、SVG 模块）自动 Staggered 错落淡入
    var animItems = clip.querySelectorAll('h1, h2, h3, p, .card, code, li, .diagram-box, .nest-system');
    if (animItems.length > 0) {
      tl.from(animItems, {
        opacity: 0,
        y: 35,
        stagger: 0.12,
        duration: 0.7,
        ease: 'power2.out'
      }, startTime + 0.15);
    }
  });

  // 4. 对象格式挂载注册（致命硬性要求，秒级兼容渲染器）
  window.__timelines = window.__timelines || {};
  window.__timelines["${COMPILER_CONFIG.COMPOSITION_ID}"] = tl;

  // 5. 浏览器本地预览自适应缩放与空格暂停播放逻辑
  if (!window.__hyperframes) {
    function fitToViewport() {
      var scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight, 1);
      document.body.style.transform = 'scale(' + scale + ')';
      document.body.style.transformOrigin = 'top left';
      var offsetX = (window.innerWidth - stageWidth * scale) / 2;
      var offsetY = (window.innerHeight - stageHeight * scale) / 2;
      document.body.style.marginLeft = Math.max(0, offsetX) + 'px';
      document.body.style.marginTop = Math.max(0, offsetY) + 'px';
    }
    fitToViewport();
    window.addEventListener('resize', fitToViewport);
    document.addEventListener('click', function() {
      if (tl.progress() >= 1) tl.restart(); else tl.play();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === ' ') {
        e.preventDefault();
        if (tl.isActive()) tl.pause();
        else if (tl.progress() >= 1) tl.restart();
        else tl.play();
      }
    });
  }
})();
</script>
`;

  $('body').append(engineScript);

  // 7. 物理保存合规文件并输出
  const hfHtml = $.html();
  const outDir = path.resolve(topicHfDir);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const outputPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outputPath, hfHtml, 'utf-8');
  console.log(`[HyperFrames Compiler] (Deterministic Cheerio Engine) HyperFrames HTML successfully compiled at: ${outputPath}`);
  
  return outputPath;
}
