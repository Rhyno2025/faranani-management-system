// ---------------------------------------------------------------------------
// CALVIN — voice-only AI assistant control for the application header.
//
// * Activation button + on/off toggle, microphone permission status, animated
//   listening / processing / speaking indicators and an immediate stop control.
// * Speech-to-text via the Web Speech API (browser), reasoning via the server
//   AI gateway (/api/calvin) which runs permissioned tools against the live
//   database, speech-to-synthesis reply via speechSynthesis.
// * Voice selection is explicit: Southern African / UK English male voices are
//   preferred and the actually-used voice is reported to the user, including
//   when no African English voice is available.
// * Nothing is recorded: only the recognised transcript is sent to our server.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, MicOff, AudioWaveform, X, Square, Send, Volume2, AlertTriangle, Settings2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import { toast } from './ui';

type Status = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

interface Message { role: 'user' | 'assistant'; content: string }

const MALE_NAME = /(daniel|fred|david|george|thomas|richard|james|arthur|alex|male|guy|ryan|nick|william|mark)/i;

function pickVoice(
  preferred: SpeechSynthesisVoice | null,
  desiredName?: string,
  desiredLang?: string,
): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return preferred;
  if (desiredName) {
    const exact = voices.find((v) => v.name.toLowerCase() === desiredName.toLowerCase());
    if (exact) return exact;
  }
  const target = (desiredLang || 'en-ZA').toLowerCase();
  const languageFamily = voices.filter((v) => v.lang?.toLowerCase().startsWith(target.slice(0, 2)));
  const pool = languageFamily.length ? languageFamily : voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    const lang = (v.lang || '').toLowerCase();
    if (lang === target) s += 120;
    else if (lang === 'en-za' || lang === 'en-001' || lang === 'en-ss' || lang === 'en-ke' || lang === 'en-ng') s += 100;
    else if (lang.startsWith('en-gb')) s += 60;
    else if (lang.startsWith(target.slice(0, 2))) s += 40;
    else if (lang.startsWith('en')) s += 20;
    if (MALE_NAME.test(v.name)) s += 40;
    if (/female|samantha|karen|zira|fiona|serena|moira|tessa/i.test(v.name)) s -= 30;
    if (v.localService) s += 5;
    return s;
  };
  const best = pool.slice().sort((a, b) => score(b) - score(a))[0];
  if (!best) return preferred;
  if (preferred && preferred.name === best.name) return preferred;
  return best;
}

export function CalvinControl() {
  const { user, can } = useAuth();
  const navigate = useNavigate();

  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string>('Checking available voices…');
  const [config, setConfig] = useState<any>(null);
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // ---------------- configuration ----------------
  useEffect(() => {
    if (!can('ai.use')) return;
    api.get('/calvin/status').then(setConfig).catch(() => setConfig(null));
  }, [can]);

  // ---------------- speech synthesis voices ----------------
  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      setVoiceStatus('Speech synthesis is not available in this browser — CALVIN cannot speak.');
      return;
    }
    const desiredName = config?.voice?.voice_name || '';
    const desiredLang = config?.voice?.recognition_language || 'en-ZA';
    const load = () => {
      const v = pickVoice(null, desiredName, desiredLang);
      setVoice(v);
      if (!v) setVoiceStatus('No matching voice is available in this browser.');
      else if (!desiredLang || v.lang?.toLowerCase() === desiredLang.toLowerCase()) {
        setVoiceStatus(`Voice: ${v.name} (${v.lang})`);
      } else if (!/en-za|en-001|en-ss|en-ke|en-ng/i.test(v.lang || '')) {
        setVoiceStatus(`Using "${v.name}" (${v.lang}). No Southern African English voice is installed in this browser — the accent may differ from CALVIN's configured voice.`);
      } else {
        setVoiceStatus(`Voice: ${v.name} (${v.lang})`);
      }
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [config?.voice?.voice_name, config?.voice?.recognition_language]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    if (activeRef.current) setStatus('listening');
  }, []);

  const speak = useCallback((text: string) => {
    const settings = config?.voice;
    if (settings && settings.output_enabled === false) {
      if (activeRef.current) setStatus('listening');
      return;
    }
    if (!('speechSynthesis' in window) || !text) {
      if (activeRef.current) setStatus('listening');
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(voice, settings?.voice_name, settings?.recognition_language);
    if (v) u.voice = v;
    u.lang = v?.lang || settings?.recognition_language || 'en-ZA';
    u.rate = settings?.speech_rate || 1.0;
    u.pitch = settings?.speech_pitch || 0.92;
    u.onend = () => { utteranceRef.current = null; if (activeRef.current) setStatus('listening'); };
    u.onerror = () => { utteranceRef.current = null; if (activeRef.current) setStatus('listening'); };
    utteranceRef.current = u;
    setStatus('speaking');
    window.speechSynthesis.speak(u);
  }, [voice, config?.voice]);

  // ---------------- conversation ----------------
  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    const next: Message[] = [...messagesRef.current, { role: 'user', content: message }];
    setMessages(next);
    setHeard('');
    setStatus('processing');
    setError(null);
    try {
      const res = await api.post<{ configured: boolean; reply: string; tools_used: any[]; navigate_to?: string }>('/calvin', {
        message,
        history: messagesRef.current.slice(-8),
      });
      const withReply: Message[] = [...next, { role: 'assistant', content: res.reply }];
      setMessages(withReply);
      if (res.navigate_to) navigate(res.navigate_to);
      speak(res.reply);
      if (res.configured === false) setConfig((c: any) => ({ ...(c || {}), configured: false, instructions: res.reply }));
    } catch (e: any) {
      setError(e.message || 'CALVIN could not complete that request.');
      setStatus('error');
      const failMsg = `Sorry — ${e.message || 'that request failed.'}`;
      setMessages([...next, { role: 'assistant', content: failMsg }]);
      speak(failMsg);
    } finally {
      busyRef.current = false;
    }
  }, [navigate, speak]);

  // ---------------- speech recognition ----------------
  const ensureMicPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setMicPermission('unsupported'); return false; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission('granted');
      return true;
    } catch {
      setMicPermission('denied');
      return false;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
  }, []);

  const startRecognition = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.lang = config?.voice?.recognition_language || 'en-ZA';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal) return;
      const transcript = String(last[0].transcript || '').trim();
      if (!transcript) return;
      setHeard(transcript);
      // CALVIN should not claim it understood uncertain input
      if (transcript.split(' ').length < 2) {
        setError('I did not catch that clearly — please repeat the full command.');
        return;
      }
      window.speechSynthesis?.cancel();
      void send(transcript);
    };
    rec.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicPermission('denied');
        setError('Microphone access was denied. Allow microphone access in your browser to speak to CALVIN.');
        setActive(false);
        activeRef.current = false;
      } else if (event.error === 'no-speech') {
        // silence — keep listening while active
      } else if (event.error !== 'aborted') {
        setError(`Speech recognition error: ${event.error}`);
      }
    };
    rec.onend = () => {
      // restart while CALVIN is active and not speaking/processing
      if (activeRef.current && status === 'listening') {
        try { rec.start(); } catch { /* restarting */ }
      } else {
        recognitionRef.current = null;
      }
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  }, [send, status]);

  const deactivate = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    setStatus('idle');
    stopRecognition();
    window.speechSynthesis?.cancel();
    setHeard('');
    setError(null);
  }, [stopRecognition]);

  const activate = useCallback(async () => {
    if (active) { deactivate(); return; }
    if (!can('ai.use')) { toast('Your role does not include permission to use CALVIN.', 'error'); return; }
    setPanelOpen(true);
    const ok = await ensureMicPermission();
    if (!ok && micPermission !== 'unsupported') {
      setError('Microphone permission is required for voice commands. You can still type to CALVIN below.');
    }
    activeRef.current = true;
    setActive(true);
    setStatus('listening');
    setError(null);
    if (config?.voice?.input_enabled === false) {
      setError('Voice input is disabled by the administrator. You can still type your command below.');
      return;
    }
    if (ok) startRecognition();
  }, [active, can, config?.voice?.input_enabled, deactivate, ensureMicPermission, micPermission, startRecognition]);

  // cleanup on unmount / route leave
  useEffect(() => () => {
    activeRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    window.speechSynthesis?.cancel();
  }, []);

  if (!can('ai.use')) return null;

  const stateLabel: Record<Status, string> = {
    idle: 'Off', listening: 'Listening…', processing: 'Thinking…', speaking: 'Speaking…', error: 'Error',
  };
  const dotTone = status === 'error' ? 'bg-red-500' : status === 'idle' ? 'bg-neutral-300'
    : status === 'processing' ? 'bg-amber-400' : 'bg-emerald-500';

  return (
    <div className="relative">
      <button
        onClick={activate}
        aria-pressed={active}
        aria-label={active ? 'Turn CALVIN off' : 'Turn CALVIN on'}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
          active
            ? 'border-gold bg-ink text-gold shadow-sm'
            : 'border-line bg-white text-neutral-600 hover:border-gold/60 hover:text-gold-dark'
        }`}
      >
        <span className="relative flex h-5 w-5 items-center justify-center">
          {active ? <AudioWaveform size={15} className={status === 'listening' ? 'animate-pulse' : ''} /> : <Mic size={14} />}
          {active && <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${dotTone}`} />}
        </span>
        <span className="hidden sm:inline">CALVIN AI</span>
        <span className={`hidden text-[10px] font-medium md:inline ${active ? 'text-gold/70' : 'text-neutral-400'}`}>
          {stateLabel[status]}
        </span>
      </button>

      {panelOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,400px)] overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
          {/* header */}
          <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${dotTone} ${status === 'listening' ? 'animate-ping' : ''}`} />
              <div>
                <p className="text-sm font-bold text-gold">CALVIN</p>
                <p className="text-[10.5px] text-white/60">
                  {active ? stateLabel[status] : 'Deactivated'} · {micPermission === 'granted' ? 'Microphone ready'
                    : micPermission === 'denied' ? 'Microphone blocked'
                    : micPermission === 'unsupported' ? 'No speech recognition' : 'Microphone not requested'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {status === 'speaking' && (
                <button onClick={stopSpeaking} title="Stop speaking" aria-label="Stop CALVIN speaking"
                  className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
                  <Square size={14} />
                </button>
              )}
              <button onClick={() => setPanelOpen(false)} aria-label="Close CALVIN panel"
                className="rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white">
                <X size={15} />
              </button>
            </div>
          </div>

          {/* status strip */}
          <div className="flex items-center gap-2 border-b border-line bg-gold-soft/60 px-4 py-2 text-[11px] text-gold-dark">
            <Volume2 size={13} />
            <span className="flex-1">{voiceStatus}</span>
          </div>

          {config && config.configured === false && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-[11.5px] text-amber-800">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> AI provider not configured</p>
              <p className="mt-1">{config.instructions}</p>
            </div>
          )}

          {/* transcript / conversation */}
          <div className="max-h-[46vh] space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="text-center text-xs text-neutral-400">
                <p className="font-semibold text-neutral-600">Speak to CALVIN</p>
                <p className="mt-1">Try: “How many employees are registered?” or “Give me the current financial overview.”</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`max-w-[92%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                m.role === 'user' ? 'ml-auto bg-ink text-white' : 'bg-neutral-100 text-neutral-800'
              }`}>
                {m.content}
              </div>
            ))}
            {heard && status === 'processing' && (
              <div className="ml-auto max-w-[92%] rounded-xl bg-ink/70 px-3 py-2 text-xs italic text-white/80">{heard}</div>
            )}
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] text-red-700">{error}</p>
            )}
          </div>

          {/* controls */}
          <div className="border-t border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) { send(typed); setTyped(''); } }}
                placeholder={supported ? 'Type when you cannot speak…' : 'Speech recognition unsupported — type here…'}
                aria-label="Type a command for CALVIN"
                className="field !py-1.5 text-xs"
              />
              <button
                onClick={() => { if (typed.trim()) { send(typed); setTyped(''); } }}
                aria-label="Send"
                className="rounded-md bg-gold p-2 text-ink transition hover:bg-gold-dark"
              >
                <Send size={14} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                {messages.length} message{messages.length === 1 ? '' : 's'} this session
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => { if (active) deactivate(); else await activate(); }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                    active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-ink text-gold hover:bg-neutral-800'
                  }`}
                >
                  {active ? <MicOff size={13} /> : <Mic size={13} />}
                  {active ? 'Deactivate' : 'Activate microphone'}
                </button>
                <span className="rounded-md p-1 text-neutral-300" title="Voice and provider settings are managed on the server">
                  <Settings2 size={13} />
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
