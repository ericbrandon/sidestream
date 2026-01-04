import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VoiceModel } from '../lib/types';

export type VoiceInputState = 'idle' | 'recording' | 'transcribing' | 'error';

interface UseVoiceInputReturn {
  state: VoiceInputState;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: (voiceModel: VoiceModel) => Promise<string | null>;
  cancelRecording: () => Promise<void>;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [error, setError] = useState<string | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setState('recording');

      // Call Rust backend to start recording via cpal
      await invoke('start_audio_recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, []);

  const stopRecording = useCallback(async (voiceModel: VoiceModel): Promise<string | null> => {
    try {
      setState('transcribing');

      let transcript: string;

      if (voiceModel === 'openai') {
        // OpenAI Whisper: stop recording and transcribe in one call
        transcript = await invoke<string>('stop_audio_recording');
      } else if (voiceModel === 'gemini') {
        // Gemini: get raw audio, then transcribe separately
        const audioBase64 = await invoke<string>('stop_audio_recording_raw');
        transcript = await invoke<string>('transcribe_audio_gemini', { audioBase64 });
      } else {
        throw new Error('No voice model available');
      }

      setState('idle');
      return transcript;
    } catch (err) {
      console.error('Transcription error:', err);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
      return null;
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    try {
      await invoke('cancel_audio_recording');
      setState('idle');
      setError(null);
    } catch (err) {
      console.error('Failed to cancel recording:', err);
      // Still reset state even on error
      setState('idle');
    }
  }, []);

  return {
    state,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
