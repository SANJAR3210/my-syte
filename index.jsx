import React, { useState, useRef, useEffect, useCallback } from 'react';
import './index.css';

const API_TOKEN = '6ffd7c8f0a710805cf6a7c71a70e87fb';
const USE_MOCK_AUDIO = false;

const IconMic = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>;
const IconStop = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>;
const IconDisc = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>;
const IconGuitar = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>;
const IconDownload = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>;

const autoCorrelate = (buf, sampleRate) => {
  let SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  }
  buf = buf.slice(r1, r2);
  SIZE = buf.length;
  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE - i; j++) {
      c[i] += buf[j] * buf[j + i];
    }
  }
  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
  if (maxpos === -1) return -1;
  let T0 = maxpos;
  const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (Math.abs(a) > 0.001) {
    T0 = T0 - b / (2 * a);
  }
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
  const chordPatterns = {
    '': [0, 4, 7],
    'm': [0, 3, 7],
    '7': [0, 4, 7, 10],
    'm7': [0, 3, 7, 10],
  };
  const noteToSemitone = { "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11 };
  for (const [suffix, pattern] of Object.entries(chordPatterns)) {
    for (const rootNote of notes) {
      const rootSemitone = noteToSemitone[rootNote];
      const expectedNotes = pattern.map(interval => {
        const semitone = (rootSemitone + interval) % 12;
        return Object.keys(noteToSemitone).find(n => noteToSemitone[n] === semitone);
      });
      const matches = expectedNotes.filter(n => notes.includes(n)).length;
      if (matches >= Math.min(3, expectedNotes.length) && matches >= notes.length - 1) {
        return `${rootNote}${suffix}`;
      }
    }
  }
  return null;
};

const SimpleVisualizer = ({ analyser, isListening }) => {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!analyser || !isListening) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId;
    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#27272a');
        gradient.addColorStop(1, '#e4e4e7');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [analyser, isListening]);
  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={60}
      className="visualizer-container"
      style={{ width: '100%', maxWidth: '600px', height: '60px' }}
    />
  );
};

const TunerView = () => {
  const [note, setNote] = useState({ note: "--", cents: 0, octave: 0 });
  const [frequency, setFrequency] = useState(0);
  const [volume, setVolume] = useState(0);
  const [chord, setChord] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const frequencyHistoryRef = useRef([]);
  
  const processAudio = useCallback(() => {
    if (!analyserRef.current || !audioCtxRef.current) return;
    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += Math.abs(buffer[i]);
    }
    const currentVolume = sum / buffer.length;
    setVolume(currentVolume);
    const freq = autoCorrelate(buffer, audioCtxRef.current.sampleRate);
    if (freq !== -1 && freq >= 80 && freq <= 1200) {
      frequencyHistoryRef.current.push(freq);
      if (frequencyHistoryRef.current.length > 5) {
        frequencyHistoryRef.current.shift();
      }
      const avgFreq = frequencyHistoryRef.current.reduce((a, b) => a + b, 0) / frequencyHistoryRef.current.length;
      setFrequency(Math.round(avgFreq));
      setNote(getNoteFromFrequency(avgFreq));
      if (frequencyHistoryRef.current.length >= 3) {
        const detected = detectChord(frequencyHistoryRef.current);
        if (detected) setChord(detected);
      }
    } else {
      if (currentVolume < 0.02) {
        setNote({ note: "--", cents: 0, octave: 0 });
        setFrequency(0);
        setChord(null);
        frequencyHistoryRef.current = [];
      }
    }
    rafRef.current = requestAnimationFrame(processAudio);
  }, []);
  
  const startListening = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.3;
      sourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);
      setIsListening(true);
      frequencyHistoryRef.current = [];
      processAudio();
    } catch (err) {
      console.error("Audio error:", err);
      setError(err.name === 'NotAllowedError'
        ? 'Доступ к микрофону запрещён'
        : 'Ошибка инициализации аудио');
    }
  };
  
  const stopListening = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
    }
    setIsListening(false);
    setNote({ note: "--", cents: 0, octave: 0 });
    setFrequency(0);
    setVolume(0);
    setChord(null);
    frequencyHistoryRef.current = [];
  };
  
  useEffect(() => {
    return () => {
      if (isListening) stopListening();
    };
  }, []);
  
  useEffect(() => {
    if (USE_MOCK_AUDIO && isListening) {
      const interval = setInterval(() => {
        const mockFreq = 440 * Math.pow(2, (Math.random() - 0.5) * 0.1);
        setFrequency(Math.round(mockFreq));
        setNote(getNoteFromFrequency(mockFreq));
        setVolume(0.1 + Math.random() * 0.1);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isListening]);
  
  const centsDisplay = note.cents !== 0 ? (
    <span style={{ color: note.cents > 50 ? 'var(--danger)' : note.cents < -50 ? 'var(--success)' : 'var(--text-secondary)', marginLeft: '0.5rem' }}>
      {note.cents > 0 ? '+' : ''}{note.cents}¢
    </span>
  ) : null;
  
  return (
    <>
      <div className="tuner-display">
        <div className={`note-large ${note.note === '--' ? 'flat' : ''}`}>
          {note.note}
          <span style={{ fontSize: '0.3em', verticalAlign: 'super', fontWeight: 400 }}>{note.octave}</span>
        </div>
        <div className="freq-info text-mono">
          {frequency > 0 ? `${frequency} Hz` : 'Waiting for signal...'}
          {note.note !== '--' && centsDisplay}
        </div>
        {chord && (
          <div className="chord-badge active">Chord: {chord}</div>
        )}
        {error && (
          <div className="chord-badge" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>
      <SimpleVisualizer analyser={analyserRef.current} isListening={isListening} />
      <div className="controls">
        <button
          className={`btn ${isListening ? 'danger' : 'primary'}`}
          onClick={isListening ? stopListening : startListening}
        >
          {isListening ? <><IconStop /> Stop</> : <><IconMic /> Start</>}
        </button>
      </div>
    </>
  );
};

const SearchView = () => {
  const [status, setStatus] = useState('idle');
  const [trackInfo, setTrackInfo] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  
  const startRecording = async () => {
    if (!API_TOKEN || API_TOKEN === 'YOUR_AUDD_API_TOKEN_HERE') {
      setErrorMessage('Please set your audd.io API token');
      return;
    }
    
    setErrorMessage(null);
    setStatus('recording');
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      mediaRecorderRef.current = new MediaRecorder(stream, { 
        mimeType: 'audio/webm;codecs=opus' 
      });
      chunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await sendToAuddAPI(blob);
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      };
      
      mediaRecorderRef.current.start();
      
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          stopRecording();
        }
      }, 12000);
      
    } catch (err) {
      console.error("Recording error:", err);
      setStatus('error');
      setErrorMessage(err.name === 'NotAllowedError' 
        ? 'Microphone access denied' 
        : 'Failed to start recording');
    }
  };
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setStatus('processing');
    }
  };
  
  const sendToAuddAPI = async (audioBlob) => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('api_token', API_TOKEN);
    formData.append('return', 'apple_music,spotify,youtube');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch('https://api.audd.io/', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('API Response:', data);

      if (data.status === 'success' && data.result && data.result.title) {
        setTrackInfo({
          title: data.result.title,
          artist: data.result.artist,
          album: data.result.album || 'Unknown Album',
          release_date: data.result.release_date,
          cover: data.result.spotify?.album?.images?.[0]?.url 
            || data.result.apple_music?.artwork?.url?.replace('{w}x{h}', '400x400')
            || data.result.cover_artwork_url
            || 'https://via.placeholder.com/400?text=No+Cover',
          spotify: data.result.spotify?.external_urls?.spotify,
          apple_music: data.result.apple_music?.url,
          youtube: data.result.youtube?.link,
        });
        setStatus('found');
      } else if (data.status === 'no_results' || !data.result || !data.result.title) {
        setStatus('error');
        setErrorMessage('Song not found in database');
      } else if (data.error) {
        setStatus('error');
        setErrorMessage(data.error);
      } else {
        setStatus('error');
        setErrorMessage('Unknown error occurred');
      }
    } catch (err) {
      console.error("API error:", err);
      setStatus('error');
      
      if (err.name === 'AbortError') {
        setErrorMessage('Request timeout. Please try again.');
      } else if (err.message.includes('Failed to fetch')) {
        setErrorMessage('Network error. Check your internet connection or API token.');
      } else {
        setErrorMessage('Network error: ' + err.message);
      }
    }
  };
  
  const reset = () => {
    setStatus('idle');
    setTrackInfo(null);
    setErrorMessage(null);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  };
  
  return (
    <div style={{ textAlign: 'center', maxWidth: '480px', width: '100%' }}>
      {status === 'idle' && (
        <>
          <div style={{ marginBottom: '2rem', opacity: 0.7 }}>
            <IconDisc /> 
          </div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Identify Track</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.9rem' }}>
            Hold your device near the music source. Recording starts automatically.
          </p>
          
          {errorMessage && (
            <div className="chord-badge" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '1rem' }}>
              {errorMessage}
            </div>
          )}
          
          <button 
            className="btn primary" 
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={startRecording}
            disabled={!API_TOKEN || API_TOKEN === 'YOUR_AUDD_API_TOKEN_HERE'}
          >
            <IconMic style={{ marginRight: '0.5rem' }} />
            Start Listening
          </button>
          
          {(!API_TOKEN || API_TOKEN === 'YOUR_AUDD_API_TOKEN_HERE') && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1rem' }}>
              ⚠️ Set your API token to enable recognition
            </p>
          )}
        </>
      )}
      
      {status === 'recording' && (
        <>
          <div className="recording-indicator" style={{ fontSize: '3rem', marginBottom: '1rem' }}>●</div>
          <h3 style={{ marginBottom: '0.5rem' }}>Listening...</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
            Keep the microphone near the sound source
          </p>
          <button className="btn danger" onClick={stopRecording}>
            <IconStop style={{ marginRight: '0.5rem' }} />
            Stop Early
          </button>
        </>
      )}
      
      {status === 'processing' && (
        <>
          <div style={{ 
            width: '40px', height: '40px', 
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            margin: '0 auto 2rem',
            animation: 'spin 1s linear infinite'
          }} />
          <p>Searching database...</p>
        </>
      )}
      
      {status === 'found' && trackInfo && (
        <div className="song-card" style={{ textAlign: 'left', padding: '1.5rem' }}>
          <img 
            src={trackInfo.cover} 
            alt={trackInfo.title} 
            style={{ 
              width: '100%', 
              aspectRatio: '1', 
              objectFit: 'cover', 
              borderRadius: '8px', 
              marginBottom: '1.5rem',
              background: '#27272a'
            }} 
            onError={(e) => {
              e.target.src = 'https://via.placeholder.com/400?text=No+Cover';
            }}
          />
          <h3 style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>{trackInfo.title}</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{trackInfo.artist}</p>
          {trackInfo.album && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {trackInfo.album} {trackInfo.release_date && `• ${trackInfo.release_date.split('-')[0]}`}
            </p>
          )}
          
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {trackInfo.spotify && (
              <a 
                href={trackInfo.spotify} 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn" 
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: '#1DB954', color: '#000', border: 'none' }}
              >
                Spotify
              </a>
            )}
            {trackInfo.apple_music && (
              <a 
                href={trackInfo.apple_music} 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn" 
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: '#FA243C', color: '#fff', border: 'none' }}
              >
                Apple Music
              </a>
            )}
            {trackInfo.youtube && (
              <a 
                href={trackInfo.youtube} 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn" 
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: '#FF0000', color: '#fff', border: 'none' }}
              >
                YouTube
              </a>
            )}
          </div>
          
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={reset}>
            Identify Another
          </button>
        </div>
      )}
      
      {status === 'error' && (
        <>
          <div style={{ 
            width: '60px', height: '60px', 
            borderRadius: '50%', 
            background: 'rgba(239, 68, 68, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem'
          }}>
            <IconStop style={{ color: 'var(--danger)' }} />
          </div>
          <h3 style={{ marginBottom: '0.5rem', color: 'var(--danger)' }}>Not Found</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            {errorMessage || 'Could not identify the track'}
          </p>
          <button className="btn" onClick={reset}>Try Again</button>
        </>
      )}
    </div>
  );
};

const GuitarView = () => {
  const [savedSongs, setSavedSongs] = useState(() => {
    try {
      const stored = localStorage.getItem('octave_songs');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [newSongName, setNewSongName] = useState('');
  const [currentChords, setCurrentChords] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [lastDetectedNote, setLastDetectedNote] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const lastDetectedNoteRef = useRef(null);
  const noteStabilityCounterRef = useRef(0);
  const GUITAR_MIN_FREQ = 80;
  const GUITAR_MAX_FREQ = 1200;

  const startRecording = async () => {
    try {
      setDetectionError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 4096;
      analyserRef.current.smoothingTimeConstant = 0.2;
      sourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);
      setIsRecording(true);
      lastDetectedNoteRef.current = null;
      noteStabilityCounterRef.current = 0;
      processGuitarAudio();
    } catch (err) {
      console.error("Guitar audio error:", err);
      setDetectionError(err.name === 'NotAllowedError'
        ? 'Доступ к микрофону запрещён'
        : 'Ошибка аудио');
    }
  };

  const stopRecording = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsRecording(false);
    setLastDetectedNote(null);
  };

  const processGuitarAudio = () => {
    if (!analyserRef.current || !audioCtxRef.current) return;
    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.02) {
      noteStabilityCounterRef.current = 0;
      rafRef.current = requestAnimationFrame(processGuitarAudio);
      return;
    }
    const freq = autoCorrelate(buffer, audioCtxRef.current.sampleRate);
    if (freq !== -1 && freq >= GUITAR_MIN_FREQ && freq <= GUITAR_MAX_FREQ) {
      const { note, cents } = getNoteFromFrequency(freq);
      if (note !== '--' && Math.abs(cents) < 50) {
        if (note === lastDetectedNoteRef.current) {
          noteStabilityCounterRef.current++;
          if (noteStabilityCounterRef.current >= 15) {
            setCurrentChords(prev => {
              if (prev.length === 0 || prev[prev.length - 1] !== note) {
                return [...prev, note];
              }
              return prev;
            });
            noteStabilityCounterRef.current = 0;
          }
        } else {
          lastDetectedNoteRef.current = note;
          noteStabilityCounterRef.current = 0;
          setLastDetectedNote(note);
        }
      }
    }
    rafRef.current = requestAnimationFrame(processGuitarAudio);
  };

  const saveSong = () => {
    if (!newSongName.trim() || currentChords.length === 0) return;
    const song = {
      id: Date.now(),
      name: newSongName.trim(),
      chords: [...currentChords],
      date: new Date().toISOString(),
    };
    try {
      const updated = [...savedSongs, song];
      setSavedSongs(updated);
      localStorage.setItem('octave_songs', JSON.stringify(updated));
      setNewSongName('');
      setCurrentChords([]);
      lastDetectedNoteRef.current = null;
      setLastDetectedNote(null);
    } catch (err) {
      console.error("Save error:", err);
      if (err.name === 'QuotaExceededError') {
        alert('Хранилище переполнено! Удалите старые песни.');
      } else {
        alert('Ошибка сохранения: ' + err.message);
      }
    }
  };

  const deleteSong = (id) => {
    try {
      const updated = savedSongs.filter(s => s.id !== id);
      setSavedSongs(updated);
      localStorage.setItem('octave_songs', JSON.stringify(updated));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const exportSong = (song) => {
    const chordLine = song.chords.map(c => `[${c}]`).join(' ');
    const content = `{title: ${song.name}}
{subtitle: Created with Octave on ${new Date(song.date).toLocaleDateString()}}

{start_of_chorus}
${chordLine}
{end_of_chorus}

# Progression: ${song.chords.join(' → ')}
# Total chords: ${song.chords.length}
`;
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${song.name.replace(/[^a-z0-9а-яё]/gi, '_')}.pro`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      alert('Ошибка экспорта');
    }
  };

  const clearCurrentProgression = () => {
    setCurrentChords([]);
    lastDetectedNoteRef.current = null;
    setLastDetectedNote(null);
    noteStabilityCounterRef.current = 0;
  };

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const groupedChords = [];
  for (let i = 0; i < currentChords.length; i += 10) {
    groupedChords.push(currentChords.slice(i, i + 10));
  }

  return (
    <div style={{ width: '100%', maxWidth: '800px' }}>
      <div className="card-grid" style={{ marginBottom: '2rem', gridTemplateColumns: '1fr' }}>
        <div className="song-card" style={{ padding: '1.5rem' }}>
          <input
            type="text"
            value={newSongName}
            onChange={(e) => setNewSongName(e.target.value)}
            placeholder="Song name..."
            className="input-dark"
            style={{ marginBottom: '1rem' }}
            onKeyDown={(e) => e.key === 'Enter' && saveSong()}
          />
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <button
              className={`btn ${isRecording ? 'danger' : 'primary'}`}
              onClick={isRecording ? stopRecording : startRecording}
            >
              {isRecording ? <><IconStop /> Stop</> : <><IconMic /> Record</>}
            </button>
            <button
              className="btn"
              onClick={saveSong}
              disabled={!newSongName.trim() || currentChords.length === 0}
              style={{
                opacity: !newSongName.trim() || currentChords.length === 0 ? 0.5 : 1,
                cursor: !newSongName.trim() || currentChords.length === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              <IconDownload style={{ marginRight: '0.5rem' }} />
              Save
            </button>
            {currentChords.length > 0 && (
              <button
                className="btn"
                onClick={clearCurrentProgression}
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Clear
              </button>
            )}
          </div>
          {detectionError && (
            <div className="chord-badge" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '1rem' }}>
              {detectionError}
            </div>
          )}
          {isRecording && (
            <div style={{
              padding: '1rem',
              background: 'var(--bg-panel)',
              borderRadius: '6px',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span className="recording-indicator">●</span>
              <span style={{ fontSize: '0.9rem' }}>
                Listening... {lastDetectedNote && lastDetectedNote !== '--' && (
                  <strong style={{ color: 'var(--accent)' }}>{lastDetectedNote}</strong>
                )}
              </span>
            </div>
          )}
          {currentChords.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Current progression ({currentChords.length} chords):
                </p>
                <button
                  onClick={() => navigator.clipboard.writeText(currentChords.join(' '))}
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-secondary)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px'
                  }}
                  onMouseEnter={(e) => e.target.style.background = 'var(--border)'}
                  onMouseLeave={(e) => e.target.style.background = 'none'}
                >
                  Copy
                </button>
              </div>
              <div className="chord-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {groupedChords.map((group, groupIdx) => (
                  <div key={groupIdx} style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {group.map((chord, idx) => (
                      <span
                        key={`${groupIdx}-${idx}`}
                        className="chord-badge active"
                        style={{
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.9rem',
                          animation: 'popIn 0.2s ease-out'
                        }}
                      >
                        {chord}
                      </span>
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
            <button
              onClick={() => {
                if (confirm('Удалить все сохранённые песни?')) {
                  setSavedSongs([]);
                  localStorage.removeItem('octave_songs');
                }
              }}
              style={{
                fontSize: '0.75rem',
                color: 'var(--danger)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.5rem'
              }}
            >
              Clear All
            </button>
          </div>
          <div className="card-grid">
            {savedSongs.slice().reverse().map(song => (
              <div key={song.id} className="song-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                  <h4 style={{ fontWeight: 600, fontSize: '1rem' }}>{song.name}</h4>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      onClick={() => exportSong(song)}
                      className="btn"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      title="Export as ChordPro"
                    >
                      <IconDownload />
                    </button>
                    <button
                      onClick={() => deleteSong(song.id)}
                      className="btn"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      title="Delete"
                    >
                      <IconStop />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {song.chords.slice(0, 12).map((chord, idx) => (
                    <span key={idx} style={{
                      padding: '0.15rem 0.5rem',
                      background: '#27272a',
                      borderRadius: '3px',
                      fontSize: '0.75rem'
                    }}>
                      {chord}
                    </span>
                  ))}
                  {song.chords.length > 12 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      +{song.chords.length - 12}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  {new Date(song.date).toLocaleDateString()} • {song.chords.length} chords
                </p>
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
        <div className="logo">
          <span style={{ fontWeight: 900, fontSize: '1.5rem' }}>OCT</span>
          <span>AVE</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          v1.1.0
        </div>
      </header>
      <main>
        {view === 'tuner' && <TunerView />}
        {view === 'search' && <SearchView />}
        {view === 'guitar' && <GuitarView />}
      </main>
      <nav className="tabs">
        <button className={`tab-btn ${view === 'tuner' ? 'active' : ''}`} onClick={() => setView('tuner')}>
          Tuner
        </button>
        <button className={`tab-btn ${view === 'guitar' ? 'active' : ''}`} onClick={() => setView('guitar')}>
          Chords
        </button>
        <button className={`tab-btn ${view === 'search' ? 'active' : ''}`} onClick={() => setView('search')}>
          Identify
        </button>
      </nav>
    </div>
  );
}

export default App;