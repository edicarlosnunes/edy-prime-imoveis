import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Check, Loader2, ArrowRight, ArrowLeft, Camera, Image as ImageIcon, Upload } from "lucide-react";
import { useOwnerLinkMetadata, useStartOwnerLink, useSubmitOwnerLink } from "../queries/owner-links";
import { formatCep, isValidCep, normalizeCep, COMPLEMENT_FIELDS } from "../../api/lib/capture-address";
import { lookupCep } from "../../api/lib/cep-lookup";
import { parseMoneyInput, formatMoneyInput } from "../lib/money-input";

const PROPERTY_TYPES = ["Apartamento", "Casa", "Cobertura", "Terreno", "Comercial", "Outro"];

export default function CaptacaoPublica() {
  const [, params] = useRoute("/captacao/:token");
  const token = params?.token || null;

  const metadata = useOwnerLinkMetadata(token);
  const start = useStartOwnerLink();
  const started = useRef(false);

  useEffect(() => {
    if (metadata.isSuccess && metadata.data && metadata.data.status === "aguardando" && !started.current) {
      started.current = true;
      start.mutate({ token: token! });
    }
  }, [metadata.isSuccess, metadata.data, token, start]);

  if (!token) return <Unavailable message="Link ausente." />;
  if (metadata.isLoading) return <Loading />;
  if (metadata.isError) return <Unavailable message="Link inválido, expirado ou já concluído." />;
  
  const linkData = metadata.data!;
  if (linkData.status === "concluido") return <Unavailable message="Esta ficha já foi enviada e concluída." />;

  return <FormWizard token={token} linkData={linkData} />;
}

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <Loader2 className="h-6 w-6 animate-spin text-brass" />
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-white p-8 text-center shadow-sm">
        <h1 className="mb-4 text-2xl font-medium text-deep">Ficha indisponível</h1>
        <p className="text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}

function FormWizard({ token, linkData }: { token: string; linkData: any }) {
  const [step, setStep] = useState(1);
  const submit = useSubmitOwnerLink();

  // State: 1
  const [name, setName] = useState(linkData.ownerName || "");
  const [phone, setPhone] = useState(linkData.phone || "");
  const [email, setEmail] = useState("");

  // State: 2
  const [intention, setIntention] = useState<"vender"|"alugar">("vender");
  const [propertyType, setPropertyType] = useState(PROPERTY_TYPES[0]);
  const [cep, setCep] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [complements, setComplements] = useState<Record<string, string>>({});
  const [cepBusy, setCepBusy] = useState(false);
  const [cepNote, setCepNote] = useState("");
  const [showManualAddress, setShowManualAddress] = useState(false);

  // State: 3
  const [qualification, setQualification] = useState("");
  const [documentation, setDocumentation] = useState("");

  // State: 4
  const [askingPrice, setAskingPrice] = useState("");
  const [features, setFeatures] = useState("");
  const [condition, setCondition] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [availability, setAvailability] = useState("");

  // State: 5
  const [facadeImage, setFacadeImage] = useState<{ data: string; name: string } | null>(null);

  // State: 6 (Review & Submit) -> done inside component
  const [done, setDone] = useState(false);

  async function handleCep(val: string) {
    const masked = formatCep(val);
    setCep(masked);
    if (!isValidCep(masked)) return;
    setCepBusy(true);
    setCepNote("");
    const result = await lookupCep(masked);
    setCepBusy(false);
    if (result.ok) {
      setStreet(result.address.street);
      setCity(result.address.city);
      setState(result.address.state);
      if (!neighborhood && result.address.district) setNeighborhood(result.address.district);
      setShowManualAddress(true);
      setCepNote(result.address.street ? "" : "CEP geral: confirme a rua abaixo.");
    } else {
      setShowManualAddress(true);
      setCepNote(`${result.reason} Pode preencher o endereço manualmente.`);
    }
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("A imagem deve ter no máximo 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFacadeImage({ data: reader.result as string, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  async function doSubmit() {
    try {
      const price = parseMoneyInput(askingPrice);
      const cleanComps = Object.fromEntries(Object.entries(complements).filter(([, v]) => (v || "").trim().length > 0));
      await submit.mutateAsync({
        token,
        name,
        phone: phone || undefined,
        email: email || undefined,
        intention,
        propertyType,
        cep: normalizeCep(cep) || undefined,
        street: street || undefined,
        number: number || undefined,
        neighborhood: neighborhood || undefined,
        city: city || undefined,
        state: state || undefined,
        complements: Object.keys(cleanComps).length > 0 ? cleanComps : undefined,
        askingPrice: price !== null ? price : undefined,
        qualification: [
          qualification,
          features ? `Características principais: ${features}` : "",
          condition ? `Condição do imóvel: ${condition}` : "",
          occupancy ? `Ocupação: ${occupancy}` : "",
          availability ? `Disponibilidade: ${availability}` : "",
        ].filter(Boolean).join("\n") || undefined,
        documentation: documentation || undefined,
        facadeImage: facadeImage!.data,
      });
      setDone(true);
      window.scrollTo(0, 0);
    } catch (e: any) {
      alert(e.message || "Erro ao enviar. Tente novamente.");
    }
  }

  if (done) {
    return (
      <div className="site-shell flex min-h-screen flex-col items-center justify-center bg-paper p-6 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brass/20 text-brass">
          <Check className="h-8 w-8" />
        </div>
        <h1 className="mb-4 font-display text-4xl text-deep">Ficha recebida</h1>
        <p className="mb-10 max-w-md text-muted leading-relaxed">
          Os dados do seu imóvel foram registrados com sucesso. Nossa equipe avaliará as informações e fará contato em breve.
        </p>
      </div>
    );
  }

  const inputClass = "w-full rounded-[10px] border border-line bg-white px-4 py-3.5 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-brass";
  const labelClass = "mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted";

  return (
    <div className="site-shell min-h-screen bg-paper text-ink pb-24">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-6 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-deep text-white">
            <span className="font-display font-medium text-lg">EP</span>
          </div>
          <div>
            <div className="text-[10px] font-semibold tracking-widest text-brass uppercase">Edy Prime</div>
            <h1 className="font-display text-xl text-deep">Ficha do Imóvel</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-brass' : 'bg-line/40'}`} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] font-semibold tracking-wide uppercase text-muted">
          <span>Passo {step} de 6</span>
          <span>{['Identificação', 'Endereço', 'Situação', 'Características', 'Fachada', 'Revisão'][step - 1]}</span>
        </div>
      </div>

      <main className="mx-auto max-w-2xl px-6">
        <div className="rounded-[16px] border border-line bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:p-10">
          
          {step === 1 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="mb-2 font-display text-3xl text-deep">Proprietário</h2>
              <p className="mb-8 text-sm text-muted">Confirme seus dados para podermos retornar o contato com precisão.</p>
              
              <div className="space-y-5">
                <div>
                  <label className={labelClass}>Seu nome *</label>
                  <input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo" />
                </div>
                <div>
                  <label className={labelClass}>WhatsApp *</label>
                  <input className={inputClass} value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
                </div>
                <div>
                  <label className={labelClass}>E-mail (opcional)</label>
                  <input type="email" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="mb-2 font-display text-3xl text-deep">O Imóvel</h2>
              <p className="mb-8 text-sm text-muted">Onde o imóvel está localizado e qual a sua intenção.</p>

              <div className="space-y-6">
                <div>
                  <label className={labelClass}>Intenção *</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setIntention("vender")} className={`rounded-[10px] border px-4 py-3 text-sm font-medium transition-colors ${intention === 'vender' ? 'border-brass bg-brass/10 text-brass' : 'border-line text-muted hover:bg-bone/30'}`}>
                      Quero vender
                    </button>
                    <button type="button" onClick={() => setIntention("alugar")} className={`rounded-[10px] border px-4 py-3 text-sm font-medium transition-colors ${intention === 'alugar' ? 'border-brass bg-brass/10 text-brass' : 'border-line text-muted hover:bg-bone/30'}`}>
                      Quero alugar
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Tipo de Imóvel *</label>
                  <select className={inputClass} value={propertyType} onChange={e => setPropertyType(e.target.value)}>
                    {PROPERTY_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                  </select>
                </div>

                <div className="border-t border-line pt-6">
                  <div className="mb-4">
                    <label className={labelClass}>CEP do Imóvel</label>
                    <input className={inputClass} value={cep} onChange={e => handleCep(e.target.value)} placeholder="00000-000" inputMode="numeric" />
                    {cepBusy && <div className="mt-2 flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Buscando...</div>}
                    {cepNote && <div className="mt-2 text-xs text-brass">{cepNote}</div>}
                  </div>

                  {showManualAddress && (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-4">
                        <div className="sm:col-span-3">
                          <label className={labelClass}>Logradouro</label>
                          <input className={inputClass} value={street} onChange={e => setStreet(e.target.value)} placeholder="Rua, Avenida..." />
                        </div>
                        <div>
                          <label className={labelClass}>Número</label>
                          <input className={inputClass} value={number} onChange={e => setNumber(e.target.value)} />
                        </div>
                      </div>
                      
                      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_1fr]">
                        <div>
                          <label className={labelClass}>Complemento</label>
                          <input className={inputClass} value={complements.complemento || ""} onChange={e => setComplements(p => ({...p, complemento: e.target.value}))} placeholder="Apto, Sala..." />
                        </div>
                        <div>
                          <label className={labelClass}>Bairro</label>
                          <input className={inputClass} value={neighborhood} onChange={e => setNeighborhood(e.target.value)} />
                        </div>
                        <div>
                          <label className={labelClass}>UF</label>
                          <input className={inputClass} value={state} onChange={e => setState(e.target.value.toUpperCase())} maxLength={2} placeholder="SP" />
                        </div>
                      </div>

                      <div className="pt-2">
                         <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-3">Mais Complementos (opcionais)</div>
                         <div className="grid gap-3 sm:grid-cols-2">
                           {COMPLEMENT_FIELDS.filter(f => f.key !== 'complemento').map(field => (
                             <div key={field.key}>
                               <input className={inputClass} value={complements[field.key] || ""} onChange={e => setComplements(p => ({...p, [field.key]: e.target.value}))} placeholder={field.label} />
                             </div>
                           ))}
                         </div>
                      </div>
                    </div>
                  )}
                  {!showManualAddress && (
                    <button type="button" onClick={() => setShowManualAddress(true)} className="mt-2 text-[11px] text-muted underline underline-offset-2 hover:text-deep">
                      Preencher endereço manualmente
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="mb-2 font-display text-3xl text-deep">Situação</h2>
              <p className="mb-8 text-sm text-muted">Forneça detalhes sobre a documentação e histórico recente.</p>

              <div className="space-y-6">
                <div>
                  <label className={labelClass}>Condição Atual e Disponibilidade</label>
                  <p className="mb-3 text-[13px] text-muted">Ex: Imóvel quitado? Aceita financiamento? Está ocupado? Quando estará livre?</p>
                  <textarea 
                    className={`${inputClass} min-h-24 resize-y`} 
                    value={qualification} 
                    onChange={e => setQualification(e.target.value)} 
                    placeholder="Descreva a situação atual do imóvel..."
                  />
                </div>

                <div>
                  <label className={labelClass}>Documentação e Taxas</label>
                  <p className="mb-3 text-[13px] text-muted">Ex: IPTU/Condomínio em dia? Escritura pública registrada?</p>
                  <textarea 
                    className={`${inputClass} min-h-24 resize-y`} 
                    value={documentation} 
                    onChange={e => setDocumentation(e.target.value)} 
                    placeholder="Descreva a documentação do imóvel..."
                  />
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="mb-2 font-display text-3xl text-deep">Características</h2>
              <p className="mb-8 text-sm text-muted">Quais os diferenciais e o valor pretendido pelo imóvel?</p>

              <div className="space-y-6">
                <div>
                  <label className={labelClass}>Valor pretendido (R$)</label>
                  <p className="mb-3 text-[13px] text-muted">Opcional. Nossa equipe fará uma avaliação e recomendará o preço ideal de mercado.</p>
                  <div className="relative max-w-sm">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
                    <input 
                      inputMode="decimal"
                      className={`${inputClass} pl-10 text-lg tabular-nums tracking-wide`} 
                      value={askingPrice}
                      onChange={e => setAskingPrice(e.target.value)}
                      onBlur={() => {
                        const parsed = parseMoneyInput(askingPrice);
                        if (parsed !== null) setAskingPrice(formatMoneyInput(parsed));
                      }}
                      placeholder="0,00"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Características principais</label>
                  <p className="mb-3 text-[13px] text-muted">Informe dormitórios, suítes, vagas, metragem e diferenciais relevantes.</p>
                  <textarea
                    className={`${inputClass} min-h-24 resize-y`}
                    value={features}
                    onChange={e => setFeatures(e.target.value)}
                    placeholder="Ex.: 2 dormitórios, 1 suíte, 1 vaga, varanda e 78 m²..."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Condição do imóvel</label>
                    <select className={inputClass} value={condition} onChange={e => setCondition(e.target.value)}>
                      <option value="">Selecione</option>
                      <option value="novo">Novo</option>
                      <option value="bom_estado">Bom estado</option>
                      <option value="precisa_reparos">Precisa de reparos</option>
                      <option value="em_reforma">Em reforma</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Ocupação</label>
                    <select className={inputClass} value={occupancy} onChange={e => setOccupancy(e.target.value)}>
                      <option value="">Selecione</option>
                      <option value="desocupado">Desocupado</option>
                      <option value="proprietario">Ocupado pelo proprietário</option>
                      <option value="inquilino">Ocupado por inquilino</option>
                      <option value="outro">Outra situação</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Disponibilidade para visitas ou entrega</label>
                  <input
                    className={inputClass}
                    value={availability}
                    onChange={e => setAvailability(e.target.value)}
                    placeholder="Ex.: visitas com 24h de antecedência; entrega imediata"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="mb-2 font-display text-3xl text-deep">Foto da Fachada</h2>
              <p className="mb-8 text-sm text-muted">Envie uma única foto limpa e clara da frente do imóvel.</p>

              <div className="space-y-6">
                <div className="rounded-[12px] border border-line bg-paper/30 p-5 text-[13px] leading-relaxed text-muted">
                  Para finalizar, envie uma foto da frente/fachada do imóvel. Essa imagem será utilizada apenas para facilitar a localização e identificação rápida do imóvel pela nossa equipe.
                </div>

                <div>
                  {!facadeImage ? (
                    <label className="group flex cursor-pointer flex-col items-center justify-center rounded-[12px] border-2 border-dashed border-line/60 bg-white px-6 py-12 transition-colors hover:border-brass hover:bg-brass/5">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-bone/30 text-muted transition-colors group-hover:bg-brass/20 group-hover:text-brass">
                        <Camera className="h-5 w-5" />
                      </div>
                      <span className="text-sm font-medium text-deep">Selecionar foto</span>
                      <span className="mt-1 text-xs text-muted">JPG, PNG ou WEBP. Máximo de 2 MB</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={handlePhotoSelect} />
                    </label>
                  ) : (
                    <div className="relative overflow-hidden rounded-[12px] border border-line bg-paper">
                      <img src={facadeImage.data} alt="Fachada" className="h-64 w-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent" />
                      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                        <span className="truncate text-xs font-medium text-white">{facadeImage.name}</span>
                        <label className="cursor-pointer rounded-md bg-white/20 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-white/30">
                          Trocar foto
                          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={handlePhotoSelect} />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="mb-2 font-display text-3xl text-deep">Revisar e Enviar</h2>
              <p className="mb-8 text-sm text-muted">Confira as informações antes de enviar a ficha para nossa equipe.</p>

              <div className="space-y-4 rounded-[12px] border border-line bg-paper/30 p-5 text-sm">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-muted uppercase mb-1">Proprietário</div>
                    <div className="font-medium text-deep">{name}</div>
                    <div className="text-muted">{phone}</div>
                    {email && <div className="text-muted">{email}</div>}
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-muted uppercase mb-1">Imóvel</div>
                    <div className="font-medium text-deep">{propertyType} para {intention === 'vender' ? 'Venda' : 'Locação'}</div>
                    {street && <div className="mt-1 text-muted leading-snug">{street}{number ? `, ${number}` : ''}{neighborhood ? ` - ${neighborhood}` : ''}</div>}
                    {askingPrice && <div className="mt-2 text-brass font-medium">{askingPrice}</div>}
                  </div>
                </div>
                
                {facadeImage && (
                  <div className="pt-4 border-t border-line/60">
                    <div className="text-[11px] font-semibold tracking-wide text-muted uppercase mb-2">Fachada Anexada</div>
                    <div className="flex items-center gap-2 text-xs font-medium text-deep">
                      <ImageIcon className="h-4 w-4 text-muted" />
                      <span className="truncate">{facadeImage.name}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-line/50 pt-6">
          {step > 1 ? (
            <button 
              type="button" 
              onClick={() => { setStep(s => s - 1); window.scrollTo(0, 0); }}
              disabled={submit.isPending}
              className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted transition-colors hover:text-deep disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
          ) : (
            <div />
          )}

          {step < 6 ? (
            <button 
              type="button" 
              onClick={() => {
                if (step === 1 && (!name || !phone)) { alert("Preencha o nome e o WhatsApp."); return; }
                if (step === 2 && !propertyType) { alert("Escolha o tipo de imóvel."); return; }
                if (step === 5 && !facadeImage) { alert("Envie uma foto da frente ou fachada do imóvel."); return; }
                setStep(s => s + 1);
                window.scrollTo(0, 0);
              }}
              className="flex items-center gap-2 rounded bg-brass px-6 py-3 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brass/90"
            >
              Avançar <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button 
              type="button" 
              onClick={doSubmit}
              disabled={submit.isPending}
              className="flex items-center gap-2 rounded bg-deep px-8 py-3 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-deep/90 disabled:opacity-70"
            >
              {submit.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</>
              ) : (
                <><Upload className="h-4 w-4" /> Finalizar e Enviar</>
              )}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}