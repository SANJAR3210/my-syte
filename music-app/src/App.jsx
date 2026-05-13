import React, { useState, useRef, useEffect, useCallback } from 'react';
import './index.css';

const RAPIDAPI_KEY = '89f48ff25dmshf1508f2383c5625p16374ejsnadf0d6e6a378';

const IconMic = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>;
const IconStop = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>;
const IconDisc = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>;
const IconGuitar = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>;
const IconDownload = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>;
const IconSearch = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;

const autoCorrelate = (buf, sampleRate) => {
  let SIZE = buf.length, rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  buf = buf.slice(r1, r2); SIZE = buf.length;
  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] += buf[j] * buf[j + i];
  let d = 0; while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  if (maxpos === -1) return -1;
  let T0 = maxpos;
  const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
  if (Math.abs(a) > 0.001) T0 = T0 - b / (2 * a);
  return sampleRate / T0;
};

const getNoteFromFrequency = (frequency) => {
  const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  const noteIndex = Math.round(noteNum) + 69;
  if (noteIndex < 0 || noteIndex > 127) return { note: "--", cents: 0, octave: 0 };
  const note = noteStrings[noteIndex % 12];
  const octave = Math.floor(noteIndex / 12) - 1;
  const expectedFreq = 440 * Math.pow(2, (noteIndex - 69) / 12);
  const cents = Math.round(1200 * Math.log(frequency / expectedFreq) / Math.log(2));
  return { note, cents, octave };
};

const detectChord = (frequencies) => {
  if (frequencies.length < 2) return null;
  const notes = [...new Set(frequencies.map(f => getNoteFromFrequency(f).note).filter(n => n !== '--'))];
  if (notes.length < 2) return null;
  const chordPatterns = { '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10] };
  const noteToSemitone = { "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11 };
  for (const [suffix, pattern] of Object.entries(chordPatterns)) {
    for (const rootNote of notes) {
      const rootSemitone = noteToSemitone[rootNote];
      const expectedNotes = pattern.map(interval => {
        const semitone = (rootSemitone + interval) % 12;
        return Object.keys(noteToSemitone).find(n => noteToSemitone[n] === semitone);
      });
      const matches = expectedNotes.filter(n => notes.includes(n)).length;
      if (matches >= Math.min(3, expectedNotes.length) && matches >= notes.length - 1) return `${rootNote}${suffix}`;
    }
  }
  return null;
};

const SimpleVisualizer = ({ analyser, isListening }) => {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!analyser || !isListening) return;
    const canvas = canvasRef.current, ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount, dataArray = new Uint8Array(bufferLength);
    let animationId;
    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5; let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#27272a'); gradient.addColorStop(1, '#e4e4e7');
        ctx.fillStyle = gradient; ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };
    draw(); return () => cancelAnimationFrame(animationId);
  }, [analyser, isListening]);
  return <canvas ref={canvasRef} width={600} height={60} className="visualizer-container" style={{ width: '100%', maxWidth: '600px', height: '60px' }} />;
};

const TunerView = () => {
  const [note, setNote] = useState({ note: "--", cents: 0, octave: 0 });
  const [frequency, setFrequency] = useState(0);
  const [volume, setVolume] = useState(0);
  const [chord, setChord] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const audioCtxRef = useRef(null), analyserRef = useRef(null), sourceRef = useRef(null), rafRef = useRef(null), frequencyHistoryRef = useRef([]);
  
  const processAudio = useCallback(() => {
    if (!analyserRef.current || !audioCtxRef.current) return;
    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += Math.abs(buffer[i]);
    const currentVolume = sum / buffer.length; setVolume(currentVolume);
    const freq = autoCorrelate(buffer, audioCtxRef.current.sampleRate);
    if (freq !== -1 && freq >= 80 && freq <= 1200) {
      frequencyHistoryRef.current.push(freq);
      if (frequencyHistoryRef.current.length > 5) frequencyHistoryRef.current.shift();
      const avgFreq = frequencyHistoryRef.current.reduce((a, b) => a + b, 0) / frequencyHistoryRef.current.length;
      setFrequency(Math.round(avgFreq)); setNote(getNoteFromFrequency(avgFreq));
      if (frequencyHistoryRef.current.length >= 3) { const detected = detectChord(frequencyHistoryRef.current); if (detected) setChord(detected); }
    } else if (currentVolume < 0.02) { setNote({ note: "--", cents: 0, octave: 0 }); setFrequency(0); setChord(null); frequencyHistoryRef.current = []; }
    rafRef.current = requestAnimationFrame(processAudio);
  }, []);
  
  const startListening = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048; analyserRef.current.smoothingTimeConstant = 0.3;
      sourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);
      setIsListening(true); frequencyHistoryRef.current = []; processAudio();
    } catch (err) { console.error("Audio error:", err); setError(err.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён' : 'Ошибка инициализации аудио'); }
  };
  
  const stopListening = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current.mediaStream.getTracks().forEach(track => track.stop()); }
    if (audioCtxRef.current) audioCtxRef.current.close();
    setIsListening(false); setNote({ note: "--", cents: 0, octave: 0 }); setFrequency(0); setVolume(0); setChord(null); frequencyHistoryRef.current = [];
  };
  
  useEffect(() => { return () => { if (isListening) stopListening(); }; }, []);
  
  const centsDisplay = note.cents !== 0 ? <span style={{ color: note.cents > 50 ? 'var(--danger)' : note.cents < -50 ? 'var(--success)' : 'var(--text-secondary)', marginLeft: '0.5rem' }}>{note.cents > 0 ? '+' : ''}{note.cents}¢</span> : null;
  
  return (
    <>
      <div className="tuner-display">
        <div className={`note-large ${note.note === '--' ? 'flat' : ''}`}>{note.note}<span style={{ fontSize: '0.3em', verticalAlign: 'super', fontWeight: 400 }}>{note.octave}</span></div>
        <div className="freq-info text-mono">{frequency > 0 ? `${frequency} Hz` : 'Waiting for signal...'}{note.note !== '--' ? centsDisplay : null}</div>
        {chord && <div className="chord-badge active">Chord: {chord}</div>}
        {error && <div className="chord-badge" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
      </div>
      <SimpleVisualizer analyser={analyserRef.current} isListening={isListening} />
      <div className="controls">
        <button className={`btn ${isListening ? 'danger' : 'primary'}`} onClick={isListening ? stopListening : startListening}>
          {isListening ? <><IconStop /> Stop</> : <><IconMic /> Start</>}
        </button>
      </div>
    </>
  );
};

const SearchView = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setStatus('loading');
    setErrorMessage('');
    setResults([]);
    
    try {
      const url = `https://shazam-core.p.rapidapi.com/v1/search/multi?search_type=SONGS&offset=0&query=${encodeURIComponent(query)}`;
      
      // no-cors mode — CORS ошибки не будет, но ответ будет "opaque" (не читаемый)
      const response = await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'shazam-core.p.rapidapi.com'
        }
      });
      
      // С no-cors response.status всегда 0, response.body null
      // Это не работает для чтения данных
      
      setStatus('error');
      setErrorMessage('Поиск недоступен на GitHub Pages из-за CORS. Используйте локальный запуск: npm run dev');
      
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMessage('Ошибка сети. Попробуйте позже.');
    }
  };

  return (
    <div style={{ textAlign: 'center', maxWidth: '600px', width: '100%', margin: '0 auto', padding: '1rem' }}>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Search Music</h2>
      
      <div style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem', border: '1px solid var(--border)' }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          ⚠️ Поиск музыки недоступен на GitHub Pages
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Причина: CORS ограничения браузера.<br/>
          Решение: Запустите сайт локально через <code>npm run dev</code>
        </p>
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Artist or Song name..."
          className="input-dark"
          style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-panel)', color: 'white' }}
          disabled={true}
        />
        <button type="submit" className="btn primary" disabled={true} style={{ padding: '0 1.5rem', whiteSpace: 'nowrap', opacity: 0.5 }}>
          Search
        </button>
      </form>
      
      {errorMessage && (
        <div className="chord-badge" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '1rem' }}>{errorMessage}</div>
      )}
    </div>
  );
};

const GuitarView = () => {
  const [savedSongs, setSavedSongs] = useState(() => {
    try { const stored = localStorage.getItem('octave_songs'); return stored ? JSON.parse(stored) : []; } catch { return []; }
  });
  const [newSongName, setNewSongName] = useState('');
  const [currentChords, setCurrentChords] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [lastDetectedNote, setLastDetectedNote] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
  const audioCtxRef = useRef(null), analyserRef = useRef(null), sourceRef = useRef(null), rafRef = useRef(null);
  const lastDetectedNoteRef = useRef(null), noteStabilityCounterRef = useRef(0);
  const GUITAR_MIN_FREQ = 80, GUITAR_MAX_FREQ = 1200;

  const startRecording = async () => {
    try {
      setDetectionError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 4096; analyserRef.current.smoothingTimeConstant = 0.2;
      sourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);
      setIsRecording(true); lastDetectedNoteRef.current = null; noteStabilityCounterRef.current = 0;
      processGuitarAudio();
    } catch (err) { console.error("Guitar audio error:", err); setDetectionError(err.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён' : 'Ошибка аудио'); }
  };

  const stopRecording = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current.mediaStream.getTracks().forEach(track => track.stop()); }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    setIsRecording(false); setLastDetectedNote(null);
  };

  const processGuitarAudio = () => {
    if (!analyserRef.current || !audioCtxRef.current) return;
    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.02) { noteStabilityCounterRef.current = 0; rafRef.current = requestAnimationFrame(processGuitarAudio); return; }
    const freq = autoCorrelate(buffer, audioCtxRef.current.sampleRate);
    if (freq !== -1 && freq >= GUITAR_MIN_FREQ && freq <= GUITAR_MAX_FREQ) {
      const { note, cents } = getNoteFromFrequency(freq);
      if (note !== '--' && Math.abs(cents) < 50) {
        if (note === lastDetectedNoteRef.current) {
          noteStabilityCounterRef.current++;
          if (noteStabilityCounterRef.current >= 15) {
            setCurrentChords(prev => { if (prev.length === 0 || prev[prev.length - 1] !== note) return [...prev, note]; return prev; });
            noteStabilityCounterRef.current = 0;
          }
        } else { lastDetectedNoteRef.current = note; noteStabilityCounterRef.current = 0; setLastDetectedNote(note); }
      }
    }
    rafRef.current = requestAnimationFrame(processGuitarAudio);
  };

  const saveSong = () => {
    if (!newSongName.trim() || currentChords.length === 0) return;
    const song = { id: Date.now(), name: newSongName.trim(), chords: [...currentChords], date: new Date().toISOString() };
    try {
      const updated = [...savedSongs, song];
      setSavedSongs(updated); localStorage.setItem('octave_songs', JSON.stringify(updated));
      setNewSongName(''); setCurrentChords([]); lastDetectedNoteRef.current = null; setLastDetectedNote(null);
    } catch (err) { console.error("Save error:", err); if (err.name === 'QuotaExceededError') alert('Хранилище переполнено!'); else alert('Ошибка: ' + err.message); }
  };

  const deleteSong = (id) => { try { const updated = savedSongs.filter(s => s.id !== id); setSavedSongs(updated); localStorage.setItem('octave_songs', JSON.stringify(updated)); } catch (err) {} };

  const exportSong = (song) => {
    const chordLine = song.chords.map(c => `[${c}]`).join(' ');
    const content = `{title: ${song.name}}\n{subtitle: Created with Octave}\n\n{start_of_chorus}\n${chordLine}\n{end_of_chorus}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${song.name.replace(/[^a-z0-9а-яё]/gi, '_')}.pro`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const clearCurrentProgression = () => { setCurrentChords([]); lastDetectedNoteRef.current = null; setLastDetectedNote(null); noteStabilityCounterRef.current = 0; };

  useEffect(() => { return () => { stopRecording(); }; }, []);

  const groupedChords = [];
  for (let i = 0; i < currentChords.length; i += 10) groupedChords.push(currentChords.slice(i, i + 10));

  return (
    <div style={{ width: '100%', maxWidth: '800px' }}>
      <div className="card-grid" style={{ marginBottom: '2rem', gridTemplateColumns: '1fr' }}>
        <div className="song-card" style={{ padding: '1.5rem' }}>
          <input type="text" value={newSongName} onChange={(e) => setNewSongName(e.target.value)} placeholder="Song name..." className="input-dark" style={{ marginBottom: '1rem' }} onKeyDown={(e) => e.key === 'Enter' && saveSong()} />
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <button className={`btn ${isRecording ? 'danger' : 'primary'}`} onClick={isRecording ? stopRecording : startRecording}>{isRecording ? <><IconStop /> Stop</> : <><IconMic /> Record</>}</button>
            <button className="btn" onClick={saveSong} disabled={!newSongName.trim() || currentChords.length === 0} style={{ opacity: !newSongName.trim() || currentChords.length === 0 ? 0.5 : 1, cursor: !newSongName.trim() || currentChords.length === 0 ? 'not-allowed' : 'pointer' }}><IconDownload style={{ marginRight: '0.5rem' }} /> Save</button>
            {currentChords.length > 0 && <button className="btn" onClick={clearCurrentProgression} style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Clear</button>}
          </div>
          {detectionError && <div className="chord-badge" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '1rem' }}>{detectionError}</div>}
          {isRecording && (
            <div style={{ padding: '1rem', background: 'var(--bg-panel)', borderRadius: '6px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className="recording-indicator">●</span>
              <span style={{ fontSize: '0.9rem' }}>
                Listening...
                {lastDetectedNote && lastDetectedNote !== '--' ? (
                  <strong style={{ color: 'var(--accent)' }}>{lastDetectedNote}</strong>
                ) : null}
              </span>
            </div>
          )}
          {currentChords.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Current progression ({currentChords.length} chords):</p>
                <button onClick={() => navigator.clipboard.writeText(currentChords.join(' '))} style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} onMouseEnter={(e) => e.target.style.background = 'var(--border)'} onMouseLeave={(e) => e.target.style.background = 'none'}>Copy</button>
              </div>
              <div className="chord-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {groupedChords.map((group, groupIdx) => (
                  <div key={groupIdx} style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {group.map((chord, idx) => (
                      <span key={`${groupIdx}-${idx}`} className="chord-badge active" style={{ padding: '0.35rem 0.75rem', fontSize: '0.9rem', animation: 'popIn 0.2s ease-out' }}>{chord}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {savedSongs.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Saved Songs ({savedSongs.length})</h3>
            <button onClick={() => { if (confirm('Удалить все?')) { setSavedSongs([]); localStorage.removeItem('octave_songs'); } }} style={{ fontSize: '0.75rem', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem' }}>Clear All</button>
          </div>
          <div className="card-grid">
            {savedSongs.slice().reverse().map(song => (
              <div key={song.id} className="song-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                  <h4 style={{ fontWeight: 600, fontSize: '1rem' }}>{song.name}</h4>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button onClick={() => exportSong(song)} className="btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} title="Export"><IconDownload /></button>
                    <button onClick={() => deleteSong(song.id)} className="btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} title="Delete"><IconStop /></button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {song.chords.slice(0, 12).map((chord, idx) => (
                    <span key={idx} style={{ padding: '0.15rem 0.5rem', background: '#27272a', borderRadius: '3px', fontSize: '0.75rem' }}>{chord}</span>
                  ))}
                  {song.chords.length > 12 && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>+{song.chords.length - 12}</span>}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{new Date(song.date).toLocaleDateString()} • {song.chords.length} chords</p>
              </div>
            ))}
          </div>
        </>
      )}
      {savedSongs.length === 0 && currentChords.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          <IconGuitar style={{ marginBottom: '1rem', opacity: 0.5 }} />
          <p>Start recording to capture your chord progression</p>
        </div>
      )}
    </div>
  );
};

function App() {
  const [view, setView] = useState('tuner');
  return (
    <div className="app-container">
      <header>
        <div className="logo"><span style={{ fontWeight: 900, fontSize: '1.5rem' }}>OCT</span><span>AVE</span></div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>v1.3.0</div>
      </header>
      <main>
        {view === 'tuner' && <TunerView />}
        {view === 'search' && <SearchView />}
        {view === 'guitar' && <GuitarView />}
      </main>
      <nav className="tabs">
        <button className={`tab-btn ${view === 'tuner' ? 'active' : ''}`} onClick={() => setView('tuner')}>Tuner</button>
        <button className={`tab-btn ${view === 'guitar' ? 'active' : ''}`} onClick={() => setView('guitar')}>Chords</button>
        <button className={`tab-btn ${view === 'search' ? 'active' : ''}`} onClick={() => setView('search')}>Search</button>
      </nav>
    </div>
  );
}

export default App;