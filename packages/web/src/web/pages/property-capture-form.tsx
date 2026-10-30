import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, Home, Camera } from "lucide-react";
import { client, orpc } from "../lib/api";
import { usePublishedContent } from "../queries/site";
import { mergeSiteContent } from "../lib/site-content";
import { propertyCaptureFormSchema } from "../../shared/property-capture-form";

const empty = { name:"", phone:"", email:"", intention:"venda", propertyType:"apartamento", cep:"", street:"", number:"", complement:"", neighborhood:"", city:"Praia Grande", state:"SP", area:"", bedrooms:"", bathrooms:"", suites:"", parking:"", balcony:"", view:"", furnished:"", amenities:"", price:"", condominium:"", iptu:"", negotiation:"", occupancy:"", deed:"", financing:"", debts:"", observations:"", website:"" };
type Answers = typeof empty;
const steps = ["Proprietário", "Localização", "Características", "Valores", "Situação do imóvel", "Foto e revisão"];
const control = "mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-base text-stone-900 outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-700/20";
export function PermanentCaptureForm() {
  const session = useQuery({
    queryKey: ["public-property-capture-session"], staleTime: Infinity, retry: false,
    queryFn: async () => {
      let previousToken: string | undefined;
      try { previousToken = sessionStorage.getItem("public-property-capture-token") || undefined; } catch { /* optional draft */ }
      const result = await client.propertyCaptureForms.start({previousToken});
      try { sessionStorage.setItem("public-property-capture-token", result.token); } catch { /* optional draft */ }
      return result;
    },
  });
  if (session.data) return <PropertyCaptureForm publicToken={session.data.token}/>;
  return <div className="min-h-screen bg-[#f5f3ed] p-8 text-center text-stone-800"><img src="/esantos-logo.png" alt="E. Santos Gestor Imobiliário" className="mx-auto mb-6 h-24"/><p role={session.isError ? "alert" : "status"}>{session.isError ? "Não foi possível abrir o formulário agora. Atualize a página e tente novamente." : "Preparando seu formulário…"}</p></div>;
}
export default function PropertyCaptureForm({publicToken}: {publicToken?:string} = {}) {
  const params = useParams<{token:string}>();
  const token = publicToken ?? params.token ?? "";
  const published = usePublishedContent();
  const content = mergeSiteContent(published.data?.data);
  const logo = "/esantos-logo-transparente.png";
  const link = useQuery({ ...orpc.propertyCaptureForms.resolve.queryOptions({input:{token}}), enabled:Boolean(token), retry:1 });
  const [answers, setAnswers] = useState(empty);
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const draftKey = `property-capture-form:${token}`;
  useEffect(() => {
    setAnswers(empty); setStep(0); setConsent(false); setPhoto(""); setDone(false); setError("");
    try { const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null"); if (saved) { setAnswers({...empty,...saved.answers}); setStep(Math.min(5, Math.max(0, Number(saved.step)||0))); } } catch { /* Storage unavailable: form still works. */ }
  }, [draftKey]);
  useEffect(() => { if (!done) { try { sessionStorage.setItem(draftKey, JSON.stringify({answers,step})); } catch { /* optional local draft */ } } }, [answers,step,done,draftKey]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  function set(key:keyof Answers,value:string) { setAnswers(a=>({...a,[key]:value})); }
  function field(key:keyof Answers,label:string,required=false,type="text",hint="") {
    return <label className="block text-sm font-medium" key={key}>{label}{required && <span className="text-amber-800"> *</span>}<input className={control} type={type} required={required} maxLength={key === "street" ? 200 : 160} value={answers[key]} onChange={e=>set(key,e.target.value)} />{hint && <span className="mt-1 block text-xs font-normal text-stone-500">{hint}</span>}</label>;
  }
  function choice(key:keyof Answers,label:string,options:string[],required=false) {
    return <label className="block text-sm font-medium" key={key}>{label}{required && " *"}<select className={control} value={answers[key]} required={required} onChange={e=>set(key,e.target.value)}><option value="">Selecione</option>{options.map(option=><option key={option}>{option}</option>)}</select></label>;
  }
  function text(key:keyof Answers,label:string,max=500) {
    return <label className="block text-sm font-medium">{label}<textarea className={control} rows={3} maxLength={max} value={answers[key]} onChange={e=>set(key,e.target.value)} /></label>;
  }
  async function choosePhoto(file?:File) {
    setError(""); setPhoto(""); if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15*1024*1024) { setError("Escolha uma foto JPG, PNG ou WebP de até 15 MB."); return; }
    setPhotoBusy(true);
    let url = "";
    try {
      url = URL.createObjectURL(file);
      const image = new Image(); image.src=url; await image.decode();
      const ratio=Math.min(1,1600/image.width,1600/image.height);
      const canvas=document.createElement("canvas"); canvas.width=Math.round(image.width*ratio); canvas.height=Math.round(image.height*ratio);
      const ctx=canvas.getContext("2d"); if(!ctx) throw new Error(); ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL("image/jpeg",0.8); if(data.length>2_800_000) throw new Error(); setPhoto(data);
    } catch { setError("Não foi possível preparar essa foto. Escolha outra imagem da fachada."); }
    finally { if(url) URL.revokeObjectURL(url); setPhotoBusy(false); }
  }
  async function next(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (step<5) { setStep(step+1); return; }
    if (!photo) { setError("Inclua uma foto real da frente/fachada do imóvel para identificação."); return; }
    const parsed=propertyCaptureFormSchema.safeParse({...answers,token,photo,consent});
    if(!parsed.success) { setError(`Confira os dados: ${parsed.error.issues[0]?.message || "há uma resposta inválida"}. Use Voltar para revisar.`); return; }
    setBusy(true);
    try { await client.propertyCaptureForms.submit(parsed.data); setDone(true); setPhoto(""); sessionStorage.removeItem(draftKey); }
    catch(e) { setError(e instanceof Error ? e.message : "Não foi possível enviar. Suas respostas continuam nesta tela; tente novamente."); }
    finally { setBusy(false); }
  }
  return <div className="min-h-screen bg-[#f5f3ed] px-4 py-8 text-stone-900 sm:py-12"><main className="mx-auto max-w-2xl">
    <header className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="relative isolate flex min-h-52 items-start overflow-hidden bg-[#10251f] p-6 sm:min-h-80 sm:p-8">
        <img src={content.hero.imageUrl || "/images/hero.jpg"} alt="Paisagem do litoral de Praia Grande" className="absolute inset-0 -z-20 h-full w-full object-cover"/>
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/85 via-black/55 to-black/20"/>
        <div className="flex flex-col items-start gap-4"><img src={logo} alt="E. Santos Gestor Imobiliário" className="h-24 w-24 object-contain sm:h-28 sm:w-28"/><div><p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#f4d28d]">E. Santos · Gestor Imobiliário</p><h1 className="font-serif text-3xl text-white sm:text-4xl">Cadastre seu imóvel</h1><p className="mt-2 text-sm text-white/85">Seu imóvel, nossa próxima oportunidade.</p></div></div>
      </div>
      <div className="border-t-4 border-[#bc9349] p-6 sm:px-8"><p className="text-sm leading-6 text-stone-600">Conte um pouco sobre o imóvel que deseja vender ou alugar. Nossa equipe receberá as informações para conferir o cadastro e entrar em contato.</p><p className="mt-3 text-xs text-stone-500">Não precisa entrar em uma conta Google. Campos com * são obrigatórios. Quando não souber uma informação, escreva “Não sei”.</p></div>
    </header>
    {done ? <section className="mt-5 rounded-2xl border border-green-200 bg-white p-8" role="status"><CheckCircle2 className="mb-4 h-10 w-10 text-green-700"/><h2 className="text-2xl font-semibold">Cadastro recebido!</h2><p className="mt-3 leading-7">Obrigado. Sua ficha e a foto da fachada foram enviadas à equipe para análise. Entraremos em contato pelo WhatsApp informado.</p><p className="mt-4 text-sm text-stone-500">Este envio não publica anúncios automaticamente.</p></section>
    : link.isLoading ? <p role="status" className="p-6">Validando seu link…</p>
    : link.isError ? <p role="alert" className="p-6">Não foi possível validar o link. Verifique a conexão e atualize a página.</p>
    : !link.data?.valid ? <p role="alert" className="p-6">Este link expirou ou já foi utilizado. Peça um novo formulário à equipe.</p>
    : <form onSubmit={next} className="mt-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6"><div className="mb-2 flex justify-between text-xs text-stone-500"><span>Etapa {step+1} de 6</span><span>{steps[step]}</span></div><progress aria-label="Progresso do cadastro" className="h-2 w-full accent-[#bc9349]" value={step+1} max={6}/></div>
      <h2 ref={heading} tabIndex={-1} className="mb-6 flex items-center gap-2 text-xl font-semibold outline-none"><Home className="h-5 w-5 text-amber-800"/>{steps[step]}</h2>
      <div className="space-y-5">
      {step===0 && <>{field("name","Nome completo do proprietário",true)}{field("phone","WhatsApp com DDD",true,"tel")}{field("email","E-mail (opcional)",false,"email")}<label className="block text-sm font-medium">O que deseja fazer? *<select className={control} value={answers.intention} onChange={e=>set("intention",e.target.value)}><option value="venda">Vender</option><option value="locacao">Alugar</option></select></label>{choice("propertyType","Tipo de imóvel",["apartamento","casa","kitnet","kitão","terreno","sobrado","comercial","outro"],true)}</>}
      {step===1 && <>{field("cep","CEP (se souber)")}{field("city","Cidade",true)}{field("state","UF",true,"text","Exemplo: SP")}{field("neighborhood","Bairro",true)}{field("street","Rua ou avenida",true)}{field("number","Número",true,"text","Se não houver número, escreva S/N.")}{field("complement","Apartamento, unidade, bloco ou lote",false,"text","Informe todos os identificadores da unidade. Exemplo: apartamento 305, bloco B.")}<p className="text-xs text-stone-500">O endereço completo será usado pela equipe para identificar o imóvel.</p></>}
      {step===2 && <>{field("area","Área útil em m² (ou Não sei)")}{field("bedrooms","Dormitórios")}{field("suites","Suítes")}{field("bathrooms","Banheiros")}{field("parking","Vagas para carro")}{choice("balcony","Tem sacada?",["Sim","Não","Não sei"])}{choice("view","Tem vista livre?",["Sim","Não","Não sei"])}{choice("furnished","Fica mobiliado?",["Sim","Parcialmente","Não","Não sei"])}{text("amenities","Outros diferenciais: elevadores, lazer, churrasqueira…")}</>}
      {step===3 && <>{field("price","Valor pretendido em reais (ou Não sei)")}{field("condominium","Condomínio mensal em reais (ou Não se aplica)")}{field("iptu","IPTU: valor e se é mensal ou anual")}{text("negotiation","Condições: aceita financiamento, proposta, permuta ou parcelamento?")}</>}
      {step===4 && <>{choice("occupancy","O imóvel está…",["Vazio","Ocupado pelo proprietário","Alugado","Em construção","Outro","Não sei"])}{choice("deed","Possui escritura e registro?",["Sim","Não","Em regularização","Não sei"])}{choice("financing","Existe financiamento a quitar?",["Sim","Não","Não sei"])}{choice("debts","Há pendências de condomínio, IPTU ou documentação?",["Sim","Não","Não sei"])}<p className="text-sm text-stone-500">Nesta etapa basta informar a situação. Não envie documentos pessoais ou senhas.</p></>}
      {step===5 && <><label className="block text-sm font-medium"><span className="flex items-center gap-2"><Camera className="h-5 w-5"/>Foto real da frente/fachada *</span><span className="mt-2 block text-xs font-normal text-stone-500">Apenas para localização e identificação rápida. A equipe conferirá a imagem antes de qualquer divulgação.</span><input className={control} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||photoBusy} onChange={e=>void choosePhoto(e.target.files?.[0])}/></label>{photoBusy && <p role="status">Preparando foto…</p>}{photo && <img src={photo} alt="Prévia da fachada escolhida" className="max-h-64 w-full rounded-lg object-contain"/>}{text("observations","Antes de finalizar: tem algo importante sobre o imóvel que gostaria de informar? Se não tiver mais nada, escreva OK.",1000)}<div className="rounded-lg bg-stone-50 p-4 text-sm leading-6"><strong>Confira antes de enviar</strong><p>{answers.name} · {answers.phone}</p><p>{answers.intention === "venda" ? "Venda" : "Locação"} · {answers.propertyType}</p><p>{answers.street}, {answers.number}{answers.complement && ` · ${answers.complement}`}</p><p>{answers.neighborhood} · {answers.city}/{answers.state}</p><p>Valor: {answers.price || "Não informado"}</p><p className="mt-2 text-xs text-stone-500">Use Voltar para corrigir qualquer resposta.</p></div><label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1 h-5 w-5 accent-amber-800" type="checkbox" checked={consent} required onChange={e=>setConsent(e.target.checked)}/><span>Autorizo o uso dos dados para análise do cadastro e contato da equipe. Li a <a href="/privacidade" target="_blank" rel="noreferrer" className="underline">Política de Privacidade</a>. Este formulário não substitui a autorização de divulgação do imóvel.</span></label></>}
      </div>
      <div aria-hidden="true" className="hidden"><input tabIndex={-1} autoComplete="off" value={answers.website} onChange={e=>set("website",e.target.value)} /></div>
      {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="mt-8 flex justify-between gap-3">{step>0 ? <button type="button" disabled={busy} onClick={()=>{setStep(step-1);setError("");}} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-5 py-3 disabled:opacity-50"><ArrowLeft className="h-4 w-4"/>Voltar</button> : <span/>}<button disabled={busy||photoBusy} className="inline-flex items-center gap-2 rounded-lg bg-[#173c33] px-6 py-3 font-medium text-white disabled:opacity-50">{busy ? "Enviando…" : step===5 ? "Enviar cadastro" : "Avançar"}<ArrowRight className="h-4 w-4"/></button></div>
      <p className="mt-5 text-xs leading-5 text-stone-500">As respostas ficam temporariamente nesta aba durante o preenchimento. A foto precisa ser escolhida novamente se a página for recarregada. O cadastro chega à equipe ao clicar em Enviar.</p>
    </form>}
    <footer className="py-6 text-center text-xs text-stone-500">E. Santos · Gestor Imobiliário · CRECI 134718-F</footer>
  </main></div>;
}
