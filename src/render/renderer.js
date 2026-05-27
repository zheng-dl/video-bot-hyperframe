import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function renderHyperFrames(projectDir = 'hyperframes-native') {
  console.log(`[Renderer] Starting HyperFrames render for directory: ${projectDir}...`);
  const targetDir = path.resolve(projectDir);
  
  if (!fs.existsSync(targetDir)) {
    throw new Error(`[Renderer] Target directory not found: ${targetDir}`);
  }

  // Run the npx hyperframes render command
  try {
    console.log(`[Renderer] Executing: npx hyperframes render ${targetDir}`);
    // This blocks until the video is rendered. Hyperframes usually outputs to "out.mp4" or similar inside the directory.
    execSync(`npx hyperframes render ${targetDir}`, { stdio: 'inherit', cwd: targetDir });
    
    // 智能探测 renders 子目录或根目录下最新生成的 MP4 文件（完美解决动态时戳与 renders 子目录存放问题，免魔法值）
    const searchDirs = [
      path.join(targetDir, 'renders'),
      targetDir
    ];
    
    let latestMp4 = null;
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
                latestMp4 = fullPath;
              }
            } catch (e) {
              // 忽略个别损坏或被占用文件的读取异常
            }
          }
        }
      }
    }
    
    if (latestMp4) {
      console.log(`[Renderer] 智能定位到最新生成的动态视频分镜: ${latestMp4}`);
      return latestMp4;
    } else {
      console.log(`[Renderer] 渲染结束，但未能在目标目录中发现任何 MP4 文件。`);
      return true;
    }
  } catch (err) {
    console.error(`[Renderer] Rendering failed:`, err.message);
    throw err;
  }
}
