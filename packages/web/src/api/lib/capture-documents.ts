/**
 * Documentos da captação: FICHA TÉCNICA (FC) e AUTORIZAÇÃO DE VENDA (AV).
 *
 * Módulo puro: monta o conteúdo imprimível, decide o que ainda falta e valida
 * as transições de status. Nada aqui fala com o banco — a persistência fica em
 * routes/admin-documents.ts, e por isso todo o comportamento é testável sem
 * tocar produção.
 *
 * Regras fechadas com o usuário:
 *  - o documento HERDA o serial-base do imóvel/captação (FC-AP-2026-000124);
 *    nunca existe sequência própria de documento;
 *  - o conteúdo é CONGELADO na emissão (snapshot): a Ficha impressa e assinada
 *    não pode mudar porque alguém editou a captação depois;
 *  - nenhuma cláusula comercial é inventada aqui. O texto da autorização usa a
 *    configuração que o usuário informar; o que não foi informado aparece como
 *    lacuna a preencher, jamais como valor "padrão" inventado.
 */
import { type DocSerialKind, documentSerial } from "./capture-serial";
import { type Complements, formatUnitAddress } from "./capture-address";
import { isDocComplete } from "./capture-rules";

export const DOC_KINDS = ["ficha_tecnica", "autorizacao"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  ficha_tecnica: "FICHA TÉCNICA",
  autorizacao: "AUTORIZAÇÃO DE VENDA / INTERMEDIAÇÃO",
};

/** Os 9 status de rastreio do documento físico. */
export const DOC_TRACK_STATUSES = [
  "gerada",
  "impressa",
  "com_corretor",
  "entregue_ao_proprietario",
  "assinada",
  "devolvida",
  "arquivada",
  "cancelada",
] as const;
export type DocTrackStatus = (typeof DOC_TRACK_STATUSES)[number];

export const DOC_TRACK_LABELS: Record<DocTrackStatus, string> = {
  gerada: "Gerada",
  impressa: "Impressa",
  com_corretor: "Com o corretor",
  entregue_ao_proprietario: "Entregue ao proprietário",
  assinada: "Assinada",
  devolvida: "Devolvida",
  arquivada: "Arquivada",
  cancelada: "Cancelada",
};

export function isDocTrackStatus(value: string | null | undefined): value is DocTrackStatus {
  return DOC_TRACK_STATUSES.includes(String(value) as DocTrackStatus);
}

/**
 * Transição de status.
 *
 * O rastreio é de papel: ele volta atrás com frequência real (documento
 * entregue que precisa ser reimpresso, devolvido e reenviado). Por isso quase
 * tudo é permitido — o que NÃO é permitido é ressuscitar documento cancelado
 * ou mexer em documento arquivado, porque isso reescreveria um fato encerrado.
 */
export function checkDocTransition(
  current: string | null | undefined,
  next: string | null | undefined,
): { ok: boolean; message: string } {
  if (!isDocTrackStatus(next)) return { ok: false, message: "Status de documento desconhecido." };
  const from = isDocTrackStatus(current) ? current : "gerada";
  if (from === next) return { ok: false, message: "O documento já está nesse status." };
  if (from === "cancelada") {
    return { ok: false, message: "Documento cancelado não muda de status. Gere um novo documento." };
  }
  if (from === "arquivada" && next !== "cancelada") {
    return { ok: false, message: "Documento arquivado só pode ser cancelado." };
  }
  return { ok: true, message: "" };
}

/** Serial do documento a partir do serial-base do imóvel. */
export function serialFor(kind: DocKind, baseSerial: string): string {
  return documentSerial(kind as DocSerialKind, baseSerial);
}

/* ------------------------------------------------- pendências da captação */

export interface PendingSource {
  docStatus?: string | null;
  checklistDone?: string[];
  estimatedPrice?: number | null;
  askingPrice?: number | null;
  ownerPhotoCount?: number;
  officialPhotoCount?: number;
  hasSignedAuthorization?: boolean;
  hasAddress?: boolean;
  hasOwnerPhone?: boolean;
}

/**
 * PENDÊNCIAS PARA FINALIZAR — seção obrigatória da Ficha Técnica.
 *
 * Lista o que falta em texto direto, para o corretor cobrar o proprietário.
 * Nunca é bloqueio: é a lista impressa junto com a ficha.
 */
export function pendingItems(source: PendingSource): string[] {
  const done = source.checklistDone ?? [];
  const out: string[] = [];

  if (!source.hasOwnerPhone) out.push("Telefone/WhatsApp do proprietário");
  if (!source.hasAddress) out.push("Endereço completo (CEP e número)");
  /* As chaves são as MESMAS de lib/capture-checklist.ts. Não inventar chave
     nova aqui: item marcado no CRM tem que sumir da lista de pendências. */
  if (!done.includes("property_deed")) out.push("Matrícula / documento do imóvel");
  if (!done.includes("property_iptu")) out.push("IPTU");
  if (!done.includes("owner_id")) out.push("Documento de identificação do proprietário");
  if (!done.includes("owner_cpf")) out.push("CPF do proprietário");
  if (!done.includes("owner_address")) out.push("Comprovante de endereço");
  if (!isDocComplete(source.docStatus)) out.push("Documentação concluída ou validada pela equipe");
  if (!(Number(source.estimatedPrice) > 0)) out.push("Preço validado");
  if (!(source.officialPhotoCount ?? 0)) out.push("Fotos profissionais/oficiais");
  if (!source.hasSignedAuthorization) out.push("Autorização de venda assinada");

  return out;
}

/**
 * Libera FINALIZAR CAPTAÇÃO (seção 21).
 *
 * Exige documentação fechada, preço validado e autorização assinada. É mais
 * rígido que `checkConversionStart` de propósito: aquele abre o cadastro do
 * imóvel; este declara a captação pronta para virar contrato.
 */
export function canFinalize(source: PendingSource): { ok: boolean; message: string; pending: string[] } {
  const pending = pendingItems(source);
  const blockers = pending.filter((item) =>
    item === "Documentação concluída ou validada pela equipe" ||
    item === "Preço validado" ||
    item === "Autorização de venda assinada",
  );
  if (blockers.length) {
    return { ok: false, message: `Falta: ${blockers.join("; ")}.`, pending };
  }
  return { ok: true, message: "", pending };
}

/* -------------------------------------------------------------- snapshot */

export interface DocumentSource {
  captureId: number;
  serial: string;
  owner: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    document?: string | null;
  };
  address: {
    cep?: string | null;
    street?: string | null;
    number?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
  };
  complements?: Complements;
  propertyType?: string | null;
  features?: string[];
  askingPrice?: number | null;
  estimatedPrice?: number | null;
  docStatus?: string | null;
  checklistDone?: string[];
  ownerPhotoCount?: number;
  officialPhotoCount?: number;
  broker: { name: string; creci: string; phone?: string | null; email?: string | null };
  source?: string | null;
  notes?: string | null;
  intention?: string | null;
  hasSignedAuthorization?: boolean;
}

export interface DocumentSnapshot {
  kind: DocKind;
  title: string;
  serial: string;
  baseSerial: string;
  captureId: number;
  issuedAt: string;
  owner: DocumentSource["owner"];
  addressLine: string;
  address: DocumentSource["address"];
  complements: Complements;
  propertyType: string | null;
  features: string[];
  askingPrice: number | null;
  estimatedPrice: number | null;
  docStatus: string | null;
  checklistDone: string[];
  photos: { owner: number; official: number };
  broker: DocumentSource["broker"];
  source: string | null;
  intention: string | null;
  notes: string | null;
  pending: string[];
  /** Cláusulas da autorização. Vazio na ficha técnica. */
  clauses: string[];
  /** Lacunas comerciais que o corretor precisa preencher à mão antes de assinar. */
  blanks: string[];
}

const pendingSourceOf = (source: DocumentSource): PendingSource => ({
  docStatus: source.docStatus,
  checklistDone: source.checklistDone,
  estimatedPrice: source.estimatedPrice,
  askingPrice: source.askingPrice,
  ownerPhotoCount: source.ownerPhotoCount,
  officialPhotoCount: source.officialPhotoCount,
  hasSignedAuthorization: source.hasSignedAuthorization,
  hasAddress: Boolean(source.address?.cep && source.address?.number),
  hasOwnerPhone: Boolean(source.owner?.phone),
});

/** Termos comerciais da autorização. Nada é inventado: o que falta vira lacuna. */
export interface AuthorizationTerms {
  /** percentual de comissão, quando o usuário já tiver configurado */
  commissionPercent?: number | null;
  exclusive?: boolean | null;
  /** prazo em dias */
  termDays?: number | null;
  authorizedPrice?: number | null;
}

export function buildSnapshot(
  kind: DocKind,
  source: DocumentSource,
  options: { now?: Date; terms?: AuthorizationTerms } = {},
): DocumentSnapshot {
  const now = options.now ?? new Date();
  const complements = source.complements ?? {};
  const terms = options.terms ?? {};

  const clauses: string[] = [];
  const blanks: string[] = [];

  if (kind === "autorizacao") {
    const price = terms.authorizedPrice ?? source.estimatedPrice ?? source.askingPrice ?? null;
    if (!(Number(price) > 0)) blanks.push("Preço autorizado");
    clauses.push(
      "O(A) proprietário(a) autoriza a Edy Prime Imóveis a intermediar a negociação do imóvel identificado nesta autorização.",
      "Autoriza a divulgação do imóvel nos canais da imobiliária, incluindo site, portais e redes sociais.",
      "Autoriza o uso das fotos e das informações do imóvel exclusivamente para fins de divulgação da venda.",
      "Autoriza a apresentação do imóvel a interessados e o recebimento e a apresentação de propostas.",
    );
    if (terms.commissionPercent != null && terms.commissionPercent > 0) {
      clauses.push(`Comissão de intermediação: ${terms.commissionPercent}% sobre o valor da venda.`);
    } else {
      /* Não existe percentual "padrão" no sistema: o usuário foi explícito em
         não inventar cláusula comercial. Vira lacuna a preencher. */
      blanks.push("Percentual de comissão");
    }
    if (terms.exclusive == null) blanks.push("Exclusividade (sim ou não)");
    else clauses.push(terms.exclusive ? "Autorização com EXCLUSIVIDADE." : "Autorização SEM exclusividade.");
    if (terms.termDays != null && terms.termDays > 0) clauses.push(`Prazo de vigência: ${terms.termDays} dias.`);
    else blanks.push("Prazo de vigência");
    blanks.push("Assinatura do proprietário");
  }

  return {
    kind,
    title: DOC_KIND_LABELS[kind],
    serial: serialFor(kind, source.serial),
    baseSerial: source.serial,
    captureId: source.captureId,
    issuedAt: now.toISOString(),
    owner: source.owner,
    addressLine: formatUnitAddress(source.address ?? {}, complements),
    address: source.address ?? {},
    complements,
    propertyType: source.propertyType ?? null,
    features: source.features ?? [],
    askingPrice: source.askingPrice ?? null,
    estimatedPrice: source.estimatedPrice ?? null,
    docStatus: source.docStatus ?? null,
    checklistDone: source.checklistDone ?? [],
    photos: { owner: source.ownerPhotoCount ?? 0, official: source.officialPhotoCount ?? 0 },
    broker: source.broker,
    source: source.source ?? null,
    intention: source.intention ?? null,
    notes: source.notes ?? null,
    pending: pendingItems(pendingSourceOf(source)),
    clauses,
    blanks,
  };
}

/**
 * Endereço do QR: ficha INTERNA da captação, atrás de login.
 *
 * Nada de dado do proprietário na URL — o QR leva ao CRM, e quem abre precisa
 * de sessão. Sem sessão, o admin manda para o login como qualquer outra rota.
 */
export function qrTarget(baseUrl: string, captureId: number): string {
  const root = baseUrl.replace(/\/+$/, "");
  return `${root}/admin/captacao?ficha=${captureId}`;
}
