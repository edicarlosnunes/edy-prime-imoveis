import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAdminMe } from "../../queries/admin";

/** Protege as rotas /admin: sem sessão válida, manda para o login. */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const me = useAdminMe();
  const [, navigate] = useLocation();
  const user = me.data?.user ?? null;
  const denied = !me.isLoading && !user;

  useEffect(() => {
    if (denied) navigate("/admin/login", { replace: true });
  }, [denied, navigate]);

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="label-xs text-muted">Carregando painel…</p>
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}
