import fs from 'fs';
import path from 'path';

const DEFAULT_VIDEO_LAYOUT = {
  stage_width: 1080,
  stage_height: 1920,
  aspect_ratio: '9:16',
  stage_selector: '#video-stage',
  preview_shell_selector: '.preview-shell',
  allow_responsive_shell: true,
  allow_internal_reflow: false,
  safe_padding_x: 72,
  safe_padding_y: 96,
  title_font_size: 72,
  body_font_size: 30,
  code_font_size: 24
};

/**
 * 统一读取系统配置，避免不同模块各自硬编码配置路径。
 */
export function readSystemConfig() {
  const configPath = path.resolve('./config/system_config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing system config file at: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * 统一获取当前激活的视频舞台配置，缺省时回退到竖屏短视频安全值。
 */
export function getVideoLayoutConfig() {
  const systemConfig = readSystemConfig();
  const activeLayoutName = systemConfig.ACTIVE_VIDEO_LAYOUT || 'mobile_portrait';
  const layoutConfig = systemConfig.VIDEO_LAYOUTS?.[activeLayoutName] || {};

  return {
    name: activeLayoutName,
    ...DEFAULT_VIDEO_LAYOUT,
    ...layoutConfig
  };
}
