import { cn } from "@/lib/utils";

const tones = {
  neutral: "xp-badge",
  accent: "xp-badge xp-badge-accent",
  terra: "xp-badge xp-badge-terra",
};

type BadgeProps = {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
};

export const Badge = ({ children, tone = "neutral", className }: BadgeProps) => (
  <span className={cn(tones[tone], className)}>{children}</span>
);
