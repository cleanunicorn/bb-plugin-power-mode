// A row of selectable cards that behaves as a WAI-ARIA radio group (#48):
// a single Tab stop on the selected card (roving tab index), and arrow keys,
// Home and End that move focus and selection together, wrapping at the ends.
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { nextRadioIndex } from "@/lib/radio-group";

export interface RadioCardOption<T extends string> {
  id: T;
  content: ReactNode;
}

export function RadioCardGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Accessible name of the group. */
  label: string;
  options: readonly RadioCardOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Layout classes for the group container (e.g. the grid). */
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((option) => option.id === value);
  // Keep the group reachable even if `value` matches no option.
  const tabStop = selected < 0 ? 0 : selected;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Leave modified keys to the browser and app shortcuts; Shift still moves.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // Move from the focused card, which can differ from `value` after a
    // remote settings change.
    const focused = (event.target as Element).closest?.("[role=radio]");
    const fromFocus = refs.current.findIndex((el) => el === focused);
    const next = nextRadioIndex(
      event.key,
      fromFocus < 0 ? selected : fromFocus,
      options.length,
    );
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      className={className}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const checked = index === selected;
        return (
          <button
            key={option.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              checked
                ? "border-foreground bg-state-active"
                : "border-border hover:bg-state-hover",
            )}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
}
