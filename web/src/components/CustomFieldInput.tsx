import type { CustomField } from '../lib/api';

export function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (v: unknown) => void }) {
  const str = value == null ? '' : String(value);
  switch (field.type) {
    case 'textarea':
      return <textarea className="input" rows={3} value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input className="input" type="number" value={str} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date':
      return <input className="input" type="date" value={str} onChange={(e) => onChange(e.target.value || null)} />;
    case 'checkbox':
      return (
        <div className="flex h-[38px] items-center">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        </div>
      );
    case 'select':
      return (
        <select className="input" value={str} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {field.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    default:
      return <input className="input" value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function formatCustomValue(field: CustomField, value: unknown): string {
  if (value == null || value === '') return '';
  if (field.type === 'checkbox') return value ? 'Tak' : 'Nie';
  if (field.type === 'number') return Number(value).toLocaleString('pl-PL');
  return String(value);
}
