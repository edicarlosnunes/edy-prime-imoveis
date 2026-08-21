import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  ArrowUpRight,
  Bath,
  BedDouble,
  Car,
  Check,
  Copy,
  Loader2,
  MapPin,
  Maximize,
} from "lucide-react";
import { Header } from "../components/site/header";
import { Footer } from "../components/site/footer";
import { WhatsappFab } from "../components/site/whatsapp-fab";
import { SiteChrome } from "../components/site/content";
import { usePropertyDetail } from "../queries/properties";
import { useCreateLead } from "../queries/leads";
import { formatBRL, site, whatsappLink } from "../lib/site";

const statusLabel: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  alugado: "Alugado",
};

const purposeLabel: Record<string, string> = {
  venda: "Venda",
  locacao: "Locação",
  venda_locacao: "Venda ou locação",
};

const typeLabel: Record<string, string> = {
  apartamento: "Apartamento",
  casa: "Casa",
  cobertura: "Cobertura",
  sobrado: "Sobrado",
  terreno: "Terreno",
  sala_comercial: "Sala comercial",
  chacara: "Chácara",
  outro: "Imóvel",
};

/** Meta tags no cliente — o servidor já injeta as tags para Google/WhatsApp. */
function useMeta(title: string | null, description: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    const tag = document.querySelector('meta[name="description"]');
    const previousDescription = tag?.getAttribute("content") ?? null;
    if (tag && description) tag.setAttribute("content", description);
    return () => {
      document.title = previous;
      if (tag && previousDescription) tag.setAttribute("content", previousDescription);
    };
  }, [title, description]);
}

function ContactForm({ code, title }: { code: string; title: string }) {
  const createLead = useCreateLead();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="border border-line bg-white p-6">
        <div className="flex h-11 w-11 items-center justify-center border border-brass/40 bg-brass/10">
          <Check className="h-5 w-5 text-brass" strokeWidth={1.6} />
        </div>
        <h3 className="display mt-4 text-2xl text-deep">Recebido.</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Vou responder pelo WhatsApp com as informações do imóvel {code}.
        </p>
        <a
          href={whatsappLink(`Olá, ${site.broker}. Enviei o formulário sobre o imóvel ${code}.`)}
          target="_blank"
          rel="noreferrer"
          className="label-xs mt-4 inline-flex items-center gap-2 bg-brass px-6 py-3.5 text-white transition-colors hover:bg-brass-soft"
        >
          Adiantar pelo WhatsApp <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 border border-line bg-white p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (createLead.isPending) return;
        const params = new URLSearchParams(window.location.search);
        try {
          await createLead.mutateAsync({
            name,
            phone,
            interest: `Imóvel ${code} — ${title}`,
            message: message || undefined,
            source: "pagina_imovel",
            propertyCode: code,
            utmSource: params.get("utm_source") ?? undefined,
            utmMedium: params.get("utm_medium") ?? undefined,
            utmCampaign: params.get("utm_campaign") ?? undefined,
          });
          setDone(true);
        } catch {
          /* mensagem abaixo */
        }
      }}
    >
      <p className="label-xs text-brass">Falar sobre este imóvel</p>
      <input
        required
        placeholder="Seu nome"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="w-full border border-line bg-white px-4 py-3.5 text-sm text-ink outline-none focus:border-brass"
      />
      <input
        required
        placeholder="WhatsApp com DDD"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        className="w-full border border-line bg-white px-4 py-3.5 text-sm text-ink outline-none focus:border-brass"
      />
      <textarea
        placeholder="Quer agendar visita? Conte aqui."
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        className="min-h-24 w-full border border-line bg-white px-4 py-3.5 text-sm text-ink outline-none focus:border-brass"
      />
      <button
        type="submit"
        disabled={createLead.isPending}
        className="label-xs inline-flex w-full items-center justify-center gap-2 bg-deep px-6 py-4 text-white transition-colors hover:bg-deep/85 disabled:opacity-60"
      >
        {createLead.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Quero informações
      </button>
      {createLead.isError && (
        <p className="text-xs text-red-700">Não foi possível enviar agora. Tente pelo WhatsApp.</p>
      )}
    </form>
  );
}

function PropertyPage() {
  const params = useParams();
  const slug = params.slug ?? "";
  const query = usePropertyDetail(slug);
  const property = query.data?.property ?? null;
  const related = query.data?.related ?? [];
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  useMeta(
    property ? `${property.title} — ${property.district}, ${property.city} | Edy Premi Imóveis` : null,
    property
      ? `${property.bedrooms} dorm., ${property.parking} vaga(s), ${property.area} m² em ${property.district}. ${formatBRL(property.price)}. Código ${property.code}.`
      : null,
  );

  return (
    <div className="site-shell min-h-screen bg-paper">
      <SiteChrome />
      <Header />

      <main className="mx-auto max-w-[1240px] px-6 py-16 lg:px-8 lg:py-20">
        <Link
          href="/#imoveis"
          className="label-xs inline-flex items-center gap-2 text-muted transition-colors hover:text-brass"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para a vitrine
        </Link>

        {query.isLoading && (
          <div className="mt-10 animate-pulse space-y-6">
            <div className="aspect-[16/9] w-full bg-bone" />
            <div className="h-6 w-2/3 bg-bone" />
            <div className="h-4 w-1/3 bg-bone" />
          </div>
        )}

        {!query.isLoading && !property && (
          <div className="mt-16 border border-line bg-white p-10 text-center">
            <h1 className="display text-3xl text-deep">Imóvel não encontrado</h1>
            <p className="mt-3 text-sm text-muted">
              Este imóvel pode ter sido vendido ou saído do site. Veja as opções disponíveis na
              vitrine ou fale comigo no WhatsApp {site.whatsappLabel}.
            </p>
            <Link
              href="/#imoveis"
              className="label-xs mt-6 inline-flex items-center gap-2 bg-deep px-6 py-3.5 text-white"
            >
              Ver imóveis disponíveis
            </Link>
          </div>
        )}

        {property && (
          <>
            <div className="mt-8 grid gap-10 lg:grid-cols-[1.35fr_0.65fr]">
              <div>
                <div className="relative overflow-hidden">
                  <img
                    src={property.images[active] ?? property.image}
                    alt={property.title}
                    className="aspect-[16/10] w-full object-cover"
                  />
                  <span className="label-xs absolute top-4 left-4 bg-deep/90 px-3 py-1.5 text-white">
                    {statusLabel[property.status] ?? property.status}
                  </span>
                </div>
                {property.images.length > 1 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {property.images.map((image, index) => (
                      <button
                        key={`${image}-${index}`}
                        type="button"
                        onClick={() => setActive(index)}
                        aria-label={`Foto ${index + 1}`}
                        className={
                          index === active
                            ? "h-16 w-24 shrink-0 border-2 border-brass"
                            : "h-16 w-24 shrink-0 border border-line opacity-80 hover:opacity-100"
                        }
                      >
                        <img src={image} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                <p className="label-xs mt-8 text-brass">
                  {typeLabel[property.type] ?? "Imóvel"} · {purposeLabel[property.purpose] ?? property.purpose} ·{" "}
                  {property.code}
                </p>
                <h1 className="display mt-3 text-[calc(clamp(2rem,3.4vw,2.9rem))] leading-tight text-deep">
                  {property.title}
                </h1>
                <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <MapPin className="h-4 w-4 text-brass" strokeWidth={1.6} />
                  {[property.address, property.district, property.city].filter(Boolean).join(" · ")}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-4 border-y border-line py-5 sm:grid-cols-4">
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <BedDouble className="h-4 w-4 text-brass" strokeWidth={1.5} />
                    {property.bedrooms} dorm.
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <Bath className="h-4 w-4 text-brass" strokeWidth={1.5} />
                    {property.bathrooms} banh.
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <Car className="h-4 w-4 text-brass" strokeWidth={1.5} />
                    {property.parking} vaga{property.parking === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <Maximize className="h-4 w-4 text-brass" strokeWidth={1.5} />
                    {property.area} m²
                  </span>
                </div>

                {property.description && (
                  <div className="mt-8">
                    <h2 className="display text-2xl text-deep">Sobre o imóvel</h2>
                    <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted">
                      {property.description}
                    </p>
                  </div>
                )}

                {property.features.length > 0 && (
                  <div className="mt-8">
                    <h2 className="display text-2xl text-deep">Características</h2>
                    <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                      {property.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm text-muted">
                          <Check className="h-3.5 w-3.5 text-brass" strokeWidth={2} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
                <div className="border border-line bg-white p-6">
                  <p className="label-xs text-muted">
                    {purposeLabel[property.purpose] ?? property.purpose}
                  </p>
                  <p className="display mt-2 text-4xl text-deep">{formatBRL(property.price)}</p>
                  <div className="mt-4 space-y-1 text-xs text-muted">
                    {property.condoFee ? <p>Condomínio: {formatBRL(property.condoFee)}</p> : null}
                    {property.iptu ? <p>IPTU: {formatBRL(property.iptu)}</p> : null}
                    {property.areaTotal ? <p>Área total: {property.areaTotal} m²</p> : null}
                    {property.suites ? <p>Suítes: {property.suites}</p> : null}
                  </div>
                  <a
                    href={whatsappLink(
                      `Olá, ${site.broker}. Tenho interesse no imóvel ${property.code} (${property.title}). Pode me passar mais detalhes?`,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="label-xs mt-5 inline-flex w-full items-center justify-center gap-2 bg-brass px-6 py-4 text-white transition-colors hover:bg-brass-soft"
                  >
                    Falar no WhatsApp <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(window.location.href);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    }}
                    className="label-xs mt-2 inline-flex w-full items-center justify-center gap-2 border border-line px-6 py-3.5 text-deep transition-colors hover:border-brass"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-brass" /> Link copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Compartilhar
                      </>
                    )}
                  </button>
                </div>

                <ContactForm code={property.code} title={property.title} />
              </aside>
            </div>

            {related.length > 0 && (
              <section className="mt-20 border-t border-line pt-12">
                <h2 className="display text-3xl text-deep">Imóveis parecidos</h2>
                <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                  {related.map((item) => (
                    <Link key={item.code} href={`/imovel/${item.slug}`} className="group block">
                      <img
                        src={item.image}
                        alt={item.title}
                        className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                      />
                      <p className="label-xs mt-4 text-brass">
                        {item.district} · {item.code}
                      </p>
                      <h3 className="display mt-2 text-xl leading-snug text-deep">{item.title}</h3>
                      <p className="display mt-2 text-2xl text-deep">{formatBRL(item.price)}</p>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <Footer />
      <WhatsappFab />
    </div>
  );
}

export default PropertyPage;
