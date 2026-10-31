'use client';

// =====================================================================
// AI 3D Studio — text → spec review → queued generation → validated STL.
//
// Everything on this screen comes from the server:
//   * the spec preview is the engine's own reading of the prompt;
//   * progress is the provider-reported value, shown only when one exists;
//   * the 3D preview appears only once a real STL is stored.
// The previous version animated a fake progress bar and showed a
// procedural shape while "generating".
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, ScanSearch, Sparkles, Upload, X, Eye, Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThreeViewer } from '../three-viewer';
import { api } from '@/lib/api-client';
import { sonnerToast } from '../sonner-toast';
import { Breadcrumbs } from '../breadcrumbs';
import { ValidationPanel, parseReport } from '../validation-panel';
import type { DesignSpec, GenerationStatusResponse } from '@/lib/types';

const EXAMPLES = [
  { ar: 'صمّم حامل هاتف مكتبي بعرض 90 مم، وارتفاع 110 مم، وفتحة لشحن الهاتف، وزاوية ميل 65 درجة', en: 'Desk phone stand 90 mm wide, 110 mm tall, charging slot, 65° tilt' },
  { ar: 'علبة منظّم 120x80x40 مم بسماكة جدار 2 مم و 3 فواصل', en: 'Organizer box 120x80x40 mm, 2 mm walls, 3 dividers' },
  { ar: 'زاوية تثبيت رف بعرض 30 مم وسماكة 5 مم وثقبين بقطر 4.5 مم', en: 'Shelf bracket 30 mm wide, 5 mm thick, 2 holes of 4.5 mm' },
  { ar: 'وردة فاصل قطر خارجي 22 مم وقطر داخلي 8 مم وارتفاع 10 مم', en: 'Spacer: outer diameter 22 mm, inner diameter 8 mm, height 10 mm' },
  { ar: 'علّاقة جدارية بعرض 25 مم وبروز 35 مم', en: 'Wall hook 25 mm wide with 35 mm reach' },
];

const STAGES = ['QUEUED', 'GENERATING', 'DOWNLOADING', 'CONVERTING', 'VALIDATING', 'REVIEW_REQUIRED'] as const;
const STAGE_LABEL: Record<string, { ar: string; en: string }> = {
  QUEUED: { ar: 'في الطابور', en: 'Queued' },
  GENERATING: { ar: 'التوليد', en: 'Generating' },
  DOWNLOADING: { ar: 'التنزيل', en: 'Downloading' },
  CONVERTING: { ar: 'التحويل إلى STL', en: 'Converting to STL' },
  VALIDATING: { ar: 'فحص الشبكة', en: 'Validating mesh' },
  REVIEW_REQUIRED: { ar: 'جاهز للمراجعة', en: 'Ready for review' },
  FAILED: { ar: 'فشل', en: 'Failed' },
  CANCELLED: { ar: 'أُلغي', en: 'Cancelled' },
};
const TERMINAL = new Set(['REVIEW_REQUIRED', 'FAILED', 'CANCELLED']);
const SOURCE_LABEL: Record<string, { ar: string; en: string; cls: string }> = {
  prompt: { ar: 'من الوصف', en: 'from text', cls: 'border-cyan-glow/30 text-cyan-glow' },
  llm: { ar: 'من الوصف (AI)', en: 'from text (AI)', cls: 'border-cyan-glow/30 text-cyan-glow' },
  user_field: { ar: 'أدخلته', en: 'you set', cls: 'border-success/30 text-success' },
  default: { ar: 'افتراضي', en: 'default', cls: 'border-warning/30 text-warning' },
};

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NewProjectView() {
  const t = useT();
  const isRTL = useIsRTL();
  const setView = useAppStore(s => s.setView);
  const selectProject = useAppStore(s => s.selectProject);
  const L = (o: { ar: string; en: string }) => (isRTL ? o.ar : o.en);

  // ---- form
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'AI_DESIGN' | 'AUTO' | 'PARAMETRIC' | 'FREEFORM'>('AI_DESIGN');
  // AI designer conversation: the questions it asked and what the customer answered
  const [designQa, setDesignQa] = useState<{ question: string; answer: string }[]>([]);
  const [designRound, setDesignRound] = useState(0);
  const [designUnderstanding, setDesignUnderstanding] = useState('');
  const [designQuestions, setDesignQuestions] = useState<Awaited<ReturnType<typeof api.clarifyDesign>>['questions']>([]);
  const [designAnswers, setDesignAnswers] = useState<Record<string, string>>({});
  const [designReady, setDesignReady] = useState(false);
  const [clarifying, setClarifying] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [targetLongest, setTargetLongest] = useState<string>('100');
  const [spec, setSpec] = useState<DesignSpec | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);

  // ---- job
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idemKey = useRef(newKey());

  const freeform = mode === 'FREEFORM' || !!referenceImage || (mode === 'AUTO' && spec !== null && !spec.template);

  // any edit to the request is a new submission intent
  useEffect(() => { idemKey.current = newKey(); }, [prompt, mode, referenceImage, targetLongest, overrides]);

  // ---- follow the job (server is the source of truth; refetch survives reconnects)
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const ctrl = new AbortController();
    async function tick() {
      try {
        const s = await api.getGeneration(jobId!, ctrl.signal);
        if (stop) return;
        setStatus(s);
        if (TERMINAL.has(s.job.status)) return;
      } catch (e) {
        if (stop) return;
        setError(e instanceof Error ? e.message : 'status unavailable');
      }
      setTimeout(() => { if (!stop) tick(); }, 2000);
    }
    tick();
    return () => { stop = true; ctrl.abort(); };
  }, [jobId]);

  const analyze = useCallback(async () => {
    if (prompt.trim().length < 3) return;
    setAnalyzing(true);
    setError(null);
    const userFields: Record<string, number> = {};
    for (const [k, v] of Object.entries(overrides)) if (v.trim() !== '' && Number.isFinite(Number(v))) userFields[k] = Number(v);
    try {
      const { spec } = await api.parseSpec({ prompt, userFields }); // re-analysing re-checks edited values
      setSpec(spec);
    } catch (e) {
      setSpec(null);
      setError(e instanceof Error ? e.message : 'analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, [prompt, overrides]);

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      sonnerToast.error(L({ ar: 'نوع الصورة غير مدعوم', en: 'Unsupported image type' }), { description: 'PNG / JPEG / WebP' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      sonnerToast.error(L({ ar: 'الصورة أكبر من 10 ميغابايت', en: 'Image larger than 10 MB' }));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setReferenceImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function clarify(qaSoFar: { question: string; answer: string }[], round: number) {
    setClarifying(true);
    setError(null);
    try {
      const r = await api.clarifyDesign({ idea: prompt.trim(), qa: qaSoFar, round });
      setDesignRound(round);
      setDesignUnderstanding(r.understanding);
      setDesignReady(r.ready);
      setDesignQuestions(r.ready ? [] : r.questions);
      setDesignAnswers(Object.fromEntries(r.questions.map((q) => [q.id, q.suggested ?? ''])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI designer unavailable');
    } finally {
      setClarifying(false);
    }
  }

  function submitAnswers() {
    const qa = [...designQa, ...designQuestions.map((q) => ({ question: q.question_ar, answer: (designAnswers[q.id] || q.suggested || '').trim() || 'as you see fit' }))];
    setDesignQa(qa);
    setDesignQuestions([]);
    if (designRound >= 2) setDesignReady(true);
    else clarify(qa, designRound + 1);
  }

  async function generate() {
    setError(null);
    if (mode === 'AI_DESIGN' && !referenceImage && !designReady) {
      setError(L({ ar: 'ابدأ بالحوار مع المصمّم وأجب عن أسئلته أولًا.', en: 'Talk to the designer and answer its questions first.' }));
      return;
    }
    const userFields: Record<string, number> = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (v.trim() === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) { setError(`${k}: ${L({ ar: 'قيمة غير رقمية', en: 'not a number' })}`); return; }
      userFields[k] = n;
    }
    // AUTO without a preview: read the prompt first, so free-form requests get their size field
    if (!referenceImage && mode === 'AUTO' && !spec) {
      try {
        const { spec: s } = await api.parseSpec({ prompt, userFields });
        setSpec(s);
        if (!s.template) {
          setError(L({ ar: 'لا يوجد قالب هندسي لهذا الوصف؛ حدّد الطول الأكبر ثم أعد الضغط على "أنشئ".', en: 'No CAD template fits; set the longest side, then press Generate again.' }));
          return;
        }
      } catch {
        /* engine unavailable: the server answers with the precise reason below */
      }
    }
    const longest = Number(targetLongest);
    if (freeform && !(longest > 0)) {
      setError(L({ ar: 'حدّد الطول الأكبر للمجسم بالملليمتر', en: 'Set the longest side in millimetres' }));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createProject({
        name: name.trim() || prompt.trim().slice(0, 60) || 'Untitled',
        prompt: prompt.trim(),
        mode: referenceImage ? 'FREEFORM' : mode,
        inputType: referenceImage ? 'IMAGE_TO_3D' : 'TEXT_TO_3D',
        referenceImageBase64: referenceImage ?? undefined,
        template: spec?.template ?? undefined,
        userFields,
        targetLongestMm: freeform ? longest : undefined,
        designQa: mode === 'AI_DESIGN' ? designQa : undefined,
        designUnderstanding: mode === 'AI_DESIGN' ? designUnderstanding : undefined,
      }, idemKey.current);
      setStatus(null);
      setJobId(res.generationJob.id);
      selectProject(res.project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation request failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!jobId) return;
    try {
      const r = await api.cancelGeneration(jobId);
      if (r.providerTaskMayStillRun) {
        sonnerToast.warning(L({ ar: 'أُلغيت المهمة؛ قد يكمل المزود الخارجي عمله وتُحتسب تكلفته', en: 'Cancelled; the external provider may still finish (and bill) its task' }));
      }
    } catch (e) {
      sonnerToast.error(e instanceof Error ? e.message : 'cancel failed');
    }
  }

  function reset(keepInputs = true) {
    setJobId(null);
    setStatus(null);
    setError(null);
    idemKey.current = newKey();
    if (!keepInputs) { setPrompt(''); setSpec(null); setOverrides({}); setReferenceImage(null); setName(''); }
  }

  const job = status?.job;
  const rev = status?.revision;
  const running = !!jobId && (!job || !TERMINAL.has(job.status));
  const stageIdx = job ? STAGES.indexOf(job.status as (typeof STAGES)[number]) : 0;
  const report = parseReport(rev?.validationReport);
  const stlUrl = rev?.stlUrl ?? null;

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs items={[{ label: t('nav.dashboard'), onClick: () => setView('dashboard') }, { label: L({ ar: 'استوديو التوليد', en: 'AI 3D Studio' }) }]} />
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{L({ ar: 'استوديو التوليد ثلاثي الأبعاد', en: 'AI 3D Studio' })}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {L({ ar: 'اكتب ما تريد طباعته؛ تُبنى القطع الوظيفية هندسيًا بأبعاد دقيقة بالملليمتر، ويُفحص ملف STL قبل المراجعة.', en: 'Describe what to print. Functional parts are built as exact CAD in millimetres; every STL is validated before review.' })}
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.15fr] gap-4">
        {/* ------------------------------------------------ request */}
        <div className="space-y-4">
          <Card className="premium-card">
            <CardHeader className="pb-3"><CardTitle className="text-sm">{L({ ar: '1. الوصف', en: '1. Description' })}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="studio-name" className="text-xs">{t('project.name')}</Label>
                <Input id="studio-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} className="bg-background/60" disabled={running} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="studio-prompt" className="text-xs">{L({ ar: 'الوصف النصي', en: 'Prompt' })}</Label>
                <Textarea id="studio-prompt" value={prompt} onChange={e => { setPrompt(e.target.value); setSpec(null); setOverrides({}); setDesignRound(0); setDesignReady(false); setDesignQuestions([]); setDesignUnderstanding(''); }} maxLength={2000}
                  className="bg-background/60 min-h-[110px]" disabled={running}
                  placeholder={L({ ar: 'مثال: حامل هاتف بعرض 90 مم…', en: 'e.g. phone stand 90 mm wide…' })} />
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex, i) => (
                    <button key={i} type="button" disabled={running} onClick={() => { setPrompt(L(ex)); setSpec(null); setOverrides({}); }}
                      className="text-[11px] px-2 py-1 rounded-md border border-border/50 hover:bg-accent text-muted-foreground disabled:opacity-50">
                      {L(ex).slice(0, 34)}…
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{L({ ar: 'طريقة التوليد', en: 'Generation mode' })}</Label>
                  <Select value={mode} onValueChange={v => setMode(v as typeof mode)} disabled={running}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AI_DESIGN">{L({ ar: 'مصمّم بالذكاء الاصطناعي (أي فكرة)', en: 'AI designer (any idea)' })}</SelectItem>
                      <SelectItem value="AUTO">{L({ ar: 'تلقائي (قالب هندسي إن وُجد)', en: 'Auto (CAD template when one fits)' })}</SelectItem>
                      <SelectItem value="PARAMETRIC">{L({ ar: 'هندسي دقيق فقط', en: 'Exact CAD only' })}</SelectItem>
                      <SelectItem value="FREEFORM">{L({ ar: 'AI حر (مجسمات فنية)', en: 'Free-form AI (artistic)' })}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{L({ ar: 'صورة مرجعية (اختياري)', en: 'Reference image (optional)' })}</Label>
                  {referenceImage ? (
                    <div className="flex items-center gap-2">
                      <img src={referenceImage} alt="" className="h-9 w-9 rounded object-cover border border-border" />
                      <Button variant="ghost" size="sm" onClick={() => setReferenceImage(null)} disabled={running}><X className="h-4 w-4" /></Button>
                    </div>
                  ) : (
                    <label className={cn('h-9 flex items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs cursor-pointer hover:bg-accent', running && 'pointer-events-none opacity-50')}>
                      <Upload className="h-3.5 w-3.5" />PNG / JPEG / WebP
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImage} />
                    </label>
                  )}
                </div>
              </div>
              {freeform && (
                <div className="space-y-1.5">
                  <Label htmlFor="studio-longest" className="text-xs">{L({ ar: 'الطول الأكبر للمجسم (مم) — إلزامي للتوليد الحر', en: 'Longest side (mm) — required for free-form' })}</Label>
                  <Input id="studio-longest" type="number" min={1} max={2000} value={targetLongest} onChange={e => setTargetLongest(e.target.value)} className="bg-background/60 w-40" disabled={running} />
                  <p className="text-[11px] text-muted-foreground">
                    {L({ ar: 'نماذج AI الحرّة لا تحمل أبعادًا فيزيائية موثوقة؛ يُطبَّق هذا القياس بشكل صريح ويُسجَّل.', en: 'Free-form AI meshes have no reliable physical size; this scale is applied explicitly and recorded.' })}
                  </p>
                </div>
              )}
              {!referenceImage && mode === 'AI_DESIGN' && (
                <div className="space-y-2">
                  {designRound === 0 && (
                    <Button variant="outline" onClick={() => { setDesignQa([]); clarify([], 1); }} disabled={running || clarifying || prompt.trim().length < 4} className="w-full gap-2">
                      {clarifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                      {L({ ar: '2. ناقش الفكرة مع المصمّم', en: '2. Discuss the idea with the designer' })}
                    </Button>
                  )}
                  {designUnderstanding && (
                    <div className="text-xs rounded-md border border-border/50 bg-background/40 p-2">
                      <span className="font-medium">{L({ ar: 'فهم المصمّم: ', en: 'Designer understood: ' })}</span>{designUnderstanding}
                    </div>
                  )}
                  {designQuestions.map((q) => (
                    <label key={q.id} className="block space-y-1 text-xs">
                      <span className="font-medium">{q.question_ar}</span>
                      {q.why_ar && <span className="block text-muted-foreground">{q.why_ar}</span>}
                      <Input value={designAnswers[q.id] ?? ''} onChange={(e) => setDesignAnswers({ ...designAnswers, [q.id]: e.target.value })} className="h-8 bg-background/60" />
                    </label>
                  ))}
                  {designQuestions.length > 0 && (
                    <Button variant="outline" onClick={submitAnswers} disabled={clarifying} className="w-full">{L({ ar: 'أرسل الإجابات', en: 'Send answers' })}</Button>
                  )}
                  {clarifying && designRound > 0 && <div className="text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin me-1" />{L({ ar: 'المصمّم يفكّر…', en: 'Designer is thinking…' })}</div>}
                  {designReady && <div className="text-xs text-success">{L({ ar: 'المصمّم جاهز. اضغط "أنشئ المجسم" ليكتب نموذج CAD ويبنيه ويفحصه.', en: 'Ready. Press Generate: it writes, builds and checks the CAD model.' })}</div>}
                </div>
              )}
              {!referenceImage && mode !== 'FREEFORM' && mode !== 'AI_DESIGN' && (
                <Button variant="outline" onClick={analyze} disabled={running || analyzing || prompt.trim().length < 3} className="w-full gap-2">
                  {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                  {L({ ar: '2. حلّل الوصف وراجع الأبعاد', en: '2. Analyse and review dimensions' })}
                </Button>
              )}
            </CardContent>
          </Card>

          {spec && <SpecCard spec={spec} overrides={overrides} setOverrides={setOverrides} disabled={running} isRTL={isRTL} />}

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1 break-words">{error}</span>
            </div>
          )}

          <Button onClick={generate} disabled={running || submitting || prompt.trim().length < 3 || (spec?.errors.length ?? 0) > 0}
            className="w-full bg-gradient-to-r from-cyan-glow to-violet-glow text-background hover:opacity-90 gap-2 h-11">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {L({ ar: 'أنشئ المجسم', en: 'Generate model' })}
          </Button>
        </div>

        {/* ------------------------------------------------ result */}
        <div className="space-y-4">
          <Card className="premium-card overflow-hidden">
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">{L({ ar: 'النتيجة', en: 'Result' })}</CardTitle>
              {job && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {job.provider}{job.providerModel ? ` · ${job.providerModel}` : ''}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!jobId && (
                <div className="text-sm text-muted-foreground text-center py-16">
                  {L({ ar: 'لا توجد مهمة بعد. ستظهر المعاينة هنا بعد إنتاج ملف STL فعلي.', en: 'No job yet. The preview appears here once a real STL exists.' })}
                </div>
              )}

              {jobId && (
                <ol className="flex flex-wrap gap-1.5" aria-label="stages">
                  {STAGES.map((s, i) => {
                    const failed = job && (job.status === 'FAILED' || job.status === 'CANCELLED');
                    const done = job && !failed && (i < stageIdx || job.status === 'REVIEW_REQUIRED');
                    const current = job && !failed && i === stageIdx && job.status !== 'REVIEW_REQUIRED';
                    return (
                      <li key={s} className={cn('text-[11px] px-2 py-1 rounded-md border',
                        done ? 'border-success/30 text-success bg-success/5' :
                        current ? 'border-cyan-glow/40 text-cyan-glow bg-cyan-glow/5' : 'border-border/40 text-muted-foreground')}>
                        {current && <Loader2 className="inline h-3 w-3 me-1 animate-spin" />}
                        {L(STAGE_LABEL[s])}
                      </li>
                    );
                  })}
                </ol>
              )}

              {job && job.status === 'GENERATING' && job.progress > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] text-muted-foreground">{L({ ar: 'تقدّم أبلغ عنه المزود', en: 'Provider-reported progress' })}: <span className="font-mono">{job.progress}%</span></div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-cyan-glow" style={{ width: `${job.progress}%` }} /></div>
                </div>
              )}

              {job && (job.status === 'FAILED' || job.status === 'CANCELLED') && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                  <div className="font-medium mb-0.5">{L(STAGE_LABEL[job.status])}</div>
                  <div className="break-words" dir="ltr">{job.errorMessage}</div>
                </div>
              )}

              {job && job.status !== 'REVIEW_REQUIRED' && job.errorMessage && !TERMINAL.has(job.status) && (
                <div className="text-[11px] text-warning" dir="ltr">{job.errorMessage}</div>
              )}

              {stlUrl && rev && (
                <>
                  <ThreeViewer modelUrl={stlUrl} modelFormat="STL" className="h-[320px] sm:h-[380px] w-full rounded-md border border-border/40" />
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {(['x', 'y', 'z'] as const).map(a => (
                      <div key={a} className="rounded-md border border-border/40 p-2">
                        <div className="text-muted-foreground uppercase">{a}</div>
                        <div className="font-mono font-medium">{rev.sizeMm?.[a]?.toFixed(2) ?? '—'} mm</div>
                      </div>
                    ))}
                  </div>
                  {job?.result?.transforms && job.result.transforms.length > 0 && (
                    <details className="text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">{L({ ar: 'التحويلات المطبّقة على الهندسة', en: 'Transformations applied to the geometry' })}</summary>
                      <ul className="list-disc ps-5 mt-1" dir="ltr">{job.result.transforms.map((x, i) => <li key={i}>{x}</li>)}</ul>
                    </details>
                  )}
                  <ValidationPanel report={report} isRTL={isRTL} />
                </>
              )}

              {jobId && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {running && (
                    <Button variant="outline" size="sm" onClick={cancel} className="gap-1.5"><Ban className="h-3.5 w-3.5" />{t('common.cancel')}</Button>
                  )}
                  {stlUrl && (
                    <Button asChild size="sm" className="gap-1.5 bg-gradient-to-r from-cyan-glow to-violet-glow text-background">
                      <a href={`${stlUrl}?download=1`}><Download className="h-3.5 w-3.5" />{L({ ar: 'تنزيل STL', en: 'Download STL' })}</a>
                    </Button>
                  )}
                  {stlUrl && (
                    <Button variant="outline" size="sm" onClick={() => setView('model_viewer')} className="gap-1.5"><Eye className="h-3.5 w-3.5" />{L({ ar: 'فتح في العارض', en: 'Open in viewer' })}</Button>
                  )}
                  {!running && (
                    <Button variant="outline" size="sm" onClick={() => reset(true)} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" />{L({ ar: 'إعادة التوليد', en: 'Regenerate' })}</Button>
                  )}
                </div>
              )}

              {job?.status === 'REVIEW_REQUIRED' && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  {L({ ar: 'أُرسل النموذج للمصمم. لا تُتاح الطباعة إلا بعد موافقته.', en: 'Sent to a designer. Printing becomes available only after approval.' })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SpecCard({ spec, overrides, setOverrides, disabled, isRTL }: {
  spec: DesignSpec;
  overrides: Record<string, string>;
  setOverrides: (o: Record<string, string>) => void;
  disabled: boolean;
  isRTL: boolean;
}) {
  const L = (o: { ar: string; en: string }) => (isRTL ? o.ar : o.en);
  const schema = spec.template_schema;
  return (
    <Card className="premium-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span>{L({ ar: '3. المواصفات المستخرجة', en: '3. Extracted specification' })}</span>
          <Badge variant="outline" className="text-[10px] font-mono">{spec.extractor === 'llm' ? 'LLM' : L({ ar: 'محلّل القواعد', en: 'rule parser' })}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {!schema ? (
          <div className="text-warning">{spec.clarifications[0]}</div>
        ) : (
          <>
            <div className="font-medium">{isRTL ? schema.title_ar : schema.title_en}</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {schema.params.map(p => {
                const pv = spec.params[p.name];
                const src = overrides[p.name] !== undefined && overrides[p.name] !== '' ? 'user_field' : pv?.source ?? 'default';
                const unit = p.unit === 'deg' ? '°' : p.unit === 'mm' ? 'mm' : '';
                return (
                  <label key={p.name} className="space-y-1">
                    <span className="flex items-center justify-between gap-1">
                      <span>{isRTL ? p.label_ar : p.label_en}</span>
                      <Badge variant="outline" className={cn('text-[9px]', SOURCE_LABEL[src].cls)}>{L(SOURCE_LABEL[src])}</Badge>
                    </span>
                    <div className="flex items-center gap-1">
                      <Input type="number" disabled={disabled} min={p.min} max={p.max}
                        step={p.unit === 'count' || p.unit === 'bool' ? 1 : 0.1}
                        value={overrides[p.name] ?? String(pv?.value ?? p.default)}
                        onChange={e => setOverrides({ ...overrides, [p.name]: e.target.value })}
                        className="h-8 bg-background/60 font-mono" />
                      <span className="text-muted-foreground w-6">{unit}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}
        {spec.assumptions.length > 0 && (
          <ul className="list-disc ps-5 text-warning space-y-0.5">{spec.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        )}
        {spec.errors.length > 0 && (
          <ul className="list-disc ps-5 text-destructive space-y-0.5" dir="ltr">{spec.errors.map((a, i) => <li key={i}>{a}</li>)}</ul>
        )}
        {spec.requirements.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">{L({ ar: 'المتطلبات القابلة للقياس', en: 'Measurable requirements' })}</summary>
            <ul className="list-disc ps-5 mt-1 space-y-0.5" dir="ltr">{spec.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
