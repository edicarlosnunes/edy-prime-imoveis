import { readConfig, saveIntegration } from "./integrations";
import type { AdminDb } from "./admin-base";

export const METRICOOL_KEY = "metricool_mcp";
export const METRICOOL_MCP = "https://ai.metricool.com/mcp";
export const METRICOOL_AUTH = "https://app.metricool.com/oauth/authorize";
export const METRICOOL_TOKEN = "https://app.metricool.com/oauth/token";
export const METRICOOL_REGISTER = "https://app.metricool.com/oauth/register";
export const METRICOOL_CALLBACK = "https://www.esantoscorretor.com.br/api/oauth/metricool/callback";
export const normalizeTool = (name:string) => name.replace(/[^a-z]/gi,"").toLowerCase();

export function parseMcpPayload(text:string, id?:number):any {
  let payload:any;
  try {payload=JSON.parse(text);} catch {
    const messages=text.split(/\r?\n\r?\n/).flatMap(block=>{
      const data=block.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
      try {return [JSON.parse(data)];}catch {return [];}
    });
    payload=messages.find(item=>item.id === id) ?? messages.find(item=>"result" in item || "error" in item);
  }
  if(!payload || (id !== undefined && payload.id !== id)) throw new Error("Metricool não devolveu uma resposta válida.");
  if(payload.error) throw new Error(String(payload.error.message ?? "Metricool recusou a solicitação").slice(0,500));
  return payload.result;
}
export function unwrapTool(result:any):any {
  if(result?.isError) throw new Error(String(result.content?.find((x:any)=>x.type === "text")?.text ?? "Metricool recusou a operação").slice(0,600));
  if(result?.structuredContent) return result.structuredContent;
  const text=result?.content?.filter((x:any)=>x.type === "text").map((x:any)=>x.text).join("\n");
  try {return JSON.parse(text);} catch {throw new Error(text?.slice(0,600) || "Metricool não confirmou o resultado.");}
}
export function brandList(value:any):{id:string;label:string;username:string}[] {
  const rows=Array.isArray(value) ? value : value?.data ?? value?.brands ?? [];
  if(!Array.isArray(rows)) throw new Error("Metricool não retornou a lista de perfis.");
  return rows.filter(row=>row.id && row.networksData?.tiktokData).map(row=>({id:String(row.id),label:String(row.label ?? ""),username:String(row.networksData.tiktokData).replace(/^@/,"")}));
}
export async function metricoolToken(db:AdminDb) {
  const {config}=await readConfig(db,METRICOOL_KEY);
  if(!config.accessToken) throw new Error("Conecte o Metricool em Integrações → TikTok.");
  if(Number(config.expiresAt)>Date.now()+60000) return config.accessToken;
  if(!config.refreshToken) throw new Error("A conexão Metricool venceu. Reconecte em Integrações → TikTok.");
  const response=await fetch(METRICOOL_TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:config.refreshToken,client_id:config.clientId,resource:METRICOOL_MCP}),signal:AbortSignal.timeout(20000)});
  const result=await response.json() as any;
  if(!response.ok || !result.access_token) throw new Error("O Metricool recusou a renovação do acesso. Reconecte em Integrações → TikTok.");
  await saveIntegration(db,METRICOOL_KEY,{config:{...config,accessToken:result.access_token,refreshToken:result.refresh_token ?? config.refreshToken,expiresAt:String(Date.now()+Number(result.expires_in ?? 3600)*1000)}});
  return result.access_token as string;
}
export async function readMcpResponse(response:Response,id:number) {
  if(!response.headers.get("content-type")?.includes("text/event-stream")) return parseMcpPayload(await response.text(),id);
  const reader=response.body?.getReader();if(!reader) throw new Error("Resposta Metricool vazia");
  const decoder=new TextDecoder();let buffer="";let size=0;
  try {
    while(true) {
      const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});size+=chunk.value?.byteLength ?? 0;
      if(size>2_000_000) throw new Error("A resposta Metricool excedeu o limite de leitura");
      const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop() ?? "";
      if(chunk.done && buffer) {blocks.push(buffer);buffer="";}
      for(const block of blocks) {
        const raw=block.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
        let item:any;try {item=JSON.parse(raw);} catch {continue;}
        if(item.id === id) return parseMcpPayload(JSON.stringify(item),id);
      }
      if(chunk.done) throw new Error("Metricool encerrou a conexão sem confirmar o resultado");
    }
  }finally {await reader.cancel().catch(()=>{});}
}
export async function openMetricool(token:string) {
  let session="";let counter=0;let protocol="2025-03-26";
  const rpc=async(method:string,params:unknown,notification=false)=>{
    const id=++counter;
    const response=await fetch(METRICOOL_MCP,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream",...(session ? {"Mcp-Session-Id":session,"MCP-Protocol-Version":protocol} : {})},body:JSON.stringify({jsonrpc:"2.0",...(!notification ? {id} : {}),method,params}),signal:AbortSignal.timeout(90000)});
    if(!response.ok) throw new Error(response.status === 401 ? "A autorização do Metricool venceu. Reconecte em Integrações → TikTok." : `Metricool recusou a solicitação (HTTP ${response.status}).`);
    session=response.headers.get("Mcp-Session-Id") ?? session;
    if(notification) {await response.body?.cancel();return null;}
    return readMcpResponse(response,id);
  };
  const initialized=await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"E. Santos CRM — Assistente de publicação",version:"1.0.0"}});
  protocol=initialized?.protocolVersion ?? protocol;
  await rpc("notifications/initialized",{},true);
  const listed=await rpc("tools/list",{});
  const tools=listed?.tools as {name:string;inputSchema?:{properties?:Record<string,unknown>}}[];
  const call=async(name:string,args:Record<string,unknown>)=>{
    const tool=tools?.find(t=>normalizeTool(t.name) === normalizeTool(name));
    if(!tool) throw new Error(`O conector Metricool não disponibilizou a operação ${name}.`);
    const adapted={...args};
    if((tool.inputSchema?.properties?.blogId as {type?:string})?.type === "number" && typeof adapted.blogId === "string") adapted.blogId=Number(adapted.blogId);
    return unwrapTool(await rpc("tools/call",{name:tool.name,arguments:adapted}));
  };
  return {call};
}
export function scheduledConfirmation(value:any) {
  const data=value?.data ?? value;
  const post=Array.isArray(data) ? data[0] : data?.post ?? data;
  const id=post?.id ?? post?.postId;
  const planner=value?.plannerUrl ?? post?.plannerUrl;
  if(!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(String(id))) throw new Error("Metricool recebeu a solicitação, mas não confirmou o código. Confira o planejamento antes de tentar novamente.");
  let url="https://app.metricool.com/planner";
  if(typeof planner === "string") {try {const parsed=new URL(planner);if(parsed.protocol === "https:" && parsed.hostname === "app.metricool.com") url=parsed.href;}catch {}}
  return {id:String(id),url};
}
