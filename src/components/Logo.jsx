import { Sparkles } from "lucide-react";

export function Logo({ dark = false }) {
  return (
    <div className={`logo ${dark ? "logo--dark" : ""}`}>
      <span className="logo__mark"><Sparkles size={18} /></span>
      <span>execution<span>.ai</span></span>
    </div>
  );
}
