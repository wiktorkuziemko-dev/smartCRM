import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Avatar, Button, ErrorText } from './ui';

const SIZE = 256;

/** Przycina zdjęcie do kwadratu (środek) i zmniejsza do 256×256 px – na serwer trafia ok. 20–40 KB. */
async function toSquareJpeg(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Nie udało się odczytać zdjęcia. Użyj pliku JPG lub PNG (zdjęcia HEIC z iPhone’a najpierw zapisz jako JPG).');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Zdjęcie profilowe z przyciskami „Zmień zdjęcie” / „Usuń”. Zapis od razu po wybraniu pliku. */
export function AvatarUpload({ userId, name, src, size = 72 }: { userId: number; name: string; src: string | null | undefined; size?: number }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = () => Promise.all(['users', 'me', 'gps-overview', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      await api.put(`/api/users/${userId}/avatar`, { dataUrl: await toSquareJpeg(file) });
      await refresh();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError(null);
    try { await api.del(`/api/users/${userId}/avatar`); await refresh(); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => input.current?.click()} className="group relative rounded-full" title="Zmień zdjęcie" disabled={busy}>
          <Avatar name={name} src={src} size={size} />
          <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-slate-900/40 text-white group-hover:flex"><Camera size={size / 3.5} /></span>
        </button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
            <Camera size={15} /> {busy ? 'Zapisuję…' : src ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
          </Button>
          {src && <Button type="button" variant="ghost" onClick={remove} disabled={busy} title="Usuń zdjęcie"><Trash2 size={15} /></Button>}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      </div>
      <div className="mt-2"><ErrorText error={error} /></div>
    </div>
  );
}
