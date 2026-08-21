/**
 * Painel de revisão do conteúdo gerado por IA.
 *
 * Nada aqui grava no banco nem publica: o administrador lê cada bloco e
 * decide aplicar no formulário. O salvamento continua sendo manual.
 */
import { Copy, RefreshCw, Sparkles } from "lucide-react";
import { Btn, ErrorNote, Modal } from "../../components/admin/ui";

export interface GeneratedContent {
  title: string;
  highlight: string;
  description: string;
  whatsapp: string;
  portal: string;
  metaTitle: string;
  metaDescription: string;
}

export type GeneratedField = keyof GeneratedContent;

const BLOCKS: { key: GeneratedField; label: string; hint: string; applies: string | null }[] = [
  {
    key: "title",
    label: "Título do anúncio",
    hint: "substitui o campo Título",
    applies: "Título",
  },
  {
    key: "highlight",
    label: "Frase de destaque",
    hint: "substitui a frase do card do site",
    applies: "Frase de destaque",
  },
  {
    key: "description",
    label: "Descrição comercial completa",
    hint: "substitui o campo Descrição",
    applies: "Descrição",
  },
  {
    key: "whatsapp",
    label: "Versão curta para WhatsApp",
    hint: "copie e use no atendimento",
    applies: null,
  },
  {
    key: "portal",
    label: "Descrição para portais imobiliários",
    hint: "copie e cole no portal",
    applies: null,
  },
  { key: "metaTitle", label: "Meta title (SEO)", hint: "copie para o SEO da página", applies: null },
  {
    key: "metaDescription",
    label: "Meta description (SEO)",
    hint: "copie para o SEO da página",
    applies: null,
  },
];

export function PropertyAiPanel({
  open,
  onClose,
  loading,
  error,
  content,
  usedFields,
  onRegenerate,
  onApply,
  onApplyAll,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  content: GeneratedContent | null;
  usedFields: string[];
  onRegenerate: () => void;
  onApply: (field: GeneratedField, value: string) => void;
  onApplyAll: (content: GeneratedContent) => void;
}) {
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* clipboard bloqueado: o texto continua selecionável na tela */
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title="Conteúdo gerado com IA">
      <div className="space-y-4">
        <p className="rounded-[10px] border border-line px-3 py-2.5 text-xs text-muted">
          Os textos abaixo foram escritos apenas com os dados cadastrados deste imóvel. Nada foi
          alterado no cadastro e nada foi publicado: revise, ajuste e escolha o que usar.
        </p>

        <ErrorNote message={error} />

        {loading && (
          <div className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-6 text-sm text-muted">
            <Sparkles className="h-4 w-4 animate-pulse text-brass" />
            Escrevendo com base na ficha do imóvel…
          </div>
        )}

        {!loading && content && (
          <>
            <div className="space-y-3">
              {BLOCKS.map((block) => {
                const value = content[block.key];
                return (
                  <div key={block.key} className="rounded-[10px] border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="label-xs text-muted">{block.label}</p>
                      <span className="text-[11px] text-muted">
                        {value.length} caracteres · {block.hint}
                      </span>
                    </div>
                    <p className="mt-2 text-sm whitespace-pre-line text-deep">{value}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {block.applies && (
                        <Btn tone="brass" onClick={() => onApply(block.key, value)}>
                          Usar em “{block.applies}”
                        </Btn>
                      )}
                      <Btn tone="outline" onClick={() => void copy(value)}>
                        <Copy className="h-3.5 w-3.5" /> Copiar
                      </Btn>
                    </div>
                  </div>
                );
              })}
            </div>

            {usedFields.length > 0 && (
              <details className="rounded-[10px] border border-line p-3">
                <summary className="cursor-pointer text-xs text-muted">
                  Dados do cadastro usados na geração
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-deep">
                  {usedFields.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Btn tone="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn tone="outline" onClick={onRegenerate} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Gerar novamente
          </Btn>
          <Btn
            tone="brass"
            disabled={loading || !content}
            onClick={() => {
              if (content) onApplyAll(content);
            }}
          >
            Usar título, destaque e descrição
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
