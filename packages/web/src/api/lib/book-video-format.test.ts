import {test,expect} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {inspectMp4Rate,transcodeBook} from './book-video-format';

test('converts actual 10-FPS video to measured CFR 30 preserving audio and duration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'book-format-test-'));
 try {
  const source=join(dir,'slow.mp4'),output=join(dir,'fixed.mp4');
  execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=108x192:rate=10:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  const input=await readFile(source);expect(inspectMp4Rate(input).fps).toBe(10);
  const fixed=await transcodeBook(input);await writeFile(output,fixed);
  const measured=inspectMp4Rate(fixed);expect(measured.constant30).toBe(true);expect(measured.fps).toBe(30);expect(measured.frames).toBe(60);expect(measured.duration).toBe(2);
  execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-i',output,'-map','0:v:0','-map','0:a:0','-f','null','-']);
 }finally {await rm(dir,{recursive:true,force:true});}
},30000);
test('rejects corrupt media instead of returning a ready video',async()=>{
 await expect(transcodeBook(Buffer.from('not a video'))).rejects.toThrow('Não foi possível converter');
 expect(()=>inspectMp4Rate(Buffer.from('invalid'))).toThrow();
});
