import { Facebook, Instagram, Mail, MessageCircle } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import { useSiteContent } from "./content";
import { Lines } from "./hero";

export function Footer() {
  const { footer, menu, theme } = useSiteContent();
  const logoUrl = (menu.logoUrl || theme.logoUrl).trim();

  return (
    <footer className="bg-ink text-white/60">
      <div className="mx-auto max-w-[1240px] px-6 py-16 lg:px-8">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${menu.logoText || site.brand} ${menu.logoSuffix || site.brandSuffix}`}
                style={{ height: `${theme.logoHeight || 34}px` }}
                className="w-auto object-contain"
              />
            ) : (
              <p className="flex items-baseline gap-2 text-white">
                <span className="display text-2xl">{menu.logoText || site.brand}</span>
                <span className="label-xs text-brass-soft">
                  {menu.logoSuffix || site.brandSuffix}
                </span>
              </p>
            )}
            <p className="mt-5 max-w-sm text-sm leading-relaxed">
              <Lines text={footer.about} /> {site.creci}.
            </p>
          </div>

          {footer.links.length > 0 && (
            <div>
              <p className="label-xs text-white">{footer.navLabel}</p>
              <ul className="mt-5 space-y-3 text-sm">
                {footer.links.map((link) => (
                  <li key={link.id}>
                    <a href={link.href} className="transition-colors hover:text-brass-soft">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="label-xs text-white">{footer.contactLabel}</p>
            <ul className="mt-5 space-y-3 text-sm">
              <li>
                <a
                  href={whatsappLink(`Olá, ${site.broker}. Vim pelo site.`)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 transition-colors hover:text-brass-soft"
                >
                  <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
                  {site.whatsappLabel}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${site.email}`}
                  className="flex items-center gap-2 transition-colors hover:text-brass-soft"
                >
                  <Mail className="h-4 w-4" strokeWidth={1.5} />
                  E-mail
                </a>
              </li>
              {footer.showSocial && site.instagram && (
                <li>
                  <a
                    href={site.instagram}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 transition-colors hover:text-brass-soft"
                  >
                    <Instagram className="h-4 w-4" strokeWidth={1.5} />
                    Instagram
                  </a>
                </li>
              )}
              {footer.showSocial && site.facebook && (
                <li>
                  <a
                    href={site.facebook}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 transition-colors hover:text-brass-soft"
                  >
                    <Facebook className="h-4 w-4" strokeWidth={1.5} />
                    Facebook
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-8 text-xs md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {menu.logoText || site.brand}{" "}
            {menu.logoSuffix || site.brandSuffix}. {footer.copyright}
          </p>
          {footer.note.trim() && <p>{footer.note}</p>}
        </div>
      </div>
    </footer>
  );
}
