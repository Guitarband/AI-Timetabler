import type { ButtonHTMLAttributes } from "react";
import { CornerTicks } from "./Blueprint";

type Variant = "primary" | "secondary" | "ghost";

/** Every primary button carries the 4 corner crop marks, like the blueprint frame. */
export function Button({
  variant = "secondary",
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button type={type} className={`btn btn-${variant} ${className}`} {...rest}>
      {children}
      {variant === "primary" && <CornerTicks />}
    </button>
  );
}
