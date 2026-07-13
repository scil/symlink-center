import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-3 text-sm",
        variant === "primary" &&
          "border-focus bg-focus text-white hover:bg-blue-700",
        variant === "secondary" &&
          "border-line bg-white text-ink hover:bg-slate-50",
        variant === "danger" &&
          "border-red-700 bg-red-700 text-white hover:bg-red-800",
        variant === "ghost" &&
          "border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
        className,
      )}
      {...props}
    />
  );
}

type BadgeProps = {
  tone?: "green" | "yellow" | "red" | "blue" | "gray";
  children: ReactNode;
};

export function Badge({ tone = "gray", children }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium",
        tone === "green" && "border-green-200 bg-green-50 text-green-800",
        tone === "yellow" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "red" && "border-red-200 bg-red-50 text-red-800",
        tone === "blue" && "border-blue-200 bg-blue-50 text-blue-800",
        tone === "gray" && "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {children}
    </span>
  );
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-focus focus:ring-2 focus:ring-blue-100",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "h-10 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-focus focus:ring-2 focus:ring-blue-100",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        "rounded-lg border border-line bg-white shadow-panel",
        className,
      )}
    >
      {children}
    </section>
  );
}
