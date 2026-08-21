import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Bot,
  Building2,
  CalendarClock,
  Handshake,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Droplets,
  Globe2,
  MessagesSquare,
  Palette,
  Plug,
  ScrollText,
  Settings,
  Zap,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "../../lib/utils";
import { adminLogout } from "../../lib/admin-session";
import { useAdminMe } from "../../queries/admin";

const nav: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/imoveis", label: "Imóveis", icon: Building2 },
  { href: "/admin/leads", label: "Leads / CRM", icon: Users },
  { href: "/admin/clientes", label: "Clientes", icon: UserRound },
  { href: "/admin/proprietarios", label: "Proprietários", icon: KeyRound },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarClock },
  { href: "/admin/propostas", label: "Propostas", icon: Handshake },
  { href: "/admin/conversas", label: "Conversas", icon: MessagesSquare },
  { href: "/admin/ia", label: "Agente de IA", icon: Bot },
  { href: "/admin/automacoes", label: "Automações", icon: Zap },
  { href: "/admin/integracoes", label: "Integrações", icon: Plug },
  { href: "/admin/portais", label: "Portais", icon: Globe2 },
  { href: "/admin/marca-dagua", label: "Marca d'água", icon: Droplets },
  { href: "/admin/editor", label: "Editor do Site", icon: Palette },
  { href: "/admin/auditoria", label: "IA e Auditoria", icon: ScrollText },
  { href: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

export function AdminLayout({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const me = useAdminMe();
  const queryClient = useQueryClient();

  async function logout() {
    await adminLogout();
    queryClient.clear();
    window.location.href = "/admin/login";
  }

  const sidebar = (
    <div className="admin-sidebar flex h-full flex-col bg-deep text-white/85">
      <div className="border-b border-white/10 px-6 py-6">
        <p className="display text-2xl leading-none text-white">Edy Premi</p>
        <p className="label-xs mt-2 text-brass-soft">Painel administrativo</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {nav.map((item) => {
          const active = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "mb-1 flex items-center gap-3 rounded-[3px] px-3 py-2.5 text-sm transition-colors",
                active ? "bg-brass text-white" : "hover:bg-white/10 hover:text-white",
              )}
            >
              <item.icon className="h-4 w-4" strokeWidth={1.6} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-4 py-4">
        <p className="truncate text-sm text-white">{me.data?.user?.name ?? "—"}</p>
        <p className="truncate text-xs text-white/70">{me.data?.user?.email ?? ""}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="rounded-[3px] border border-white/20 px-3 py-1.5 text-[11px] tracking-wide uppercase hover:bg-white/10"
          >
            Ver site
          </a>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 rounded-[3px] border border-white/20 px-3 py-1.5 text-[11px] tracking-wide uppercase hover:bg-white/10"
          >
            <LogOut className="h-3 w-3" /> Sair
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="admin-shell min-h-screen bg-paper text-ink">
      <aside className="fixed top-0 left-0 hidden h-screen w-64 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/50"
          />
          <div className="absolute top-0 left-0 h-full w-72">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                aria-label="Abrir menu"
                onClick={() => setOpen((value) => !value)}
                className="shrink-0 rounded-[3px] border border-line p-2 lg:hidden"
              >
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
              <div className="min-w-0">
                <h1 className="display truncate text-2xl text-deep sm:text-3xl">{title}</h1>
                {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
              </div>
            </div>
            {actions && (
              <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">{actions}</div>
            )}
          </div>
        </header>
        <main className="px-4 py-6 pb-24 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
