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
    
    // Hyperframes output is typically 'output.mp4' or 'out.mp4' in the target directory
    const defaultOutPath = path.join(targetDir, 'output.mp4');
    if (fs.existsSync(defaultOutPath)) {
      console.log(`[Renderer] Render complete: ${defaultOutPath}`);
      return defaultOutPath;
    } else {
      // In case it outputs somewhere else, we just return true.
      console.log(`[Renderer] Render complete, but default output.mp4 not found. Please verify output file.`);
      return true;
    }
  } catch (err) {
    console.error(`[Renderer] Rendering failed:`, err.message);
    throw err;
  }
}
