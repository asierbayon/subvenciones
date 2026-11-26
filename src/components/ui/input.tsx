import { cn } from "@/lib/utils";

const fieldClasses =
  "h-9 w-full rounded-lg border border-line-strong bg-elev px-3 py-1.5 text-sm text-ink placeholder:text-muted/70 shadow-2xs transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input className={cn(fieldClasses, className)} {...props} />
);

export const Select = ({ className, ...props }: React.ComponentProps<"select">) => (
  <select className={cn(fieldClasses, "pr-8", className)} {...props} />
);
