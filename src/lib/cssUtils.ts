/**
 * Extracts only the CSS rules that are actually used by an element and its descendants.
 * This dramatically reduces the size of exported HTML files by excluding unused Tailwind classes.
 */

/**
 * Recursively collects all class names from an element and its descendants
 */
function collectClassNames(element: Element): Set<string> {
  const classes = new Set<string>();

  // Add classes from this element
  element.classList.forEach((cls) => classes.add(cls));

  // Recursively collect from children
  for (const child of element.children) {
    collectClassNames(child).forEach((cls) => classes.add(cls));
  }

  return classes;
}

/**
 * Collects all element tag names used in the DOM tree
 */
function collectTagNames(element: Element): Set<string> {
  const tags = new Set<string>();

  tags.add(element.tagName.toLowerCase());

  for (const child of element.children) {
    collectTagNames(child).forEach((tag) => tags.add(tag));
  }

  return tags;
}

/**
 * Checks if a CSS selector might match any of the used classes or tags.
 * This is a conservative check - it may include some unused rules but won't exclude needed ones.
 */
function selectorMightBeUsed(
  selector: string,
  usedClasses: Set<string>,
  usedTags: Set<string>
): boolean {
  // Always include these essential selectors
  const alwaysInclude = [
    // Reset/base styles
    '*',
    '::before',
    '::after',
    '::backdrop',
    ':root',
    ':host',
    'html',
    'body',
    // Common pseudo-elements
    '::placeholder',
    '::-webkit',
    // Print styles
    '@media print',
    '@page',
  ];

  if (alwaysInclude.some((pattern) => selector.includes(pattern))) {
    return true;
  }

  // Check if selector contains any used class
  for (const cls of usedClasses) {
    // Match .classname with word boundaries (not just substring)
    const classPattern = new RegExp(`\\.${escapeRegex(cls)}(?![\\w-])`);
    if (classPattern.test(selector)) {
      return true;
    }
  }

  // Check if selector contains any used tag name
  for (const tag of usedTags) {
    // Match tag names at word boundaries
    const tagPattern = new RegExp(`(?:^|[\\s,>+~])${tag}(?:[\\s,>+~:.[#]|$)`, 'i');
    if (tagPattern.test(selector)) {
      return true;
    }
  }

  return false;
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the selector from a CSS rule text
 */
function extractSelector(ruleText: string): string | null {
  // Handle @-rules
  if (ruleText.startsWith('@')) {
    return ruleText;
  }

  // Extract selector before the opening brace
  const braceIndex = ruleText.indexOf('{');
  if (braceIndex === -1) return null;

  return ruleText.substring(0, braceIndex).trim();
}

/**
 * Processes a CSS rule and returns it if it's potentially used
 */
function processRule(
  rule: CSSRule,
  usedClasses: Set<string>,
  usedTags: Set<string>
): string | null {
  // Handle @layer rules - always include the structure
  if (rule instanceof CSSLayerBlockRule) {
    const innerRules: string[] = [];
    for (const innerRule of rule.cssRules) {
      const processed = processRule(innerRule, usedClasses, usedTags);
      if (processed) {
        innerRules.push(processed);
      }
    }
    if (innerRules.length > 0) {
      return `@layer ${rule.name} { ${innerRules.join('\n')} }`;
    }
    return null;
  }

  // Handle @media rules
  if (rule instanceof CSSMediaRule) {
    const innerRules: string[] = [];
    for (const innerRule of rule.cssRules) {
      const processed = processRule(innerRule, usedClasses, usedTags);
      if (processed) {
        innerRules.push(processed);
      }
    }
    if (innerRules.length > 0) {
      return `@media ${rule.conditionText} { ${innerRules.join('\n')} }`;
    }
    return null;
  }

  // Handle @supports rules
  if (rule instanceof CSSSupportsRule) {
    const innerRules: string[] = [];
    for (const innerRule of rule.cssRules) {
      const processed = processRule(innerRule, usedClasses, usedTags);
      if (processed) {
        innerRules.push(processed);
      }
    }
    if (innerRules.length > 0) {
      return `@supports ${rule.conditionText} { ${innerRules.join('\n')} }`;
    }
    return null;
  }

  // Handle @keyframes - include if animation name is used
  if (rule instanceof CSSKeyframesRule) {
    // Check if any class might reference this animation
    const animName = rule.name;
    for (const cls of usedClasses) {
      if (cls.includes('animate')) {
        return rule.cssText;
      }
    }
    // Also include common animation names
    if (['spin', 'pulse', 'shimmer'].includes(animName)) {
      return rule.cssText;
    }
    return null;
  }

  // Handle @property rules - include all for CSS custom properties support
  if (rule.cssText.startsWith('@property')) {
    return rule.cssText;
  }

  // Handle @font-face rules
  if (rule instanceof CSSFontFaceRule) {
    return rule.cssText;
  }

  // Handle regular style rules
  if (rule instanceof CSSStyleRule) {
    const selector = rule.selectorText;
    if (selectorMightBeUsed(selector, usedClasses, usedTags)) {
      return rule.cssText;
    }
    return null;
  }

  // For any other rule types, check the text
  const ruleText = rule.cssText;
  const selector = extractSelector(ruleText);

  if (selector && selectorMightBeUsed(selector, usedClasses, usedTags)) {
    return ruleText;
  }

  return null;
}

/**
 * Extracts only the CSS rules that are used by the given element.
 * Returns a string of CSS that can be embedded in an exported HTML file.
 */
export function extractUsedCSS(element: Element): string {
  const usedClasses = collectClassNames(element);
  const usedTags = collectTagNames(element);

  // Add some classes that might be referenced in CSS but not directly on elements
  // (e.g., parent selectors, state selectors)
  usedClasses.add('not-prose');
  usedClasses.add('group');

  const usedRules: string[] = [];

  // Process all stylesheets
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const processed = processRule(rule, usedClasses, usedTags);
        if (processed) {
          usedRules.push(processed);
        }
      }
    } catch {
      // Skip stylesheets that can't be accessed (CORS)
      continue;
    }
  }

  return usedRules.join('\n');
}

/**
 * Returns a minimal set of base styles for the export.
 * These are essential styles that should always be included.
 */
export function getBaseExportStyles(): string {
  return `
    html, body {
      height: auto;
      overflow: auto;
    }
    body {
      background: white;
      padding: 20px;
      font-family: Georgia, 'Times New Roman', serif;
      line-height: 1.5;
      color: #1f2937;
    }
    .printable-chat-wrapper { display: block !important; }
    .printable-chat { display: block !important; }
    * { box-sizing: border-box; }
    img, video { max-width: 100%; height: auto; }
    /* Citation lozenge styles for export */
    .inline-citation-lozenge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      margin: 0 2px;
      font-size: 11px;
      font-weight: normal;
      border-radius: 9999px;
      background-color: #e5e7eb;
      color: #6b7280;
      text-decoration: none;
      transition: background-color 0.15s, color 0.15s;
    }
    .inline-citation-lozenge:hover {
      background-color: #d1d5db;
      color: #4b5563;
    }
  `;
}
