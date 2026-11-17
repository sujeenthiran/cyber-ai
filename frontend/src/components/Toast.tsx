import { useStore } from "../lib/store";
export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return <div className={`toast t-${toast.kind}`}>{toast.text}</div>;
}
