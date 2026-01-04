import { useChatStore } from '../../stores/chatStore';
import type { Attachment } from '../../lib/types';

interface AttachmentPreviewProps {
  attachment: Attachment;
}

export function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
  const { removeAttachment } = useChatStore();

  return (
    <div className="relative group">
      {attachment.type === 'image' && attachment.preview ? (
        <img
          src={attachment.preview}
          alt={attachment.name}
          className="w-16 h-16 object-cover rounded border border-stone-300"
        />
      ) : (
        <div className="w-16 h-16 bg-stone-100 rounded border border-stone-300 flex items-center justify-center">
          <span className="text-2xl">📄</span>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={() => removeAttachment(attachment.id)}
        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Remove attachment"
      >
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      {/* Name tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-stone-800 text-white rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {attachment.name}
      </div>
    </div>
  );
}
