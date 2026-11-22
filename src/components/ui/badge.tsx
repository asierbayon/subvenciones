import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-highlight text-ink",
  accent: "bg-accent text-accent-ink",
  terra: "bg-terra text-white dark:text-ink",
};

type BadgeProps = {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
};

export const Badge = ({ children, tone = "neutral", className }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
      tones[tone],
      className,
    )}
  >
    {children}
  </span>
);
