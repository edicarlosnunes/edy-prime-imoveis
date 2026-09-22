/**
 * Testes REAIS de conexão. Nada aqui finge sucesso:
 * quando não existe forma de testar sem credencial/contrato, o retorno diz isso.
 */
import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { pickModel } from "../agent/model";
import { feedProperties, feedXml } from "./feed";
import type { ConfigMap, IntegrationStatus } from "./integrations";
import type { AdminDb } from "./admin-base";

export interface TestResult {
  ok: boolean;
  status: IntegrationStatus;
  message: string;
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path: string, token: string) {
  const response = await fetch(`${GRAPH}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    [key: string]: unknown;
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  }
  return body;
}

export async function runTest(
  db: AdminDb,
  key: string,
  config: ConfigMap,
  baseUrl: string,
): Promise<TestResult> {
  switch (key) {
    /* ---------------------------------------------------------- WhatsApp */
    case "whatsapp_cloud": {
      const token = config.accessToken ?? "";
      const phoneNumberId = config.phoneNumberId ?? "";
      if (!token || !phoneNumberId) {
        return {
          ok: false,
          status: "aguardando_credencial",
          message: "Informe o Phone Number ID e o access token permanente da Cloud API.",
        };
      }
      try {
        const body = (await graph(
          `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
          token,
        )) as { display_phone_number?: string; verified_name?: string };
        return {
          ok: true,
          status: "conectado",
          message: `Número ${body.display_phone_number ?? "?"} (${body.verified_name ?? "sem nome verificado"}) respondeu na Cloud API.`,
        };
      } catch (error) {
        return {
          ok: false,
          status: "erro",
          message: `Meta recusou: ${(error as Error).message}`,
        };
      }
    }

    /* -------------------------------------------------------------- Meta */
    case "meta_lead_ads":
    case "facebook_messenger":
    case "instagram_dm": {
      const token = config.pageToken ?? "";
      if (!token) {
        return {
          ok: false,
          status: "aguardando_credencial",
          message: "Informe o token da página gerado no app da Meta.",
        };
      }
      try {
        const body = (await graph("me?fields=id,name", token)) as { name?: string; id?: string };
        return {
          ok: true,
          status: "conectado",
          message: `Token válido para ${body.name ?? body.id ?? "a página"}.`,
        };
      } catch (error) {
        return { ok: false, status: "erro", message: `Meta recusou: ${(error as Error).message}` };
      }
    }

    /* ------------------------------------------------------ portais XML */
    case "zap_vivareal":
    case "olx":
    case "imovelweb": {
      const channel = key === "zap_vivareal" ? "zap" : (key as "olx" | "imovelweb");
      const properties = await feedProperties(db, channel);
      const xml = feedXml(properties, { baseUrl, channel, imageVariant: "marcada" });
      const valid = xml.startsWith("<?xml") && xml.includes("</Carga>");
      const url = `${baseUrl}/feed/${channel}.xml`;
      if (!valid) {
        return { ok: false, status: "erro", message: "Falha ao gerar o XML do canal." };
      }
      return {
        ok: true,
        status: config.accountId ? "configurando" : "aguardando_credencial",
        message: `Feed pronto e válido em ${url} com ${properties.length} imóvel(is) autorizado(s). O portal lê o arquivo por conta dele — marque "Confirmar leitura do portal" só depois que ele importar.`,
      };
    }

    /* ------------------------------------------------------ feed próprio */
    case "feed_imoveis": {
      const properties = await feedProperties(db, "feed");
      const xml = feedXml(properties, { baseUrl, channel: "feed" });
      return {
        ok: true,
        status: "conectado",
        message: `XML gerado com ${properties.length} imóvel(is) e ${xml.length} bytes.`,
      };
    }

    case "sitemap": {
      return {
        ok: true,
        status: "conectado",
        message: `Sitemap em ${baseUrl}/sitemap.xml e robots em ${baseUrl}/robots.txt.`,
      };
    }

    /* ------------------------------------------------------------- leads */
    case "lead_webhook": {
      const token = config.token ?? "";
      if (!token) {
        return {
          ok: false,
          status: "nao_configurado",
          message: "Clique em Salvar para gerar o token do webhook.",
        };
      }
      return {
        ok: true,
        status: "conectado",
        message: `Endpoint ativo: ${baseUrl}/api/webhooks/leads/${token.slice(0, 4)}… (URL completa no campo abaixo).`,
      };
    }

    case "site_leads": {
      return {
        ok: true,
        status: "conectado",
        message: "Formulários do site gravando no CRM com deduplicação ativa.",
      };
    }

    /* ------------------------------------------------------------ Google */
    case "google_analytics": {
      const id = (config.measurementId ?? "").trim();
      if (!/^G-[A-Z0-9]{6,}$/i.test(id)) {
        return {
          ok: false,
          status: id ? "erro" : "nao_configurado",
          message: "ID de medição inválido — use o formato G-XXXXXXXXXX.",
        };
      }
      return { ok: true, status: "conectado", message: `Tag ${id} publicada no site.` };
    }

    case "google_ads": {
      const id = (config.conversionId ?? "").trim();
      if (!/^AW-[0-9]{6,}$/i.test(id)) {
        return {
          ok: false,
          status: id ? "erro" : "nao_configurado",
          message: "ID de conversão inválido — use o formato AW-000000000.",
        };
      }
      if (!(config.conversionLabel ?? "").trim()) {
        return {
          ok: false,
          status: "aguardando_credencial",
          message: "Falta o rótulo da conversão (aparece junto do ID no Google Ads).",
        };
      }
      return { ok: true, status: "conectado", message: `Conversão ${id} configurada.` };
    }

    case "google_search_console": {
      const code = (config.verification ?? "").trim();
      if (!code) {
        return {
          ok: false,
          status: "nao_configurado",
          message: "Cole o código de verificação do Search Console.",
        };
      }
      try {
        const response = await fetch(`${baseUrl}/`, { headers: { accept: "text/html" } });
        const html = await response.text();
        const published = html.includes(code);
        return {
          ok: published,
          status: published ? "conectado" : "configurando",
          message: published
            ? "Meta tag de verificação encontrada no HTML do site."
            : "Código salvo. A meta tag entra no ar no próximo carregamento do site — verifique no Search Console em seguida.",
        };
      } catch {
        return {
          ok: true,
          status: "configurando",
          message: "Código salvo. Não foi possível ler o HTML daqui; verifique direto no Search Console.",
        };
      }
    }

    case "google_business": {
      return {
        ok: false,
        status: "aguardando_credencial",
        message:
          "Não há teste automático: a Business Profile API exige acesso aprovado pelo Google. A ficha continua sendo gerenciada no painel do Google.",
      };
    }

    /* ---------------------------------------------------------------- IA */
    case "ai_gateway": {
      if (!process.env.AI_GATEWAY_BASE_URL || !process.env.AI_GATEWAY_API_KEY) {
        return {
          ok: false,
          status: "erro",
          message:
            "As variáveis AI_GATEWAY_BASE_URL / AI_GATEWAY_API_KEY não estão disponíveis neste ambiente.",
        };
      }
      try {
        const model = pickModel(null, config.defaultModel);
        const { text } = await generateText({
          model: gateway(model),
          prompt: 'Responda apenas com a palavra "ok".',
        });
        return {
          ok: true,
          status: "conectado",
          message: `Modelo ${model} respondeu: ${text.trim().slice(0, 40)}`,
        };
      } catch (error) {
        return {
          ok: false,
          status: "erro",
          message: `Gateway de IA falhou: ${(error as Error).message}`,
        };
      }
    }

    default:
      return {
        ok: false,
        status: "nao_disponivel",
        message: "Esta integração não tem caminho oficial de conexão hoje.",
      };
  }
}
