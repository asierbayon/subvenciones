import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-ink shadow-xs hover:bg-accent-strong",
        outline: "border border-line-strong bg-elev text-ink hover:bg-highlight",
        ghost: "text-muted hover:bg-highlight hover:text-ink",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = ({ className, variant, size, asChild = false, ...props }: ButtonProps) => {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return <Slot className={classes} {...props} />;
  }
  return <button className={classes} {...props} />;
};
