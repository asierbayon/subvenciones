import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("xp-button", {
  variants: {
    variant: {
      default: "xp-button-primary",
      outline: "",
      ghost: "",
    },
    size: {
      default: "",
      sm: "",
      icon: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

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
