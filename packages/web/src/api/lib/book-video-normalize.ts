import { put } from '@vercel/blob';
import { sql } from 'drizzle-orm';
import type { AdminDb } from './admin-base';
import { MAX_BOOK_BYTES, inspectMp4Rate, transcodeBook } from './book-video-format';

export async function normalizeBookAsset(db:AdminDb,propertyId:number,sourceUrl:string) {
  const source=new URL(sourceUrl);
  if(source.protocol!=='https:'||!source.hostname.endsWith('.blob.vercel-storage.com'))throw new Error('Arquivo do Book inválido.');
  await db.run(sql`CREATE TABLE IF NOT EXISTS crm_book_video_formats (source_url TEXT PRIMARY KEY, property_id INTEGER NOT NULL, output_url TEXT NOT NULL, pathname TEXT NOT NULL, size INTEGER NOT NULL, duration REAL NOT NULL)`);
  const cached=await db.all(sql`SELECT output_url,pathname,size,duration FROM crm_book_video_formats WHERE property_id=${propertyId} AND (source_url=${sourceUrl} OR output_url=${sourceUrl}) LIMIT 1`) as {output_url:string;pathname:string;size:number;duration:number}[];
  if(cached[0])return {url:cached[0].output_url,pathname:cached[0].pathname,size:cached[0].size,duration:cached[0].duration,mime:'video/mp4'};
  const response=await fetch(sourceUrl,{signal:AbortSignal.timeout(45000),redirect:'error'});
  if(!response.ok||Number(response.headers.get('content-length'))>MAX_BOOK_BYTES)throw new Error('Não foi possível ler o Book (limite de 250 MB).');
  const reader=response.body?.getReader();if(!reader)throw new Error('Arquivo do Book vazio.');
  const chunks:Buffer[]=[];let size=0;
  try {while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>MAX_BOOK_BYTES)throw new Error('O Book ultrapassa 250 MB.');chunks.push(Buffer.from(item.value));}}finally{await reader.cancel().catch(()=>{});}
  const output=await transcodeBook(Buffer.concat(chunks)),rate=inspectMp4Rate(output);
  const saved=await put(`properties/${propertyId}/book-youtube/book-30fps-v1.mp4`,output,{access:'public',addRandomSuffix:true,contentType:'video/mp4'});
  await db.run(sql`INSERT INTO crm_book_video_formats(source_url,property_id,output_url,pathname,size,duration) VALUES(${sourceUrl},${propertyId},${saved.url},${saved.pathname},${output.length},${rate.duration}) ON CONFLICT(source_url) DO UPDATE SET output_url=excluded.output_url,pathname=excluded.pathname,size=excluded.size,duration=excluded.duration`);
  return {url:saved.url,pathname:saved.pathname,size:output.length,duration:rate.duration,mime:'video/mp4'};
}
