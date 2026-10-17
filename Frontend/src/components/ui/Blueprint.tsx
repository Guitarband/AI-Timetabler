import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/**
 * Blueprint frame: 1px border, square corners, 11px crop marks on all 4 corners
 * sticking out 6px. Signature of the design, do not remove (brief section 4).
 * Styles live in globals.css (.blueprint, .bp-tick).
 */
type Props<T extends ElementType> = {
  as?: T;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function CornerTicks() {
  return (
    <>
      <span aria-hidden className="bp-tick bp-tl" />
      <span aria-hidden className="bp-tick bp-tr" />
      <span aria-hidden className="bp-tick bp-bl" />
      <span aria-hidden className="bp-tick bp-br" />
    </>
  );
}

export function Blueprint<T extends ElementType = "div">({
  as,
  children,
  className = "",
  ...rest
}: Props<T>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag className={`blueprint ${className}`} {...rest}>
      {children}
      <CornerTicks />
    </Tag>
  );
}
