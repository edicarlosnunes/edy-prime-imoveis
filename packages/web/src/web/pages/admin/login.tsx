import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Btn, ErrorNote, Field, Input } from "../../components/admin/ui";
import { adminLogin, errorMessage } from "../../lib/admin-session";
import { useAdminMe } from "../../queries/admin";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const me = useAdminMe();

  useEffect(() => {
    if (me.data?.user) navigate("/admin", { replace: true });
  }, [me.data?.user, navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminLogin(email.trim(), password);
      await queryClient.invalidateQueries();
      navigate("/admin", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível entrar"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-shell admin-auth flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="display text-4xl text-white">Edy Premi</p>
          <p className="label-xs mt-2 text-brass-soft">Painel administrativo</p>
        </div>
        <form onSubmit={submit} className="admin-card rounded-[4px] border border-line bg-white p-6">
          <div className="space-y-4">
            <Field label="E-mail">
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seu@email.com"
                required
              />
            </Field>
            <Field label="Senha">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </Field>
            <ErrorNote message={error} />
            <Btn type="submit" tone="brass" className="w-full" disabled={loading}>
              {loading ? "Entrando…" : "Entrar"}
            </Btn>
          </div>
        </form>
        <p className="mt-6 text-center text-xs text-white/70">
          Acesso restrito. Todas as ações exigem sessão autenticada.
        </p>
      </div>
    </div>
  );
}
