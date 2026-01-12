import { useMemo, useRef, memo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { InlineCitation as InlineCitationType } from '../../lib/types';
import { InlineCitation } from './InlineCitation';
import { CITATION_MARKER_REGEX, insertCitationMarkers, extractChatGPTCitations, stripSandboxUrls, stripAnthropicFileUrls, stripGeminiLocalFileRefs } from './citationUtils';
import { useSettingsStore } from '../../stores/settingsStore';


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

/**
 * Render text with inline citations.
 */
function renderTextWithCitations(
  text: string,
  citationMap: Map<number, InlineCitationType>,
  stableKeyMap: Map<string, number>
): React.ReactNode {
  if (citationMap.size === 0 || !CITATION_MARKER_REGEX.test(text)) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  CITATION_MARKER_REGEX.lastIndex = 0;

  while ((match = CITATION_MARKER_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const citationIndex = parseInt(match[1], 10);
    const citation = citationMap.get(citationIndex);
    if (citation) {
      // Use stable key based on URL to prevent re-mounting during streaming
      const stableKey = stableKeyMap.get(citation.url) ?? citationIndex;
      parts.push(<InlineCitation key={`cite-url-${stableKey}`} citation={citation} />);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * Create markdown components that handle inline citations
 */
function createMarkdownComponents(
  citationMap: Map<number, InlineCitationType>,
  stableKeyMap: Map<string, number>
): Components {
  const processChildren = (children: React.ReactNode): React.ReactNode => {
    if (typeof children === 'string') {
      return renderTextWithCitations(children, citationMap, stableKeyMap);
    }
    if (Array.isArray(children)) {
      return children.map((child, i) =>
        typeof child === 'string' ? (
          <span key={i}>{renderTextWithCitations(child, citationMap, stableKeyMap)}</span>
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
            openUrl(href);
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

interface StreamingMessageProps {
  content: string;
  inlineCitations?: InlineCitationType[];
}

/**
 * Cached markdown renderer for completed content.
 * This only re-renders when the completed content changes (grows),
 * which happens much less frequently than every delta.
 */
const CachedMarkdown = memo(function CachedMarkdown({
  content,
  inlineCitations,
  showCitations,
  citationKeyMapRef,
}: {
  content: string;
  inlineCitations: InlineCitationType[];
  showCitations: boolean;
  citationKeyMapRef: React.MutableRefObject<Map<string, number>>;
}) {
  const { processedContent, markdownComponents } = useMemo(() => {
    if (!content) return { processedContent: '', markdownComponents: {} as Components };

    // First, strip OpenAI sandbox: URLs (files are shown via GeneratedFileCard)
    let strippedContent = stripSandboxUrls(content);
    // Strip Anthropic /files/output/ URLs (files are shown via GeneratedImageCard/GeneratedFileCard)
    strippedContent = stripAnthropicFileUrls(strippedContent);
    // Also strip Gemini local file references (files are shown via GeneratedImageCard/GeneratedFileCard)
    strippedContent = stripGeminiLocalFileRefs(strippedContent);

    // Then extract ChatGPT-style parenthesized citations from content
    const { content: contentWithoutChatGPTCitations, citations: chatGPTCitations } =
      extractChatGPTCitations(strippedContent, showCitations);

    // Get existing inline citations (from Claude/Gemini)
    const existingCitations = showCitations ? inlineCitations : [];

    // Build stable keys for citations based on URL
    const keyMap = citationKeyMapRef.current;
    [...existingCitations, ...chatGPTCitations].forEach((citation) => {
      if (!keyMap.has(citation.url)) {
        keyMap.set(citation.url, keyMap.size);
      }
    });

    // Insert citation markers for position-based citations
    const { content: processed, citationMap } = insertCitationMarkers(
      contentWithoutChatGPTCitations,
      existingCitations,
      { waitForNewline: true }
    );

    // Add ChatGPT citations to the map
    chatGPTCitations.forEach((citation, idx) => {
      citationMap.set(existingCitations.length + idx, citation);
    });

    const components = createMarkdownComponents(citationMap, keyMap);
    return { processedContent: processed, markdownComponents: components };
  }, [content, inlineCitations, showCitations, citationKeyMapRef]);

  if (!content) return null;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {processedContent}
    </ReactMarkdown>
  );
});


export function StreamingMessage({ content, inlineCitations = [] }: StreamingMessageProps) {
  // Use ref to maintain stable citation map across renders
  const citationKeyMapRef = useRef<Map<string, number>>(new Map());
  const showCitations = useSettingsStore((state) => state.showCitations);

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[85%] p-4">
        <div className="prose prose-sm max-w-none prose-gray dark:prose-invert font-scalable">
          {/* Render all content as markdown - memoization handles caching */}
          <CachedMarkdown
            content={content}
            inlineCitations={inlineCitations}
            showCitations={showCitations}
            citationKeyMapRef={citationKeyMapRef}
          />
        </div>
        {/* Streaming indicator */}
        <div className="flex items-center gap-1 mt-2">
          <div className="w-2 h-2 bg-stone-400 rounded-full animate-pulse" />
          <div
            className="w-2 h-2 bg-stone-400 rounded-full animate-pulse"
            style={{ animationDelay: '0.2s' }}
          />
          <div
            className="w-2 h-2 bg-stone-400 rounded-full animate-pulse"
            style={{ animationDelay: '0.4s' }}
          />
        </div>
      </div>
    </div>
  );
}
