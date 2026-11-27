import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { ExternalLink } from "@/components/facts";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const alertLinkClass =
  "font-medium text-accent underline decoration-accent/35 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

export type AlertTabItem = {
  href: string;
  label: string;
  active: boolean;
};

type AlertTabsProps = {
  label: string;
  items: AlertTabItem[];
};

export const AlertTabs = ({ label, items }: AlertTabsProps) => (
  <div
    className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-subtle/80 p-1"
    role="tablist"
    aria-label={label}
  >
    {items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        role="tab"
        aria-selected={item.active}
        className={cn(
          "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          item.active ? "bg-elev text-ink shadow-xs ring-1 ring-line" : "text-muted hover:text-ink",
        )}
      >
        {item.label}
      </Link>
    ))}
  </div>
);

type AlertCardProps = {
  tone?: "accent" | "terra";
  badges?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  metric: React.ReactNode;
  metricLabel?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
};

export const AlertCard = ({
  tone = "accent",
  badges,
  title,
  subtitle,
  metric,
  metricLabel,
  children,
  footer,
}: AlertCardProps) => {
  const accentStrip = tone === "terra" ? "bg-terra" : "bg-accent";

  return (
    <article className="relative overflow-hidden rounded-xl border border-line bg-elev p-4 pl-5 shadow-2xs transition-colors hover:border-line-strong sm:p-5 sm:pl-6">
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]", accentStrip)} />
      {badges ? <div className="mb-2.5 flex flex-wrap items-center gap-1.5">{badges}</div> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold tracking-tight text-ink break-words sm:text-[17px]">
            {title}
          </h2>
          {subtitle ? <div className="mt-1">{subtitle}</div> : null}
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="font-display text-lg font-bold tracking-tight text-ink tabular-nums">{metric}</p>
          {metricLabel ? <p className="mt-0.5 text-xs text-muted tabular-nums">{metricLabel}</p> : null}
        </div>
      </div>
      {children ? <div className="mt-3.5">{children}</div> : null}
      {footer ? (
        <div className="mt-3.5 flex flex-col gap-2.5 border-t border-line pt-3">{footer}</div>
      ) : null}
    </article>
  );
};

export type AlertFactItem = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  highlight?: boolean;
};

type AlertFactStripProps = {
  items: AlertFactItem[];
  columns?: 2 | 3 | 4;
};

const gridColumnsClass = (columns: 2 | 3 | 4) => {
  if (columns === 2) {
    return "grid-cols-2";
  }
  if (columns === 3) {
    return "grid-cols-2 sm:grid-cols-3";
  }
  return "grid-cols-2 lg:grid-cols-4";
};

export const AlertFactStrip = ({ items, columns = 4 }: AlertFactStripProps) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <dl className={cn("grid gap-2.5 rounded-lg border border-line bg-subtle/45 p-2.5", gridColumnsClass(columns))}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-md border border-line/80 bg-elev px-3 py-2">
          <dt className="text-[11px] font-medium text-muted">{item.label}</dt>
          <dd
            className={cn(
              "mt-0.5 text-sm font-bold leading-snug tabular-nums",
              item.highlight ? "text-terra" : "text-ink",
            )}
          >
            {item.value}
          </dd>
          {item.hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted">{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
};

export type AlertFlowSide = {
  eyebrow: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
  dates?: React.ReactNode;
};

type AlertFlowProps = {
  left: AlertFlowSide;
  connector: React.ReactNode;
  right: AlertFlowSide;
  connectorTone?: "accent" | "terra" | "neutral";
};

const FlowBox = ({ side }: { side: AlertFlowSide }) => (
  <div className="min-w-0 flex-1 rounded-lg border border-line bg-subtle/50 px-3.5 py-2.5">
    <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">{side.eyebrow}</p>
    <p className="mt-0.5 text-sm font-semibold leading-snug text-ink">{side.title}</p>
    {side.detail ? <p className="mt-0.5 text-xs text-muted">{side.detail}</p> : null}
    {side.dates ? <p className="mt-1.5 text-xs text-muted tabular-nums">{side.dates}</p> : null}
  </div>
);

export const AlertFlow = ({ left, connector, right, connectorTone = "terra" }: AlertFlowProps) => (
  <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
    <FlowBox side={left} />
    <div className="flex shrink-0 items-center justify-center gap-1.5 py-0.5 md:flex-col md:px-1.5">
      <Badge tone={connectorTone} className="whitespace-nowrap font-semibold">
        {connector}
      </Badge>
      <ArrowRight aria-hidden="true" size={15} className="hidden text-muted md:block" />
    </div>
    <FlowBox side={right} />
  </div>
);

type AlertMeterProps = {
  percent: number;
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
  tone?: "accent" | "terra";
  ariaLabel: string;
};

export const AlertMeter = ({ percent, label, valueLabel, tone = "accent", ariaLabel }: AlertMeterProps) => {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const fillClass = tone === "terra" ? "bg-terra" : "bg-accent";

  return (
    <div className="grid gap-1.5">
      {label || valueLabel ? (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted">{label}</span>
          <span className="font-semibold text-ink tabular-nums">{valueLabel}</span>
        </div>
      ) : null}
      <div
        className="h-2 overflow-hidden rounded-full bg-subtle ring-1 ring-inset ring-line"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <div className={cn("h-full rounded-full", fillClass)} style={{ width: `${Math.max(3, clamped)}%` }} />
      </div>
    </div>
  );
};

type InlinePercentBarProps = {
  ratio: number;
  label: string;
  tone?: "accent" | "terra";
};

export const InlinePercentBar = ({ ratio, label, tone = "accent" }: InlinePercentBarProps) => {
  const clamped = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const fillClass = tone === "terra" ? "bg-terra" : "bg-accent";

  return (
    <div className="inline-flex items-center justify-end gap-2.5 whitespace-nowrap">
      <span className="shrink-0 tabular-nums">{label}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-subtle ring-1 ring-inset ring-line" aria-hidden="true">
        <span className={cn("block h-full rounded-full", fillClass)} style={{ width: `${Math.max(4, clamped)}%` }} />
      </span>
    </div>
  );
};

type AlertDisclosureProps = {
  label: React.ReactNode;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

export const AlertDisclosure = ({ label, count, children, defaultOpen = false }: AlertDisclosureProps) => (
  <details className="group" open={defaultOpen}>
    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-xs font-semibold text-accent transition-colors hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
      <ChevronRight
        aria-hidden="true"
        size={14}
        className="shrink-0 transition-transform duration-150 group-open:rotate-90"
      />
      <span>{label}</span>
      {count !== undefined ? (
        <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-inset ring-line tabular-nums">
          {formatNumber(count)}
        </span>
      ) : null}
    </summary>
    <div className="mt-2.5">{children}</div>
  </details>
);

export type AlertEvidenceItem = {
  key: string;
  amount: number | null;
  date: string;
  title: string;
  href?: string;
  external?: boolean;
  tag?: string;
  meta?: string;
};

type AlertEvidenceListProps = {
  items: AlertEvidenceItem[];
};

const EvidenceAmount = ({ item }: { item: AlertEvidenceItem }) => {
  const text = `${formatEuro(item.amount)} · ${formatDate(item.date)}`;
  if (!item.href) {
    return <span className="font-semibold text-ink tabular-nums">{text}</span>;
  }
  if (item.external) {
    return (
      <ExternalLink href={item.href}>
        <span className="tabular-nums">{text}</span>
      </ExternalLink>
    );
  }
  return (
    <Link href={item.href} className={cn(alertLinkClass, "tabular-nums")}>
      {text}
    </Link>
  );
};

export const AlertEvidenceList = ({ items }: AlertEvidenceListProps) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-subtle/35">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex flex-col gap-1 px-3.5 py-2.5 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <EvidenceAmount item={item} />
            {item.tag ? <Badge>{item.tag}</Badge> : null}
          </div>
          <span className="min-w-0 text-muted sm:max-w-[58%] sm:text-right">
            {item.title}
            {item.meta ? <span className="ml-1.5 font-mono text-[11px] opacity-80">· {item.meta}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
};

type AlertMetaRowProps = {
  items: (React.ReactNode | null | undefined | false)[];
};

export const AlertMetaRow = ({ items }: AlertMetaRowProps) => {
  const visible = items.filter((item) => item !== null && item !== undefined && item !== false && item !== "");
  if (visible.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
      {visible.map((item, index) => (
        <li key={index} className="inline-flex items-center gap-2">
          {index > 0 ? (
            <span aria-hidden="true" className="opacity-45">
              ·
            </span>
          ) : null}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
};

type AlertResultsBarProps = {
  total: number;
  shown: number;
  page: number;
  pageSize: number;
  singular?: string;
  plural?: string;
  extra?: React.ReactNode;
};

export const AlertResultsBar = ({
  total,
  shown,
  page,
  pageSize,
  singular = "indicador",
  plural = "indicadores",
  extra,
}: AlertResultsBarProps) => {
  const from = total === 0 || shown === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = total === 0 || shown === 0 ? 0 : Math.min(total, from + shown - 1);
  const noun = total === 1 ? singular : plural;

  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted sm:text-sm">
      <p className="tabular-nums">
        {total === 0 ? (
          `0 ${plural}`
        ) : (
          <>
            Mostrando <strong className="font-semibold text-ink">{formatNumber(from)}–{formatNumber(to)}</strong> de{" "}
            <strong className="font-semibold text-ink">{formatNumber(total)}</strong> {noun}
          </>
        )}
      </p>
      {extra ? <div>{extra}</div> : null}
    </div>
  );
};
