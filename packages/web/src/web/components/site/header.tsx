import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import { useSiteContent } from "./content";

export function Header() {
  const { menu, theme } = useSiteContent();
  const links = useMemo(
    () => menu.items.filter((item) => item.visible && item.label.trim() && item.href.trim()),
    [menu.items],
  );

  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Destaca no menu a seção que está na tela
  useEffect(() => {
    const sections = links
      .filter((link) => link.href.startsWith("#") && link.href.length > 1)
      .map((link) => document.querySelector<HTMLElement>(link.href))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [links]);

  // Menu mobile: trava o scroll do fundo e fecha com Esc
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Fecha o menu ao voltar para desktop
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const closeMenu = useCallback(() => setOpen(false), []);

  const solid = scrolled || open;
  const logoUrl = (menu.logoUrl || theme.logoUrl).trim();
  const fullscreen = menu.mobileStyle === "fullscreen";

  const waHref = whatsappLink(
    `Olá, ${site.broker}. Vi seu site e quero informações sobre imóveis em ${site.city}.`,
  );

  return (
    <header
      className={`${menu.sticky ? "fixed" : "absolute"} inset-x-0 top-0 z-50 transition-[background-color,box-shadow,border-color] duration-500 ${
        solid
          ? "border-b border-white/10 bg-deep/95 shadow-[0_1px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl"
          : "border-b border-transparent bg-gradient-to-b from-black/60 via-black/25 to-transparent"
      }`}
    >
      <div
        className={`mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-6 transition-[height] duration-500 lg:px-8 ${
          solid ? "h-[68px]" : "h-[84px]"
        }`}
      >
        <a
          href="#top"
          onClick={closeMenu}
          className="group flex shrink-0 items-baseline gap-2 text-white"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${menu.logoText || site.brand} ${menu.logoSuffix || site.brandSuffix}`}
              style={{ height: `${theme.logoHeight || 34}px` }}
              className="w-auto object-contain"
            />
          ) : (
            <>
              <span className="display text-[26px] leading-none tracking-tight transition-colors duration-300 group-hover:text-brass-soft">
                {menu.logoText || site.brand}
              </span>
              <span className="label-xs text-brass-soft transition-opacity duration-300 group-hover:opacity-80">
                {menu.logoSuffix || site.brandSuffix}
              </span>
            </>
          )}
        </a>

        <nav className="hidden items-center gap-9 md:flex lg:gap-11">
          {links.map((link) => {
            const isActive = active === link.href;
            return (
              <a
                key={link.id}
                href={link.href}
                aria-current={isActive ? "true" : undefined}
                className={`relative py-1.5 text-[12.5px] font-normal tracking-[0.16em] whitespace-nowrap uppercase transition-colors duration-300 after:absolute after:-bottom-px after:left-0 after:h-px after:bg-brass-soft after:transition-[width] after:duration-500 after:ease-out hover:text-brass-soft ${
                  isActive
                    ? "text-brass-soft after:w-full"
                    : "text-white/80 after:w-0 hover:after:w-full"
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {menu.showWhatsapp && (
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              className="site-btn site-btn-dark hidden px-6 py-3 sm:inline-flex"
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={1.6} />
              {menu.whatsappLabel || "WhatsApp"}
            </a>
          )}

          <button
            type="button"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            aria-controls="menu-mobile"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2.5 border border-white/25 px-3.5 py-2.5 text-white transition-colors duration-300 hover:border-brass-soft md:hidden"
          >
            <span className="relative block h-3 w-4">
              <span
                className={`absolute left-0 block h-px w-4 bg-current transition-transform duration-300 ease-out ${
                  open ? "top-1.5 rotate-45" : "top-0"
                }`}
              />
              <span
                className={`absolute top-1.5 left-0 block h-px w-4 bg-current transition-opacity duration-200 ${
                  open ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute left-0 block h-px w-4 bg-current transition-transform duration-300 ease-out ${
                  open ? "top-1.5 -rotate-45" : "top-3"
                }`}
              />
            </span>
            <span className="text-[11.5px] tracking-[0.18em] uppercase">Menu</span>
          </button>
        </div>
      </div>

      {/* Menu mobile */}
      <div
        id="menu-mobile"
        className={`overflow-hidden border-t border-white/10 bg-deep transition-[max-height,opacity] duration-500 ease-out md:hidden ${
          open ? `${fullscreen ? "max-h-[100vh] h-[calc(100vh-68px)]" : "max-h-[70vh]"} opacity-100` : "max-h-0 opacity-0"
        }`}
      >
        <nav className={`px-6 pt-2 pb-6 ${fullscreen ? "flex h-full flex-col justify-center" : ""}`}>
          {links.map((link, index) => {
            const isActive = active === link.href;
            return (
              <a
                key={link.id}
                href={link.href}
                onClick={closeMenu}
                aria-current={isActive ? "true" : undefined}
                style={{ transitionDelay: open ? `${80 + index * 45}ms` : "0ms" }}
                className={`flex items-center justify-between border-b border-white/10 ${fullscreen ? "py-5 text-[15px]" : "py-4 text-[13px]"} tracking-[0.16em] uppercase transition-all duration-500 ${
                  open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
                } ${isActive ? "text-brass-soft" : "text-white/85"}`}
              >
                {link.label}
                <span
                  className={`h-px transition-[width] duration-500 ${
                    isActive ? "w-6 bg-brass-soft" : "w-0 bg-transparent"
                  }`}
                />
              </a>
            );
          })}
          {menu.showWhatsapp && (
            <a
              href={whatsappLink(`Olá, ${site.broker}. Quero informações sobre imóveis em ${site.city}.`)}
              target="_blank"
              rel="noreferrer"
              onClick={closeMenu}
              style={{ transitionDelay: open ? `${80 + links.length * 45}ms` : "0ms" }}
              className={`site-btn site-btn-dark mt-6 w-full py-4 transition-all duration-500 ${
                open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
              }`}
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={1.6} />
              Falar no WhatsApp
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
