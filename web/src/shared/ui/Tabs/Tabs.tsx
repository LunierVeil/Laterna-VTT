import { useId, useRef, type ReactNode } from "react";
import "./Tabs.css";

export type TabItem = { value: string; label: ReactNode; content: ReactNode; disabled?: boolean; hidden?: boolean };
export type TabsProps = {
  value: string; items: readonly TabItem[]; onValueChange: (value: string) => void;
  size?: "regular" | "compact"; disabled?: boolean; "aria-label"?: string;
};

/** Controlled tabs. Hidden panels stay mounted to retain drafts and local state. */
export function Tabs({ value, items, onValueChange, size = "regular", disabled = false, "aria-label": label = "Вкладки" }: TabsProps) {
  const id = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const visible = items.filter(item => !item.hidden);
  const enabled = visible.filter(item => !disabled && !item.disabled);
  const selected = visible.find(item => item.value === value && !item.disabled)?.value ?? visible.find(item => !item.disabled)?.value;
  function activate(next: string) {
    buttons.current.get(next)?.focus();
    buttons.current.get(next)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    onValueChange(next);
  }
  return <div className={`ds-tabs ds-tabs--${size}`}>
    <div className="ds-tabs-list" role="tablist" aria-label={label}>
      {visible.map((item, index) => <button key={item.value} type="button" role="tab"
        ref={node => { if (node) buttons.current.set(item.value, node); else buttons.current.delete(item.value); }}
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={selected === item.value}
        disabled={disabled || item.disabled} tabIndex={!disabled && selected === item.value ? 0 : -1}
        className="ds-tab" onClick={() => activate(item.value)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !enabled.length) return;
          event.preventDefault();
          const current = enabled.findIndex(tab => tab.value === item.value);
          const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
          activate(enabled[next].value);
        }}>{item.label}</button>)}
    </div>
    {visible.map((item, index) => <div key={item.value} role="tabpanel" className="ds-tab-panel"
      id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={selected !== item.value} tabIndex={0}>
      {item.content}
    </div>)}
  </div>;
}
