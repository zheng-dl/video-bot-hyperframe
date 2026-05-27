import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegStatic);

export async function mixAudioAndVideo(videoPath, audioPath, outputPath) {
  console.log(`[Mixer] Mixing audio and video...`);
  console.log(`[Mixer] Video: ${videoPath}`);
  console.log(`[Mixer] Audio: ${audioPath}`);
  
  return new Promise((resolve, reject) => {
    let command = ffmpeg()
      .input(videoPath)
      .input(audioPath)
      // Copy video codec to avoid re-encoding, map audio from second input
      .outputOptions([
        '-c:v copy',
        '-c:a aac',
        '-map 0:v:0',
        '-map 1:a:0',
        '-shortest' // End encoding when the shortest stream ends
      ]);

    command
      .on('start', (cmdLine) => console.log(`[Mixer] ffmpeg command: ${cmdLine}`))
      .on('error', (err) => {
        console.error(`[Mixer] Error mixing audio/video:`, err);
        reject(err);
      })
      .on('end', () => {
        console.log(`[Mixer] Mix complete: ${outputPath}`);
        resolve(outputPath);
      })
      .save(outputPath);
  });
}
