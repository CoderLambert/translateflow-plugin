import { useState } from "react";

// A test-only interaction fixture; no production page or persistence service.
export function ConsentControl({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  return <div>
    <p role="status">{enabled ? "Recording enabled" : "Recording paused"}</p>
    <button type="button" aria-pressed={enabled} onClick={() => {
      const next = !enabled;
      setEnabled(next);
      onChange(next);
    }}>{enabled ? "Pause recording" : "Enable recording"}</button>
  </div>;
}
