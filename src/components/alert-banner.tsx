export const AlertBanner = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-5 rounded-3xl border border-terra/40 bg-highlight px-4 py-3 text-sm leading-relaxed text-ink">
    <p className="font-semibold">Indicador, no prueba</p>
    <p className="mt-1">{children}</p>
  </div>
);
