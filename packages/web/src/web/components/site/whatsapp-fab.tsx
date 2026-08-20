import { useEffect, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { site, whatsappLink } from "../../lib/site";

export function WhatsappFab() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <a
      href={whatsappLink(`Olá, ${site.broker}. Vim pelo site e quero informações sobre imóveis.`)}
      target="_blank"
      rel="noreferrer"
      aria-label="Falar no WhatsApp"
      className={`fixed right-5 bottom-5 z-50 flex items-center gap-3 bg-[#1f7d5c] px-5 py-4 text-white shadow-lg transition-all duration-500 hover:bg-[#25a06f] ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <FaWhatsapp className="h-5 w-5" />
      <span className="label-xs hidden sm:inline">Falar agora</span>
    </a>
  );
}
