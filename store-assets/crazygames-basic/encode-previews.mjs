// Actual gameplay, unchanged speed. One matching cover frame, then a continuous Stage 1 excerpt.
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const ffmpeg = resolve(root, 'films/chess-alkkagi-teaser/node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve(root, 'films/chess-alkkagi-teaser/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const probe = file => JSON.parse(execFileSync(ffprobe, ['-v','error','-show_format','-show_streams','-of','json',file], { windowsHide:true }).toString());
const log = [];
for (const [name, width, height] of [['landscape',1920,1080], ['portrait',1080,1620]]) {
  const source = resolve(root, `qa/polyhaven-model-2026-10-28/full-gameplay-${name}.webm`);
  const cover = resolve(here, `cover-${name}.png`), out = resolve(here, `preview-${name}.mp4`);
  const duration = Number(probe(source).format.duration), start = Math.max(0, duration - 16.5);
  const args = ['-hide_banner','-loglevel','error','-y','-loop','1','-framerate','25','-i',cover,'-ss',String(start),'-i',source,
    '-filter_complex',`[0:v]scale=${width}:${height},setsar=1,trim=end_frame=1,setpts=PTS-STARTPTS[a];[1:v]fps=25,scale=${width}:${height},setsar=1,trim=duration=15.96,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]`,
    '-map','[v]','-an','-t','16','-r','25','-c:v','libx264','-preset','medium','-crf','18','-movflags','+faststart','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',out];
  execFileSync(ffmpeg,args,{windowsHide:true,stdio:'inherit'});
  const info = probe(out), streams = info.streams;
  if (streams.length !== 1 || streams[0].codec_type !== 'video' || streams[0].width !== width || streams[0].height !== height || Math.abs(Number(info.format.duration)-16)>.05 || Number(info.format.size)>50_000_000) throw Error(`Invalid output: ${out}`);
  log.push({ file: `preview-${name}.mp4`, source: source.slice(root.length+1).replaceAll('\\','/'), sourceStart: start, sourceEnd: start+15.96, duration: info.format.duration, bytes: info.format.size, width,height, nativeCaptureFPS:25, outputFPS:25, audioStreams:0, ffmpegArgs:args });
  console.log(`PASS ${name}: ${info.format.duration}s, ${info.format.size} bytes, silent`);
}
await writeFile(resolve(here,'VIDEO_RENDER.json'),JSON.stringify(log,null,2));
