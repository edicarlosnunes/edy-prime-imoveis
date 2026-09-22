/**
 * Tela IMPRIMÍVEL da Ficha Técnica (FC) e da Autorização de Venda (AV).
 *
 * Lê o SNAPSHOT congelado na emissão — nunca a captação atual. Se o preço ou o
 * endereço mudarem depois, a via que o proprietário assinou continua conferindo
 * com o que está registrado no banco. Editar aqui é impossível de propósito.
 *
 * Fora do papel (`print:hidden`) fica a barra de rastreio com os 9 status.
 */
import { useMemo } from "react";
import { useParams } from "wouter";
import { Printer } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { Badge, Btn, dateTimeLabel, money } from "../../components/admin/ui";
import { errorMessage } from "../../lib/admin-session";
import {
  DOC_TRACK_LABELS,
  DOC_TRACK_STATUSES,
  checkDocTransition,
  qrTarget,
} from "../../../api/lib/capture-documents";
import { docLabel, formatDoc } from "../../../api/lib/person-doc";
import { COMPLEMENT_FIELDS } from "../../../api/lib/capture-address";
import { useCaptureDocument, useSetCaptureDocumentStatus } from "../../queries/admin";

type Snapshot = {
  kind: string;
  title: string;
  serial: string;
  baseSerial: string;
  captureId: number;
  issuedAt: string;
  owner: { name?: string | null; phone?: string | null; email?: string | null; document?: string | null; rg?: string | null };
  addressLine: string;
  address: Record<string, string | null | undefined>;
  complements: Record<string, string | undefined>;
  propertyType: string | null;
  features: string[];
  askingPrice: number | null;
  estimatedPrice: number | null;
  docStatus: string | null;
  checklistDone: string[];
  photos: { owner: number; official: number };
  broker: { name: string; creci: string; phone?: string | null; email?: string | null };
  source: string | null;
  intention: string | null;
  notes: string | null;
  pending: string[];
  clauses: string[];
  blanks: string[];
};

/* RÓTULO discreto (mas legível) à esquerda, RESPOSTA escura e em negrito à
   direita: é a hierarquia que faz o papel ser lido de relance. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-neutral-200 py-[3px] text-[13px] leading-snug">
      <span className="w-48 shrink-0 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
        {label}
      </span>
      <span className="min-w-0 flex-1 font-semibold text-neutral-900">{value || "—"}</span>
    </div>
  );
}

/* Título de bloco: pequeno, escuro e com régua fina — separa sem poluir. */
function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-1.5 border-b border-neutral-300 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-700">
      {children}
    </h3>
  );
}

function DocumentBody() {
  const params = useParams<{ id?: string }>();
  const id = Number(params.id ?? 0) || null;
  const doc = useCaptureDocument(id);
  const setStatus = useSetCaptureDocumentStatus();

  const snapshot = (doc.data?.snapshot ?? null) as Snapshot | null;

  const complementLines = useMemo(() => {
    const values = snapshot?.complements ?? {};
    return COMPLEMENT_FIELDS.map((field) => ({
      label: field.label,
      value: String(values[field.key] ?? "").trim(),
    })).filter((item) => item.value.length > 0);
  }, [snapshot]);

  if (doc.isLoading) return <p className="p-6 text-sm text-neutral-500">Carregando documento…</p>;
  if (doc.isError) {
    return <p className="p-6 text-sm text-red-700">{errorMessage(doc.error, "Documento não encontrado")}</p>;
  }
  if (!doc.data || !snapshot) {
    return <p className="p-6 text-sm text-red-700">Documento sem conteúdo registrado.</p>;
  }

  const row = doc.data;
  const events = row.events ?? [];
  const qr = qrTarget(window.location.origin, snapshot.captureId);

  return (
    <div className="doc-sheet mx-auto max-w-[210mm] bg-white px-10 py-8 text-[13px] leading-snug text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      {/* barra de trabalho — não sai no papel */}
      <div data-print="hide" className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <Btn onClick={() => window.print()}>
          <Printer className="mr-1 inline size-4" /> Imprimir
        </Btn>
        <Badge>{DOC_TRACK_LABELS[row.status as keyof typeof DOC_TRACK_LABELS] ?? row.status}</Badge>
        <span className="text-xs text-neutral-500">Serial {row.serial}</span>
        <div className="flex flex-wrap gap-1">
          {DOC_TRACK_STATUSES.filter((status) => checkDocTransition(row.status, status).ok).map((status) => (
            <button
              key={status}
              type="button"
              disabled={setStatus.isPending}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
              onClick={() => {
                const note = window.prompt(`Observação para "${DOC_TRACK_LABELS[status]}" (opcional)`) ?? null;
                setStatus.mutate({ id: row.id, status, note });
              }}
            >
              {DOC_TRACK_LABELS[status]}
            </button>
          ))}
        </div>
      </div>

      {/* cabeçalho do documento */}
      <header className="border-b-2 border-neutral-900 pb-2.5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[17px] font-bold uppercase tracking-wide text-neutral-900">{snapshot.broker.name}</h1>
            <p className="text-[11px] font-medium text-neutral-700">{snapshot.broker.creci}</p>
            <p className="text-[11px] text-neutral-700">
              {[snapshot.broker.phone, snapshot.broker.email].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[15px] font-bold text-neutral-900">{snapshot.serial}</p>
            <p className="text-[11px] text-neutral-700">Emitida em {dateTimeLabel(snapshot.issuedAt)}</p>
            <p className="text-[11px] text-neutral-700">Captação #{snapshot.captureId}</p>
          </div>
        </div>
        <h2 className="mt-2.5 text-center text-[15px] font-bold uppercase tracking-[0.18em] text-neutral-900">
          {snapshot.title}
        </h2>
      </header>

      <section className="mt-3.5">
        <SectionTitle>Proprietário</SectionTitle>
        <Row label="Nome" value={snapshot.owner.name ?? ""} />
        <Row label="Telefone / WhatsApp" value={snapshot.owner.phone ?? ""} />
        <Row label="E-mail" value={snapshot.owner.email ?? ""} />
{/* CPF/CNPJ e RG vêm do snapshot CONGELADO na emissão: corrigir o
            cadastro depois não altera papel já impresso. Sem cadastro, a linha
            sai em branco para preencher à mão. */}
        <Row label={snapshot.owner.document ? docLabel(snapshot.owner.document) : "CPF / CNPJ"} value={formatDoc(snapshot.owner.document)} />
        <Row label="RG / documento de identidade" value={snapshot.owner.rg ?? ""} />
      </section>

      <section className="mt-3.5">
        <SectionTitle>Imóvel</SectionTitle>
        <Row label="Endereço" value={snapshot.addressLine} />
        <Row label="Tipo" value={snapshot.propertyType ?? ""} />
        <Row label="Finalidade" value={snapshot.intention ?? ""} />
        <Row label="Valor pedido pelo proprietário" value={money(snapshot.askingPrice)} />
        <Row label="Valor validado" value={money(snapshot.estimatedPrice)} />
        {complementLines.length > 0 && (
          <div className="mt-1.5 text-[13px] text-neutral-900">
            <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-600">Complementos: </span>
            {complementLines.map((item) => `${item.label}: ${item.value}`).join(" · ")}
          </div>
        )}
        {snapshot.features.length > 0 && (
          <div className="mt-1.5 text-[13px] text-neutral-900">
            <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-600">Características: </span>
            {snapshot.features.join(", ")}
          </div>
        )}
        <div className="mt-1.5 text-[13px] text-neutral-900">
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-600">Fotos: </span>
          {snapshot.photos.owner} provisória(s) do proprietário · {snapshot.photos.official} oficial(is)
        </div>
      </section>

      {snapshot.notes && (
        <section className="mt-3.5">
          <SectionTitle>Observações</SectionTitle>
          <p className="whitespace-pre-line text-[13px] text-neutral-900">{snapshot.notes}</p>
        </section>
      )}

      {snapshot.clauses.length > 0 && (
        <section className="mt-3.5">
          <SectionTitle>Autorização</SectionTitle>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-snug text-neutral-900 marker:font-semibold marker:text-neutral-700">
            {snapshot.clauses.map((clause) => (
              <li key={clause}>{clause}</li>
            ))}
          </ol>
        </section>
      )}

      {snapshot.blanks.length > 0 && (
        <section className="mt-3.5">
          <SectionTitle>A preencher antes de assinar</SectionTitle>
          {/* Nada de valor "padrão" aqui: comissão, exclusividade e prazo só
              aparecem impressos quando foram informados na emissão. */}
          <div className="space-y-2.5 text-[13px]">
            {snapshot.blanks.map((blank) => (
              <div key={blank}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-600">{blank}</div>
                <div className="mt-2.5 border-b border-neutral-500" />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-3.5">
        <SectionTitle>Pendências para finalizar</SectionTitle>
        {snapshot.pending.length === 0 ? (
          <p className="text-[13px] text-neutral-900">Nenhuma pendência registrada na emissão.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-[13px] leading-snug text-neutral-900 marker:text-neutral-600">
            {snapshot.pending.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="doc-sign mt-7 grid grid-cols-2 gap-10 text-[13px]">
        <div>
          <div className="border-b border-neutral-800 pb-7" />
          <p className="mt-1 text-center text-[11px] font-semibold text-neutral-800">
            {snapshot.owner.name ?? "Proprietário"}
          </p>
        </div>
        <div>
          <div className="border-b border-neutral-800 pb-7" />
          <p className="mt-1 text-center text-[11px] font-semibold text-neutral-800">{snapshot.broker.name}</p>
        </div>
      </section>

      <footer className="mt-5 border-t border-neutral-300 pt-2 text-[10px] leading-tight text-neutral-600">
        <p>
          Documento {snapshot.serial} · ficha interna: {qr}
        </p>
        <p>
          O endereço acima abre a ficha da captação no CRM e exige login. Nenhum dado do proprietário
          trafega na URL.
        </p>
      </footer>

      {events.length > 0 && (
        <section className="mt-6 print:hidden">
          <SectionTitle>Rastreio</SectionTitle>
          <ul className="space-y-1 text-xs text-neutral-700">
            {events.map((event: { id: number; status: string; note: string | null; userName: string | null; createdAt: string | Date }) => (
              <li key={event.id}>
                {dateTimeLabel(event.createdAt)} · {DOC_TRACK_LABELS[event.status as keyof typeof DOC_TRACK_LABELS] ?? event.status}
                {event.userName ? ` · ${event.userName}` : ""}
                {event.note ? ` · ${event.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function AdminDocumento() {
  return (
    <AdminGuard>
      <div className="doc-screen min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
        <DocumentBody />
      </div>
    </AdminGuard>
  );
}
