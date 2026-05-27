import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// Set paths for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

/**
 * Gets duration of an audio file in seconds
 */
function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Concatenates multiple audio files into one
 */
function concatAudio(inputFiles, outputFile) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    inputFiles.forEach(file => command.input(file));
    command
      .on('error', (err) => reject(err))
      .on('end', () => resolve(outputFile))
      .mergeToFile(outputFile, path.dirname(outputFile));
  });
}

export async function processAudio(htmlPath, topicWorkspace = 'workspace') {
  console.log(`[Audio Processor] Parsing HTML to extract narrations...`);
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(htmlContent);
  
  // Extract global metadata
  let videoMeta = { tts_voice: 'zh-CN-YunxiNeural' }; // Default
  const metaScript = $('#video-meta').html();
  if (metaScript) {
    try {
      videoMeta = JSON.parse(metaScript);
    } catch(e) {
      console.warn('[Audio Processor] Failed to parse #video-meta script:', e.message);
    }
  }
  
  const voice = videoMeta.tts_voice || 'zh-CN-YunxiNeural';
  console.log(`[Audio Processor] Using TTS Voice: ${voice}`);

  // Extract narrations
  const narrations = [];
  $('.scene').each((index, el) => {
    const scriptTag = $(el).find('script.scene-narration').html();
    let text = "";
    if (scriptTag) {
      try {
        text = JSON.parse(scriptTag); // Parses the "string"
      } catch(e) {
        text = scriptTag.replace(/^"|"$/g, '').trim(); // Fallback
      }
    }
    narrations.push(text);
  });
  
  console.log(`[Audio Processor] Found ${narrations.length} scenes.`);

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const ttsDir = path.resolve(topicWorkspace, 'tts');
  if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir, { recursive: true });

  const durations = [];
  const audioFiles = [];

  for (let i = 0; i < narrations.length; i++) {
    const text = narrations[i];
    const outPath = path.join(ttsDir, `scene_${i}.mp3`);
    
    if (text && text.length > 0) {
      console.log(`[Audio Processor] Generating TTS for scene ${i}...`);
      const { audioStream } = tts.toStream(text);
      const writeStream = fs.createWriteStream(outPath);
      
      await new Promise((resolve, reject) => {
        audioStream.pipe(writeStream);
        
        audioStream.on('error', (err) => reject(err));
        writeStream.on('error', (err) => reject(err));
        writeStream.on('finish', resolve);
      });
      
      const duration = await getDuration(outPath);
      durations.push(duration);
      audioFiles.push(outPath);
    } else {
      // If no narration, default to 3 seconds silent or just 3s duration without audio file
      console.log(`[Audio Processor] Scene ${i} has no narration. Using 3s default.`);
      durations.push(3.0);
    }
  }

  // Concatenate master audio
  let masterAudioPath = null;
  if (audioFiles.length > 0) {
    masterAudioPath = path.resolve(topicWorkspace, 'master_audio.mp3');
    console.log(`[Audio Processor] Concatenating ${audioFiles.length} files to master audio...`);
    await concatAudio(audioFiles, masterAudioPath);
  }

  console.log(`[Audio Processor] Audio processing complete.`);
  return {
    durations,
    masterAudioPath,
    meta: videoMeta
  };
}
