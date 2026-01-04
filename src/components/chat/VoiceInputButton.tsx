import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useSettingsStore } from '../../stores/settingsStore';
import { Tooltip } from '../shared/Tooltip';

interface VoiceInputButtonProps {
  onTranscription: (text: string) => void;
}

export function VoiceInputButton({ onTranscription }: VoiceInputButtonProps) {
  const { state, error, startRecording, stopRecording } = useVoiceInput();
  const voiceModel = useSettingsStore((s) => s.voiceModel);
  const voiceMode = useSettingsStore((s) => s.voiceMode);

  // Hide if voice input is disabled or no voice model available
  if (voiceMode === 'none') return null;
  if (voiceModel === 'none') return null;

  const isRecording = state === 'recording';
  const isTranscribing = state === 'transcribing';

  const handleClick = async () => {
    if (isRecording) {
      // Stop recording and transcribe using the appropriate model
      const transcript = await stopRecording(voiceModel);
      if (transcript) {
        onTranscription(transcript);
      }
    } else if (!isTranscribing) {
      startRecording();
    }
  };

  const tooltipContent = isTranscribing
    ? 'Transcribing...'
    : isRecording
      ? 'Click to stop and transcribe'
      : error
        ? `Voice input (Error: ${error})`
        : 'Voice input';

  return (
    <Tooltip content={tooltipContent}>
      <button
        onClick={handleClick}
        disabled={isTranscribing}
        className={`
          p-2 rounded transition-colors relative
          ${
            isRecording
              ? 'text-green-600 bg-green-50 hover:bg-green-100 dark:text-green-400 dark:bg-green-900/50 dark:hover:bg-green-900/70'
              : isTranscribing
                ? 'text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/50'
                : error
                  ? 'text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/30'
                  : 'text-stone-500 hover:text-green-600 hover:bg-green-50 dark:text-gray-400 dark:hover:text-green-400 dark:hover:bg-green-900/30'
          }
          ${isTranscribing ? 'opacity-70 cursor-wait' : ''}
        `}
        aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
      >
        {/* Breathing glow animation when recording */}
        {/* Light mode: darker green glow, Dark mode: lighter green glow */}
        {isRecording && (
          <>
            <span className="absolute inset-0 rounded animate-recording-glow-light bg-green-600/30 dark:hidden" />
            <span className="absolute inset-0 rounded hidden dark:block animate-recording-glow-dark bg-green-500/40" />
          </>
        )}

        {/* Spinning animation when transcribing */}
        {isTranscribing && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
          </span>
        )}

        {/* Microphone icon */}
        <svg
          className={`w-5 h-5 relative z-10 ${isTranscribing ? 'opacity-30' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
      </button>
    </Tooltip>
  );
}
