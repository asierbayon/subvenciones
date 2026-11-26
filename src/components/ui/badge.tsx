import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-subtle text-muted ring-line-strong/60",
  accent: "bg-accent-soft text-accent ring-accent-border",
  terra: "bg-terra-soft text-terra ring-terra-border",
};

type BadgeProps = {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
};

export const Badge = ({ children, tone = "neutral", className }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
      tones[tone],
      className,
    )}
  >
    {children}
  </span>
);
