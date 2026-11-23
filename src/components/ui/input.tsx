import { cn } from "@/lib/utils";

export const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input className={cn("xp-input", className)} {...props} />
);

export const Select = ({ className, ...props }: React.ComponentProps<"select">) => (
  <select className={cn("xp-input", className)} {...props} />
);
