const WarningIcon = () => (
  <svg className="xp-icon" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 2.5 30.5 29H1.5Z" fill="#ffd200" stroke="#000" strokeWidth="1.4" />
    <rect x="14.6" y="12" width="2.8" height="8" fill="#000" />
    <rect x="14.6" y="22" width="2.8" height="2.8" fill="#000" />
  </svg>
);

export const AlertBanner = ({ children }: { children: React.ReactNode }) => (
  <div className="xp-balloon" role="note">
    <WarningIcon />
    <div>
      <p className="xp-balloon-title">Indicador, no prueba</p>
      <p>{children}</p>
    </div>
  </div>
);
