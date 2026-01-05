import { useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { Tooltip } from '../shared/Tooltip';

export function AttachmentButton() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addAttachment } = useChatStore();

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        const isImage = file.type.startsWith('image/');

        addAttachment({
          type: isImage ? 'image' : 'document',
          name: file.name,
          mimeType: file.type,
          data: base64,
          preview: isImage ? (reader.result as string) : undefined,
        });
      };
      reader.readAsDataURL(file);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        // Allow all file types - let the LLM handle what it can
        className="hidden"
        onChange={handleFileChange}
      />
      <Tooltip content="Attach file">
        <button
          onClick={handleClick}
          className="p-2 text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:text-gray-400 dark:hover:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors"
          aria-label="Attach file"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>
      </Tooltip>
    </>
  );
}
