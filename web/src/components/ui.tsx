import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { initials } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/30',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:pt-16" onMouseDown={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl bg-white shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function StatusBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${color}1f`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}

export function TagChip({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium"
      style={{ borderColor: `${color}55`, backgroundColor: `${color}14`, color }}>
      #{name}
      {onRemove && <button type="button" onClick={onRemove} className="opacity-60 hover:opacity-100"><X size={11} /></button>}
    </span>
  );
}

/** Wybór wielu tagów – kliknięcie przełącza tag. */
export function TagPicker({ tags, value, onChange }: { tags: { id: number; name: string; color: string }[]; value: number[]; onChange: (ids: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const on = value.includes(t.id);
        return (
          <button key={t.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
            className="rounded-md border px-2 py-1 text-xs font-medium transition"
            style={on ? { borderColor: t.color, backgroundColor: t.color, color: '#fff' } : { borderColor: '#e2e8f0', color: '#64748b' }}>
            #{t.name}
          </button>
        );
      })}
      {tags.length === 0 && <span className="text-xs text-slate-400">Administrator nie zdefiniował jeszcze tagów.</span>}
    </div>
  );
}

const avatarColors = ['bg-blue-500', 'bg-sky-500', 'bg-indigo-500', 'bg-cyan-600', 'bg-violet-500', 'bg-teal-500'];
export function Avatar({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  const color = avatarColors[(name ?? '').length % avatarColors.length];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }} title={name ?? ''}>
      {initials(name)}
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-400">{children}</p>;
}
