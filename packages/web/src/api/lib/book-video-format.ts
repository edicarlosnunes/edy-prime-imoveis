import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_BOOK_BYTES = 250 * 1024 * 1024;

/** Inspect the encoded video sample durations, not the requested capture rate. */
export function inspectMp4Rate(buffer: Buffer) {
  const children = (start: number, end: number) => {
    const atoms: {type:string; start:number; end:number}[] = [];
    for(let pos=start;pos+8<=end;) {
      let size=buffer.readUInt32BE(pos),header=8;
      if(size===1) {if(pos+16>end) throw new Error("MP4 inválido");size=Number(buffer.readBigUInt64BE(pos+8));header=16;}
      if(size===0)size=end-pos;
      if(!Number.isSafeInteger(size)||size<header||pos+size>end)throw new Error("MP4 inválido");
      atoms.push({type:buffer.toString("ascii",pos+4,pos+8),start:pos+header,end:pos+size});pos+=size;
    }
    return atoms;
  };
  const moov=children(0,buffer.length).find(a=>a.type==='moov');
  if(!moov)throw new Error("Vídeo sem metadados MP4");
  for(const track of children(moov.start,moov.end).filter(a=>a.type==='trak')) {
    const mdia=children(track.start,track.end).find(a=>a.type==='mdia');if(!mdia)continue;
    const atoms=children(mdia.start,mdia.end),hdlr=atoms.find(a=>a.type==='hdlr'),mdhd=atoms.find(a=>a.type==='mdhd'),minf=atoms.find(a=>a.type==='minf');
    if(!hdlr||buffer.toString('ascii',hdlr.start+8,hdlr.start+12)!=='vide'||!mdhd||!minf)continue;
    const scale=buffer.readUInt32BE(mdhd.start+(buffer[mdhd.start]===1 ? 20 : 12));
    const stbl=children(minf.start,minf.end).find(a=>a.type==='stbl');if(!stbl)continue;
    const stts=children(stbl.start,stbl.end).find(a=>a.type==='stts');if(!stts)continue;
    const entries=buffer.readUInt32BE(stts.start+4);let frames=0,ticks=0,constant30=true;
    if(stts.start+8+entries*8>stts.end)throw new Error('Metadados de quadros inválidos');
    for(let i=0;i<entries;i++){const pos=stts.start+8+i*8,count=buffer.readUInt32BE(pos),delta=buffer.readUInt32BE(pos+4);frames+=count;ticks+=count*delta;if(delta*30!==scale)constant30=false;}
    if(!scale||!ticks||!frames)throw new Error('Vídeo sem quadros válidos');
    return {fps:frames*scale/ticks,duration:ticks/scale,frames,constant30};
  }
  throw new Error('MP4 sem faixa de vídeo válida');
}

async function ffmpegPath() {
  // Copied at build time, inside the function bundle (never served as a public asset).
  for(const path of [join(process.cwd(),'api/bin/ffmpeg'),join(process.cwd(),'packages/web/api/bin/ffmpeg'),join(process.cwd(),'node_modules/ffmpeg-static/ffmpeg'),join(process.cwd(),'packages/web/node_modules/ffmpeg-static/ffmpeg')]) {
    try {await access(path);return path;}catch {}
  }
  throw new Error('Conversor de vídeo indisponível nesta implantação. Nenhum envio foi realizado.');
}
export async function transcodeBook(input: Buffer):Promise<Buffer> {
  if(!input.length||input.length>MAX_BOOK_BYTES)throw new Error('O Book precisa ter até 250 MB.');
  const directory=await mkdtemp(join(tmpdir(),'esantos-book-'));
  try {
    const source=join(directory,'source'),target=join(directory,'book.mp4');await writeFile(source,input);
    const binary=await ffmpegPath();
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(binary,['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm','-threads','2','-i',source,'-map','0:v:0','-map','0:a:0?','-vf','fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2','-fps_mode','cfr','-c:v','libx264','-threads','2','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-t','181',target],{stdio:['ignore','ignore','pipe']});
      let detail='';child.stderr.on('data',chunk=>{detail=(detail+String(chunk)).slice(-4000);});
      const timeout=setTimeout(()=>{child.kill('SIGKILL');},240000);
      child.on('error',()=>{clearTimeout(timeout);reject(new Error('Não foi possível iniciar a conversão do Book.'));});
      child.on('close',code=>{clearTimeout(timeout);if(code===0)resolve();else {console.warn('[book-conversion]',detail);reject(new Error('Não foi possível converter o Book. O arquivo anterior foi preservado; nenhum anúncio foi enviado.'));}});
    });
    const output=await readFile(target),rate=inspectMp4Rate(output);
    if(!rate.constant30||rate.duration>180.2||output.length>MAX_BOOK_BYTES)throw new Error('O Book não passou na validação de 30 FPS, duração de até 3 minutos e tamanho de até 250 MB.');
    return output;
  }finally {await rm(directory,{recursive:true,force:true});}
}
