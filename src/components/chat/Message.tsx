import { useState, useMemo, memo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import type { Message as MessageType, InlineCitation as InlineCitationType, GeneratedFile } from '../../lib/types';
import { isImageFile } from '../../lib/types';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import { InlineCitation } from './InlineCitation';
import { ThinkingBadge } from './ThinkingBadge';
import { ExecutionBadge } from './ExecutionBadge';
import { GeneratedFileCard } from './GeneratedFileCard';
import { GeneratedImageCard } from './GeneratedImageCard';
import { ImageLightbox } from './ImageLightbox';
import { CITATION_MARKER_REGEX, insertCitationMarkers, extractChatGPTCitations, stripSandboxUrls, stripGeminiLocalFileRefs, isSandboxUrl, extractSandboxFilename } from './citationUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';

/**
 * Render text with inline citations.
 * Parses citation markers and replaces them with InlineCitation components.
 */
function renderTextWithCitations(
  text: string,
  citationMap: Map<number, InlineCitationType>
): React.ReactNode {
  if (citationMap.size === 0 || !CITATION_MARKER_REGEX.test(text)) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  // Reset regex lastIndex
  CITATION_MARKER_REGEX.lastIndex = 0;

  while ((match = CITATION_MARKER_REGEX.exec(text)) !== null) {
    // Add text before the marker
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    // Add the citation component
    const citationIndex = parseInt(match[1], 10);
    const citation = citationMap.get(citationIndex);
    if (citation) {
      parts.push(<InlineCitation key={`cite-${citationIndex}`} citation={citation} />);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * Handle clicks on sandbox: URLs - download the file via OpenAI container API
 */
async function handleSandboxUrlClick(href: string): Promise<void> {
  const filename = extractSandboxFilename(href);
  if (!filename) {
    console.error('Could not extract filename from sandbox URL:', href);
    return;
  }

  const containerId = useChatStore.getState().openaiContainerId;
  if (!containerId) {
    console.error('No OpenAI container ID available for sandbox file download');
    return;
  }

  try {
    const result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
      'download_openai_file_by_name',
      { containerId, filename }
    );

    const savePath = await save({
      defaultPath: result.filename,
      title: 'Save File',
    });

    if (savePath) {
      await writeFile(savePath, new Uint8Array(result.data));
    }
  } catch (err) {
    console.error('Failed to download sandbox file:', err);
  }
}

/**
 * Map language identifiers to file extensions
 */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  csharp: 'cs',
  cpp: 'cpp',
  c: 'c',
  java: 'java',
  go: 'go',
  swift: 'swift',
  kotlin: 'kt',
  scala: 'scala',
  php: 'php',
  perl: 'pl',
  r: 'r',
  julia: 'jl',
  lua: 'lua',
  shell: 'sh',
  bash: 'sh',
  zsh: 'sh',
  powershell: 'ps1',
  sql: 'sql',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  xml: 'xml',
  markdown: 'md',
  md: 'md',
  toml: 'toml',
  ini: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmake: 'cmake',
  gradle: 'gradle',
  groovy: 'groovy',
  haskell: 'hs',
  elixir: 'ex',
  erlang: 'erl',
  clojure: 'clj',
  fsharp: 'fs',
  ocaml: 'ml',
  elm: 'elm',
  vue: 'vue',
  svelte: 'svelte',
  jsx: 'jsx',
  tsx: 'tsx',
};

/**
 * Code block component with copy and download icons
 */
function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const codeContent = String(children).replace(/\n$/, '');
  const language = className?.replace('language-', '') || '';

  const handleCopy = async () => {
    await writeText(codeContent);
  };

  const handleDownload = async () => {
    const extension = LANGUAGE_EXTENSIONS[language.toLowerCase()] || language || 'txt';
    const savePath = await save({
      defaultPath: `code.${extension}`,
      title: 'Save Code',
    });
    if (savePath) {
      await writeFile(savePath, new TextEncoder().encode(codeContent));
    }
  };

  return (
    <div className="relative group">
      <pre className={className}>
        <code className={className}>{children}</code>
      </pre>
      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded bg-white/10 hover:bg-white/20 transition-colors text-stone-400 hover:text-stone-200"
          title="Copy code"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 rounded bg-white/10 hover:bg-white/20 transition-colors text-stone-400 hover:text-stone-200"
          title="Download code"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function createMarkdownComponents(
  citationMap: Map<number, InlineCitationType>
): Components {
  // Helper to process children and render citations
  const processChildren = (children: React.ReactNode): React.ReactNode => {
    if (typeof children === 'string') {
      return renderTextWithCitations(children, citationMap);
    }
    if (Array.isArray(children)) {
      return children.map((child, i) =>
        typeof child === 'string' ? (
          <span key={i}>{renderTextWithCitations(child, citationMap)}</span>
        ) : (
          child
        )
      );
    }
    return children;
  };

  return {
    h1: ({ children }) => <h2>{processChildren(children)}</h2>,
    h2: ({ children }) => <h3>{processChildren(children)}</h3>,
    h3: ({ children }) => <h4>{processChildren(children)}</h4>,
    h4: ({ children }) => <h5>{processChildren(children)}</h5>,
    h5: ({ children }) => <h6>{processChildren(children)}</h6>,
    h6: ({ children }) => <h6>{processChildren(children)}</h6>,
    p: ({ children }) => <p>{processChildren(children)}</p>,
    li: ({ children }) => <li>{processChildren(children)}</li>,
    strong: ({ children }) => <strong>{processChildren(children)}</strong>,
    em: ({ children }) => <em>{processChildren(children)}</em>,
    // Table cells need citation processing too
    td: ({ children }) => <td>{processChildren(children)}</td>,
    th: ({ children }) => <th>{processChildren(children)}</th>,
    hr: () => <hr className="my-4 border-gray-300 dark:border-gray-600" />,
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) {
            // Check if this is a sandbox: URL (OpenAI code interpreter file)
            if (isSandboxUrl(href)) {
              handleSandboxUrlClick(href);
            } else {
              openUrl(href);
            }
          }
        }}
        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer"
      >
        {processChildren(children)}
      </a>
    ),
    // Code blocks with copy and download icons
    pre: ({ children }) => {
      // Extract code content and className from the code element
      const codeChild = children as React.ReactElement<{ children: React.ReactNode; className?: string }>;
      if (codeChild?.props) {
        return <CodeBlock className={codeChild.props.className}>{codeChild.props.children}</CodeBlock>;
      }
      return <pre>{children}</pre>;
    },
  };
}

interface MessageProps {
  message: MessageType;
  onFork?: (messageId: string) => void;
}

export const Message = memo(function Message({ message, onFork }: MessageProps) {
  const isUser = message.role === 'user';
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ file: GeneratedFile; imageData: string } | null>(null);
  const showCitations = useSettingsStore((state) => state.showCitations);

  // Process content with inline citations
  const { processedContent, markdownComponents } = useMemo(() => {
    // First, strip OpenAI sandbox: URLs (files are shown via GeneratedFileCard)
    let strippedContent = stripSandboxUrls(message.content);
    // Also strip Gemini local file references (files are shown via GeneratedImageCard/GeneratedFileCard)
    strippedContent = stripGeminiLocalFileRefs(strippedContent);

    // Then extract ChatGPT-style parenthesized citations from content
    const { content: contentWithoutChatGPTCitations, citations: chatGPTCitations } =
      extractChatGPTCitations(strippedContent, showCitations);

    // Get existing inline citations (from Claude/Gemini)
    const existingCitations = showCitations ? (message.inlineCitations || []) : [];

    // Insert citation markers for position-based citations
    const { content: processedContent, citationMap } = insertCitationMarkers(
      contentWithoutChatGPTCitations,
      existingCitations
    );

    // Add ChatGPT citations to the map (they already have markers from extractChatGPTCitations)
    chatGPTCitations.forEach((citation, idx) => {
      citationMap.set(existingCitations.length + idx, citation);
    });

    const markdownComponents = createMarkdownComponents(citationMap);
    return { processedContent, markdownComponents };
  }, [message.content, message.inlineCitations, showCitations]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    const menuItems: ContextMenuItem[] = [];

    if (selectedText) {
      menuItems.push(
        {
          label: 'Copy',
          onClick: () => writeText(selectedText)
        },
        {
          label: 'Search Google',
          onClick: () => openUrl(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`)
        }
      );
    }

    if (isUser && onFork) {
      menuItems.push({ label: 'Fork from here', onClick: () => onFork(message.id) });
    }

    if (menuItems.length > 0) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`
          max-w-[85%] p-4
          ${isUser ? 'bg-amber-100 dark:bg-[#4a2518] rounded-2xl' : ''}
        `}
        onContextMenu={handleContextMenu}
      >
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {message.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="bg-black/20 rounded p-1"
              >
                {attachment.type === 'image' && attachment.preview ? (
                  <img
                    src={attachment.preview}
                    alt={attachment.name}
                    className="max-w-32 max-h-32 rounded"
                  />
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 text-sm">
                    <span>📎</span>
                    <span className="truncate max-w-24">{attachment.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Included discovery info */}
        {message.includedDiscovery && (
          <div className="bg-purple-600/30 rounded p-2 mb-2 text-sm border border-purple-500/50">
            <div className="flex items-center gap-1">
              <span className="font-medium">
                {message.includedDiscovery.title}
              </span>
            </div>
          </div>
        )}

        {/* Thinking badge for assistant messages with thinking content */}
        {!isUser && message.thinkingContent && (
          <ThinkingBadge
            content={message.thinkingContent}
            durationMs={message.thinkingDurationMs}
          />
        )}

        {/* Message content - split at execution position if present */}
        {(() => {
          // If we have execution info with a position, split the content
          const hasExecution = !isUser && message.executionCode;
          const execPos = message.executionTextPosition;

          // Find the split point: next newline after exec position (paragraph break)
          let splitPoint: number | null = null;
          if (hasExecution && execPos != null && execPos < processedContent.length) {
            // Look for next double newline (paragraph break) after the position
            const searchFrom = execPos;
            const nextBreak = processedContent.indexOf('\n\n', searchFrom);
            if (nextBreak !== -1) {
              splitPoint = nextBreak;
            }
          }

          const downloadFile = async (f: GeneratedFile) => {
            try {
              let result: { data: number[]; filename: string; mime_type?: string };

              // If inline_data is available (persisted), use it directly
              if (f.inline_data) {
                const binary = atob(f.inline_data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
                }
                result = {
                  data: Array.from(bytes),
                  filename: f.filename,
                  mime_type: f.mime_type,
                };
              } else {
                // Fallback to API download if inline_data not available (legacy data)
                const currentModel = useSettingsStore.getState().frontierLLM.model;
                const isOpenAI = currentModel.startsWith('gpt') || currentModel.startsWith('o3') || currentModel.startsWith('o4');

                if (isOpenAI) {
                  // OpenAI requires container_id for file downloads
                  const containerId = useChatStore.getState().openaiContainerId;
                  if (!containerId) {
                    throw new Error('No OpenAI container ID available for file download');
                  }
                  // Check if file_id is a sandbox placeholder (needs resolution by name)
                  if (f.file_id.startsWith('sandbox:')) {
                    result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
                      'download_openai_file_by_name',
                      { containerId, filename: f.filename }
                    );
                  } else {
                    result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
                      'download_openai_file',
                      { containerId, fileId: f.file_id, filename: f.filename }
                    );
                  }
                } else {
                  // Anthropic download
                  result = await invoke<{ data: number[]; filename: string; mime_type?: string }>(
                    'download_anthropic_file',
                    { fileId: f.file_id, filename: f.filename }
                  );
                }
              }

              const savePath = await save({
                defaultPath: result.filename,
                title: 'Save Generated File',
              });
              if (savePath) {
                await writeFile(savePath, new Uint8Array(result.data));
              }
            } catch (err) {
              console.error('Failed to download file:', err);
            }
          };

          // Execution badge (inline at split point)
          const executionBadge = hasExecution && (
            <div className="mt-3">
              <ExecutionBadge
                code={message.executionCode}
                output={message.executionOutput}
                durationMs={message.executionDurationMs}
                status={message.executionStatus}
                error={message.executionError}
              />
            </div>
          );

          // Separate image files from other files
          const imageFiles = message.generatedFiles?.filter(isImageFile) || [];
          const otherFiles = message.generatedFiles?.filter(f => !isImageFile(f)) || [];

          // Handler for expanding images in lightbox
          const handleImageExpand = (file: GeneratedFile, imageData: string) => {
            setLightboxImage({ file, imageData });
          };

          // Generated images section (displayed inline with preview)
          // Each image takes full width of the message container
          const generatedImagesSection = imageFiles.length > 0 && (
            <div className="mt-4 flex flex-col gap-4">
              {imageFiles.map((file) => (
                <GeneratedImageCard
                  key={file.file_id}
                  file={file}
                  messageId={message.id}
                  onExpand={handleImageExpand}
                />
              ))}
            </div>
          );

          // Generated files section (non-image files with download cards)
          const generatedFilesSection = otherFiles.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {otherFiles.map((file) => (
                <GeneratedFileCard
                  key={file.file_id}
                  file={file}
                  onDownload={downloadFile}
                />
              ))}
            </div>
          );

          if (splitPoint !== null) {
            // Split content and insert execution badge in the middle, files at bottom
            const beforeExec = processedContent.slice(0, splitPoint);
            const afterExec = processedContent.slice(splitPoint).trim();

            return (
              <>
                <div className="prose prose-sm max-w-none prose-gray dark:prose-invert font-scalable">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={markdownComponents}
                  >
                    {beforeExec}
                  </ReactMarkdown>
                </div>
                {executionBadge}
                {afterExec && (
                  <div className="prose prose-sm max-w-none prose-gray dark:prose-invert font-scalable mt-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={markdownComponents}
                    >
                      {afterExec}
                    </ReactMarkdown>
                  </div>
                )}
                {generatedImagesSection}
                {generatedFilesSection}
              </>
            );
          }

          // No split - render normally with execution at end
          return (
            <>
              <div className="prose prose-sm max-w-none prose-gray dark:prose-invert font-scalable">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                >
                  {processedContent}
                </ReactMarkdown>
              </div>
              {executionBadge}
              {generatedImagesSection}
              {generatedFilesSection}
            </>
          );
        })()}
      </div>

      {/* Context menu for copy/search/fork actions */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Image lightbox for fullscreen viewing */}
      {lightboxImage && (
        <ImageLightbox
          file={lightboxImage.file}
          imageData={lightboxImage.imageData}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
});
