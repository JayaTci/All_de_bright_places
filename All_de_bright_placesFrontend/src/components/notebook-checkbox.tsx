// Adapts the animated custom-checkbox pattern from Edil Ozi's MIT 21st.dev component.
"use client";
import { Check } from "lucide-react";
/** Renders an accessible native checkbox with a drawn notebook checkmark. */
export function NotebookCheckbox({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange?: () => void; disabled?: boolean }) {
  return <label className={`notebook-check ${checked ? "checked" : ""}`}><input type="checkbox" aria-label={label} checked={checked} onChange={onChange} disabled={disabled || !onChange} /><span aria-hidden="true">{checked && <Check size={19} strokeWidth={2.7} />}</span></label>;
}
