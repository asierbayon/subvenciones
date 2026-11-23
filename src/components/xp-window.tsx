import Link from "next/link";

type XpWindowProps = {
  label: string;
  title: React.ReactNode;
  children: React.ReactNode;
  menu?: React.ReactNode;
  toolbar?: React.ReactNode;
  status?: React.ReactNode;
};

const WindowMark = () => (
  <svg className="xp-titlebar-icon" viewBox="0 0 16 16" aria-hidden="true">
    <rect width="16" height="16" fill="#003399" />
    <path d="M8 2.2 9.15 6h3.85l-3.1 2.25 1.15 3.65L8 9.7l-3.05 2.2L6.1 8.25 3 6h3.85z" fill="#fff3c4" />
  </svg>
);

export const XpWindow = ({ label, title, children, menu, toolbar, status }: XpWindowProps) => (
  <section className="xp-window" aria-label={label}>
    <header className="xp-titlebar">
      <WindowMark />
      <p className="xp-titlebar-text">{title}</p>
      <div className="xp-caption-buttons">
        <span className="xp-caption xp-caption-min" aria-hidden="true" />
        <span className="xp-caption xp-caption-max" aria-hidden="true" />
        <Link href="/" className="xp-caption xp-caption-close" aria-label="Cerrar y volver al inicio">
          <span className="xp-caption-x" />
        </Link>
      </div>
    </header>
    {menu}
    {toolbar}
    <div className="xp-window-body">{children}</div>
    {status}
  </section>
);
