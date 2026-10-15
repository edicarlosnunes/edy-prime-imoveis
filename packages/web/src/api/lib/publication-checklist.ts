import { propertyPrice } from "../../shared/property-price";
import { eq } from "drizzle-orm";
import type { AdminDb } from "./admin-base";
import { findIntegration, readConfig } from "./integrations";
import { testMercadoLivre } from "./mercadolivre";
import * as schema from "../database/schema";

export type PublicationCheck = { ok: boolean; label: string; detail: string };
export const OLX_MANUAL_REASON = "Integração automática exige plano profissional elegível. O plano consultado custava R$ 250/mês e não foi contratado. Nesta conta, cadastrar o anúncio manualmente na OLX. Verificado em 15/10/2026.";

/** Chamadas somente de consulta: nunca cria anúncio nem contrata pacote. */
export async function mercadoLivreChecks(db: AdminDb, price: number, type: string, purpose: string): Promise<PublicationCheck[]> {
  const checks: PublicationCheck[] = [];
  try {
    const connection = await testMercadoLivre(db);
    checks.push({ ok: connection.ok, label: "Autorização da conta", detail: connection.ok ? "Conta brasileira autorizada e validada na API." : connection.message });
    if (!connection.ok) return checks;
    const { config } = await readConfig(db, "mercadolivre");
    const get = async (path: string) => {
      const response = await fetch(`https://api.mercadolibre.com${path}`, { headers: { authorization: `Bearer ${config.accessToken}` }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) {
        const step = path.includes("available_listing_types") ? "modalidades da conta" : path.includes("listing_prices") ? "custos do anúncio" : "categorias de imóveis";
        throw new Error(`Consulta de ${step} recusada pelo Mercado Livre (HTTP ${response.status}).`);
      }
      return await response.json();
    };
    if (type !== "apartamento" || purpose !== "venda") {
      checks.push({ ok: false, label: "Categoria do anúncio", detail: "A seleção de categoria desta modalidade ainda precisa ser preparada no CRM." });
      return checks;
    }
    const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    let children = await get("/sites/MLB/categories") as { id: string; name: string }[];
    let categoryId = "";
    for (const word of ["imove", "apartamento", "venda"]) {
      const found = children.find((entry) => normalize(entry.name).includes(word));
      if (!found) throw new Error("Não foi possível determinar com segurança a categoria Apartamentos à venda na API.");
      categoryId = found.id;
      const category = await get(`/categories/${categoryId}`) as { children_categories?: { id: string; name: string }[] };
      children = category.children_categories ?? [];
    }
    if (children.length) throw new Error("A categoria encontrada ainda exige uma subcategoria. Nenhum anúncio foi enviado.");
    checks.push({ ok: true, label: "Categoria do anúncio", detail: `Apartamentos à venda: ${categoryId}.` });
    const available = await get(`/users/${config.sellerId}/available_listing_types?category_id=${categoryId}`) as { available?: { id: string; name: string }[] };
    const types = available.available ?? [];
    checks.push({ ok: types.length > 0, label: "Modalidades disponíveis na conta", detail: types.length ? types.map((t) => `${t.name} (${t.id})`).join(", ") : "A API não retornou modalidades disponíveis para esta categoria." });
    const prices = await get(`/sites/MLB/listing_prices?price=${encodeURIComponent(String(price))}&category_id=${categoryId}`);
    const quotes = (Array.isArray(prices) ? prices : [prices]) as { listing_type_id?: string; listing_fee_amount?: number; sale_fee_amount?: number; currency_id?: string }[];
    const eligible = quotes.filter((q) => types.some((t) => t.id === q.listing_type_id));
    const free = eligible.find((q) => q.listing_type_id === "free" && q.currency_id === "BRL" && q.listing_fee_amount === 0 && q.sale_fee_amount === 0);
    checks.push({ ok: Boolean(free), label: "Gratuidade", detail: free ? "Modalidade free retornada com taxas de anúncio e venda iguais a zero. A criação ainda precisa ser validada." : eligible.length ? `Nenhuma modalidade free com todas as taxas zeradas foi confirmada. Consulta: ${eligible.map((q) => `${q.listing_type_id}: anúncio ${q.listing_fee_amount ?? "não informado"}, venda ${q.sale_fee_amount ?? "não informada"} ${q.currency_id ?? ""}`).join("; ")}. Nenhum plano contratado.` : "A API não confirmou uma modalidade gratuita elegível. Nenhum plano contratado." });
  } catch (error) {
    checks.push({ ok: false, label: "Consulta ao Mercado Livre", detail: error instanceof Error ? error.message : "Falha na consulta; tente novamente." });
  }
  checks.push({ ok: false, label: "Envio do anúncio", detail: "O adaptador de criação do anúncio ainda não está implementado no CRM. Este teste consulta a conta e as condições; nenhum imóvel foi publicado." });
  return checks;
}

export async function propertyPublicationChecks(db: AdminDb, propertyId: number, key: string) {
  const [property] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).limit(1);
  if (!property) throw new Error("Imóvel não encontrado.");
  const photos = await db.select({ id: schema.propertyImages.id }).from(schema.propertyImages).where(eq(schema.propertyImages.propertyId, propertyId));
  const checks: PublicationCheck[] = [
    { ok: property.status === "disponivel" && property.published === 1, label: "Imóvel disponível e publicado no site", detail: property.code },
    { ok: Boolean(property.title && property.description), label: "Título e descrição", detail: property.title && property.description ? "Preenchidos no cadastro." : "Complete o título e a descrição." },
    { ok: property.price > 0, label: "Preço", detail: property.price > 0 ? "Preço preenchido." : "Informe o preço do imóvel." },
    { ok: photos.length > 0, label: "Fotos", detail: `${photos.length} foto(s) cadastrada(s).` },
  ];
  if (key === "mercadolivre") checks.push(...await mercadoLivreChecks(db, propertyPrice(property).current, property.type, property.purpose));
  else if (key === "olx") checks.push({ ok: false, label: "Publicação manual", detail: OLX_MANUAL_REASON });
  else if (key === "tiktok") checks.push({ ok: false, label: "Envio pelo CRM", detail: "Publicação de vídeo pelo Metricool já foi testada. Falta ligar o envio do Book completo a este botão do CRM." });
  else {
    const definition = findIntegration(key);
    const current = await readConfig(db, key);
    if (definition && definition.category !== "Portais de Imóveis") checks.push({ ok: false, label: "Tipo de integração", detail: "Serviço de apoio do CRM; não é um destino de anúncios. " + definition.purpose });
    else {
      checks.push({ ok: current.row?.status === "conectado", label: "Conexão da plataforma", detail: current.row?.status === "conectado" ? "Conexão registrada no CRM." : "Conexão ainda não concluída." });
      for (const detail of definition?.pending ?? []) checks.push({ ok: false, label: "Requisito a conferir", detail });
      checks.push({ ok: false, label: "Envio por este botão", detail: "Ainda não disponível para esta plataforma. Nenhum anúncio foi publicado." });
    }
  }
  return checks;
}
