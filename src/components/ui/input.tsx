import { cn } from "@/lib/utils";

export const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input
    className={cn(
      "h-10 w-full rounded-xl border border-line bg-elev px-3 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      className,
    )}
    {...props}
  />
);

export const Select = ({ className, ...props }: React.ComponentProps<"select">) => (
  <select
    className={cn(
      "h-10 w-full rounded-xl border border-line bg-elev px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      className,
    )}
    {...props}
  />
);
