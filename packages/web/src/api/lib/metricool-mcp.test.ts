import {test,expect,afterEach} from "bun:test";
import {parseMcpPayload,readMcpResponse,unwrapTool,brandList,scheduledConfirmation,openMetricool} from "./metricool-mcp";
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original;});
test("MCP accepts JSON and SSE by request id, never treating unrelated messages as confirmation",()=>{
 expect(parseMcpPayload('{"jsonrpc":"2.0","id":3,"result":{"ok":true}}',3)).toEqual({ok:true});
 expect(parseMcpPayload('event: message\ndata: {"id":8,"result":{"wrong":true}}\n\nevent: message\ndata: {"id":3,"result":{"ok":true}}\n\n',3)).toEqual({ok:true});
 expect(()=>parseMcpPayload('{"id":4,"result":{}}',3)).toThrow();
 expect(()=>parseMcpPayload('{"id":3,"error":{"message":"Limite do plano"}}',3)).toThrow("Limite do plano");
});
test("SSE returns as soon as the matching result arrives, even on a long-lived stream",async()=>{
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"id":2,"result":{"ok":true}}\n\n'));},cancel(){cancelled=true;}});
 expect(await readMcpResponse(new Response(stream,{headers:{"content-type":"text/event-stream"}}),2)).toEqual({ok:true});
 expect(cancelled).toBe(true);
});
test("brand selection only includes connected TikTok profiles",()=>{
 expect(brandList({data:[{id:1,label:"A",networksData:{instagramData:"other"}},{id:2,label:"E Santos",networksData:{tiktokData:"@esantosgestorimobiliario"}}]})).toEqual([{id:"2",label:"E Santos",username:"esantosgestorimobiliario"}]);
 expect(()=>brandList({data:{}})).toThrow();
});
test("provider errors and missing receipts are not labelled published",()=>{
 expect(()=>unwrapTool({isError:true,content:[{type:"text",text:"Plan limit"}]})).toThrow("Plan limit");
 expect(unwrapTool({content:[{type:"text",text:'{"data":{"id":12}}'}]})).toEqual({data:{id:12}});
 expect(scheduledConfirmation({data:{id:12},plannerUrl:"https://app.metricool.com/planner/post/12"})).toEqual({id:"12",url:"https://app.metricool.com/planner/post/12"});
 expect(()=>scheduledConfirmation({message:"ok"})).toThrow("não confirmou");
 expect(scheduledConfirmation({id:13,plannerUrl:"https://evil.example/post"}).url).toBe("https://app.metricool.com/planner");
});
test("official transport initializes session then calls only the explicitly requested tool",async()=>{
 const methods:string[]=[];
 globalThis.fetch=(async(url,options)=>{
  expect(String(url)).toBe("https://ai.metricool.com/mcp");
  const body=JSON.parse(String(options?.body));methods.push(body.method);
  if(body.method === "notifications/initialized")return new Response(null,{status:202});
  let result:any={};
  if(body.method === "initialize")result={protocolVersion:"2025-03-26"};
  if(body.method === "tools/list")result={tools:[{name:"get_brand_settings",inputSchema:{properties:{}}},{name:"create_scheduled_post",inputSchema:{properties:{blogId:{type:"number"}}}}]};
  if(body.method === "tools/call") {expect(body.params.name).toBe("create_scheduled_post");expect(body.params.arguments.blogId).toBe(7322391);result={content:[{type:"text",text:'{"id":123}'}]};}
  return Response.json({jsonrpc:"2.0",id:body.id,result},{headers:{"Mcp-Session-Id":"session"}});
 }) as typeof fetch;
 const client=await openMetricool("test-token");
 expect(await client.call("createScheduledPost",{blogId:"7322391",info:"TikTok only"})).toEqual({id:123});
 await expect(client.call("delete_everything",{})).rejects.toThrow("não disponibilizou");
 expect(methods).toEqual(["initialize","notifications/initialized","tools/list","tools/call"]);
});
