import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePropertyTypes } from "../../queries/property-types";
import { orpc } from "../../lib/api";
import { errorMessage } from "../../lib/admin-session";
import { Btn, Card, ErrorNote, Field, Input } from "./ui";
import type { PropertyTypeOption } from "../../../shared/property-types";

export function PropertyTypesCard() {
  const catalog = usePropertyTypes();
  const client = useQueryClient();
  const mutation = useMutation(orpc.adminSettings.savePropertyType.mutationOptions());
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  async function save(key: string | undefined, name: string, active: boolean) {
    setError(null); setNote("");
    try {
      await mutation.mutateAsync({key,label:name,active});
      await client.invalidateQueries({queryKey:orpc.siteConfig.propertyTypes.queryKey()});
      setEditing(null); setLabel(""); setNote("Lista atualizada. Os imóveis já cadastrados foram preservados.");
    } catch (caught) { setError(errorMessage(caught,"Não foi possível salvar o tipo.")); }
  }
  function edit(row: PropertyTypeOption) {setEditing(row.key);setLabel(row.label);setNote("");setError(null);}
  return <Card title="Tipos de imóveis">
    <p className="mb-4 text-xs text-muted">Adicione ou renomeie os tipos usados no cadastro. Desativar retira a opção dos novos cadastros e mantém os imóveis existentes.</p>
    {catalog.isPending ? <p>Carregando tipos…</p> : catalog.isError ? <ErrorNote message="Não foi possível carregar a lista. Atualize a página para tentar novamente."/> : <>
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();void save(editing??undefined,label,editing ? catalog.rows.find(row=>row.key===editing)?.active ?? true : true);}}>
        <Field label={editing ? "Editar nome do tipo" : "Novo tipo de imóvel"}><Input required maxLength={80} placeholder="Ex.: Kitnet, galpão" value={label} onChange={event=>setLabel(event.target.value)}/></Field>
        <Btn type="submit" tone="brass" disabled={mutation.isPending || !label.trim()}>{editing ? "Salvar nome" : "Adicionar tipo"}</Btn>
        {editing && <Btn type="button" tone="outline" onClick={()=>{setEditing(null);setLabel("");}}>Cancelar</Btn>}
      </form>
      <ul className="max-h-96 space-y-2 overflow-y-auto">{catalog.rows.map(row=><li key={row.key} className="flex flex-wrap items-center gap-2 rounded border border-line p-2">
        <span className="min-w-32 flex-1 text-sm">{row.label}<span className={`ml-2 text-xs ${row.active ? "text-emerald-700" : "text-muted"}`}>{row.active ? "Ativo" : "Desativado"}</span></span>
        <Btn type="button" tone="outline" disabled={mutation.isPending} onClick={()=>edit(row)}>Editar</Btn>
        <Btn type="button" tone="outline" disabled={mutation.isPending} onClick={()=>void save(row.key,row.label,!row.active)}>{row.active ? "Desativar" : "Reativar"}</Btn>
      </li>)}</ul>
    </>}
    <ErrorNote message={error}/>{note && <p role="status" className="mt-3 text-xs text-emerald-700">{note}</p>}
  </Card>;
}
