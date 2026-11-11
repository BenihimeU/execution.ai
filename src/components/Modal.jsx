import { X } from "lucide-react";

export function Modal({ title, subtitle, children, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><h2>{title}</h2><p>{subtitle}</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}
