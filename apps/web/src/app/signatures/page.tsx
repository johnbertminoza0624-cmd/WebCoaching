'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Info, Upload, X, PenLine } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, EmptyState } from '@/components/ui/primitives';
import { Button as UiButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  clear: () => void;
  getDataURL: () => string | null;
}

const SignaturePad = React.forwardRef<SignaturePadHandle, { onDraw?: () => void }>(function SignaturePad(
  { onDraw },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [empty, setEmpty] = React.useState(true);
  const drawing = React.useRef(false);
  const last = React.useRef<[number, number] | null>(null);

  React.useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear: () => {
      const c = canvasRef.current;
      if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
      setEmpty(true);
    },
    getDataURL: () => {
      if (empty) return null;
      const c = canvasRef.current;
      return c ? c.toDataURL('image/png') : null;
    },
  }), [empty]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };

  return (
    <>
      <div className="relative flex h-[158px] items-center justify-center overflow-hidden rounded-lg border border-dashed border-input bg-white text-zinc-900 shadow-sm">
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            drawing.current = true; setEmpty(false); onDraw?.(); last.current = pos(e);
            const c = canvasRef.current!;
            if (c.width !== c.clientWidth) { c.width = c.clientWidth; c.height = c.clientHeight; }
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvasRef.current!.getContext('2d')!;
            const p = pos(e);
            ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(last.current![0], last.current![1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
            last.current = p;
          }}
          onPointerUp={() => (drawing.current = false)}
          onPointerLeave={() => (drawing.current = false)}
        />
        {empty && <span className="pointer-events-none absolute text-[12.5px] text-zinc-400 font-medium">Draw your signature</span>}
      </div>
      <div className="flex justify-between pt-2 text-xs text-muted-foreground">
        <span>Stroke width 2.2px · smoothed</span>
        <button type="button" className="hover:text-foreground" onClick={() => {
          const c = canvasRef.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true);
        }}>Clear</button>
      </div>
    </>
  );
});

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

import { useAuthedSession } from '@/lib/session';
import { getProfileSignature, saveProfileSignature, type SavedSignature } from '@/lib/signature-store';

export default function SignaturesPage() {
  const { user: me } = useAuthedSession();
  const [tab, setTab] = React.useState<'draw' | 'upload'>('draw');
  const padRef = React.useRef<SignaturePadHandle>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [upload, setUpload] = React.useState<{ name: string; previewUrl: string } | null>(null);
  const [savedFrom, setSavedFrom] = React.useState<'draw' | 'upload' | null>(null);
  /** The current user's saved profile signature — previewed on the right. */
  const [savedSig, setSavedSig] = React.useState<SavedSignature | null>(null);

  React.useEffect(() => {
    if (me?.id) {
      const sig = getProfileSignature(me.id, me.name);
      setSavedSig(sig);
    }
  }, [me?.id, me?.name]);

  function onFileChosen(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image', { description: 'Choose a PNG or JPG.' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('File is too large', { description: 'Signatures must be under 2 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setUpload({ name: file.name, previewUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  function save() {
    const at = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (tab === 'draw') {
      const src = padRef.current?.getDataURL();
      if (!src) {
        toast.error('Draw a signature first', { description: 'The pad is empty — nothing to save.' });
        return;
      }
      const data: SavedSignature = { src, source: 'draw', at };
      if (me?.id) saveProfileSignature(me.id, data);
      setSavedSig(data);
      toast.success('Signature saved to profile', { description: 'Drawn signature stored to your profile.' });
    } else {
      if (!upload) {
        toast.error('Choose a file first', { description: 'Upload a PNG or JPG to save.' });
        return;
      }
      const data: SavedSignature = { src: upload.previewUrl, source: 'upload', at };
      if (me?.id) saveProfileSignature(me.id, data);
      setSavedSig(data);
      toast.success('Signature saved to profile', { description: `${upload.name} saved to your profile.` });
    }
    setSavedFrom(tab);
  }

  function cancel() {
    padRef.current?.clear();
    setUpload(null);
    setSavedFrom(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    // `p-6` here was doubling the padding <main> already applies, so this was
    // the one page inset further from the rail than every other.
    <div className="flex flex-col gap-[18px]">
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Create a signature" />
          <CardBody>
            <div className="mb-3 isolate inline-flex -space-x-px" role="tablist">
              {(['draw', 'upload'] as const).map((t, i) => (
                <UiButton key={t} type="button" role="tab" aria-selected={tab === t} size="sm"
                  variant={tab === t ? 'default' : 'outline'}
                  onClick={() => { setTab(t); setSavedFrom(null); }}
                  className={cn('capitalize focus-visible:z-10', i === 0 ? 'rounded-r-none' : 'rounded-l-none')}>
                  {t}
                </UiButton>
              ))}
            </div>
            {tab === 'draw' ? (
              <SignaturePad ref={padRef} onDraw={() => setSavedFrom(null)} />
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => { onFileChosen(e.target.files?.[0]); setSavedFrom(null); }}
                />
                {upload ? (
                  <div className="relative flex h-[158px] items-center justify-center overflow-hidden rounded-lg border border-dashed border-input bg-white p-3 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={upload.previewUrl} alt="Uploaded signature preview" className="max-h-full max-w-full object-contain" />
                    <button type="button" onClick={cancel} aria-label="Remove uploaded file"
                      className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-card text-muted-foreground shadow-sm hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); onFileChosen(e.dataTransfer.files?.[0]); setSavedFrom(null); }}
                    className="flex h-[158px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input bg-muted p-3 text-center text-[12.5px] text-muted-foreground hover:border-primary hover:text-foreground"
                  >
                    <Upload className="h-5 w-5" aria-hidden="true" />
                    <b className="font-medium text-foreground">Drop a PNG or JPG, or click to choose</b>
                    <span>Transparent background preferred · max 2 MB</span>
                  </button>
                )}
                <div className="flex justify-between pt-2 text-xs text-muted-foreground">
                  <span>{upload ? upload.name : 'Background is removed automatically'}</span>
                  <Button size="sm" onClick={() => fileInputRef.current?.click()}>Choose file</Button>
                </div>
              </>
            )}
            {savedFrom === tab && (
              <p className="mt-2 text-[11.5px] font-medium text-[var(--status-good)]">Saved to your profile.</p>
            )}
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="primary" onClick={save}>Save to profile</Button>
              <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your saved signature"
            action={savedSig ? <Badge variant="good">Active</Badge> : <Badge variant="muted">None saved</Badge>} />
          <CardBody>
            {savedSig ? (
              <div className="flex flex-col gap-3">
                <div className="flex h-[158px] items-center justify-center overflow-hidden rounded-lg border border-input bg-white p-4 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={savedSig.src} alt="Your saved signature" className="max-h-full max-w-full object-contain" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
                  <span>Saved from {savedSig.source === 'draw' ? 'drawn strokes' : 'an uploaded image'} · {savedSig.at}</span>
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSavedSig(null)}>
                    Remove
                  </button>
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  This is the signature the system uses for you &mdash; you won&rsquo;t need to draw or upload it again each time.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-input bg-muted/40">
                <EmptyState
                  icon={PenLine}
                  title="No signature saved yet"
                  description="Create one on the left. Once you save it, it previews here and is reused on every form you sign."
                  className="h-[220px]"
                />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
