import { execFileSync } from 'node:child_process';
import { pickPromoStream, MAX_PROMO_HEIGHT } from 'file:///D:/projects/cs3/cs3_windows/electron/ytdlpSources.ts';

const bin = 'C:/Users/dipen/AppData/Roaming/CloudStream 3 Desktop/bin/yt-dlp.exe';
const ids = process.argv.slice(2);
for (const id of ids) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  let info: any;
  try {
    const out = execFileSync(bin, ['--dump-single-json','--no-playlist','--no-warnings','--no-call-home','--no-progress', url], { maxBuffer: 64*1024*1024 });
    info = JSON.parse(out.toString());
  } catch (e: any) { console.log(id, 'RESOLVE FAILED', String(e.message).slice(0,160)); continue; }

  const muxed = (info.formats ?? []).filter((f: any) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none');
  console.log(`\n=== ${id}  "${info.title}"  dur=${info.duration}s`);
  console.log('  muxed rungs:', muxed.map((f: any) => `${f.format_id}:${f.height}p/${f.ext}`).join(' ') || '(none)');
  for (const canMux of [true, false]) {
    const pick = pickPromoStream(info, canMux);
    console.log(`  canMux=${canMux} ->`, pick ? `height=${pick.height ?? '?'} pair=${Boolean(pick.audioUrl)} m3u8=${Boolean(pick.isM3u8)}` : 'null');
  }
  console.log('  cap:', MAX_PROMO_HEIGHT);
}
