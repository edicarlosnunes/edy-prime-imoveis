import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { orpc } from "../lib/api";

export interface CampaignContent {
  title: string;
  highlight: string;
  description: string;
  cover: string;
  background: string;
  video: string;
  website: string;
  email: string;
  whatsapp: string;
}

export function CampaignView({ data }: { data: CampaignContent }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-white/15 bg-[#111b2c] text-white">
      <div className="relative isolate px-6 py-10 text-center">
        {data.background && <img className="absolute inset-0 -z-10 h-full w-full object-cover opacity-20" src={data.background} alt="" />}
        <p className="mb-3 text-sm text-amber-300">E. Santos Gestor Imobiliário</p>
        <h1 className="text-3xl font-bold sm:text-4xl">{data.title}</h1>
        {data.highlight && <p className="mt-3 text-white/85">{data.highlight}</p>}
      </div>
      {data.video ? (
        <video className="mx-auto aspect-square w-full max-w-xl bg-black object-contain" key={data.video}
          src={data.video} poster={data.cover || undefined} controls playsInline preload="none" />
      ) : data.cover ? <img className="mx-auto w-full max-w-xl" src={data.cover} alt={data.title} /> : null}
      <div className="p-6 text-center">
        <p className="whitespace-pre-line">{data.description}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-4 underline underline-offset-4">
          {/^55\d{10,11}$/.test(data.whatsapp) && <a className="font-semibold text-amber-300" href={`https://wa.me/${data.whatsapp}`}>Chamar no WhatsApp</a>}
          {data.email && <a href={`mailto:${encodeURIComponent(data.email).replace("%40", "@")}`}>Enviar e-mail</a>}
          {data.website.startsWith("https://") && <a href={data.website}>Visitar o site</a>}
          <Link href="/captar">Preencher cadastro do imóvel</Link>
        </div>
      </div>
    </article>
  );
}

export function CampaignPage({ slug }: { slug: string }) {
  const query = useQuery(orpc.publicCampaigns.get.queryOptions({ input: { slug }, retry: false }));
  return (
    <main className="min-h-screen bg-[#090f19] px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="mb-6 inline-block underline">Voltar ao site</Link>
        {query.isPending ? <p>Carregando campanha…</p> : query.data ? <CampaignView data={query.data} /> : (
          <p>{query.isError ? "Não foi possível carregar a campanha." : "Campanha indisponível."} <Link href="/captar" className="underline">Cadastre seu imóvel</Link></p>
        )}
      </div>
    </main>
  );
}

export function CampaignHomeLink() {
  const { data } = useQuery(orpc.publicCampaigns.get.queryOptions({
    input: { slug: "cadastre-seu-imovel" }, retry: false,
  }));
  if (!data) return null;
  return (
    <div className="py-6 text-center">
      <Link href="/cadastre-seu-imovel" className="inline-block rounded-lg bg-ink px-5 py-3 font-semibold text-white">
        Cadastre seu imóvel
      </Link>
    </div>
  );
}
