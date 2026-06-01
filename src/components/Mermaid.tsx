import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

/** Props for the {@link Mermaid} diagram renderer. */
export interface MermaidProps {
  /** Mermaid diagram definition string (e.g. a `graph TD` or `sequenceDiagram` block). */
  chart: string;
  /** Colour scheme passed to Mermaid's initializer (`'dark'` → Mermaid dark theme, `'light'` → default). */
  theme: 'dark' | 'light';
  /**
   * Raw JS-object-literal or JSON string from the Default-Mermaid-Init setting.
   * Applied as the global mermaid init for diagrams that contain no `%%{init:...}%%` block.
   * Charts with an inline `%%{init:...}%%` override this automatically.
   */
  mermaidInit?: string;
}

//******************************************************************************
// parseMermaidInit
// Accepts JSON or JS-object-literal syntax (single-quoted keys/values).
// Returns an empty object on parse failure so rendering still proceeds.
//******************************************************************************
function parseMermaidInit(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    try {
      // Fall back to JS object-literal syntax (e.g. single-quoted keys)
      // eslint-disable-next-line no-new-func
      return new Function('return (' + trimmed + ')')() as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
// parseMermaidInit END *********************************************************

//******************************************************************************
// Mermaid
//******************************************************************************
export const Mermaid: React.FC<MermaidProps> = ({ chart, theme, mermaidInit }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    // Re-initialize mermaid. The base config sets startOnLoad/securityLevel and
    // a theme derived from the app theme. The user's Default-Mermaid-Init is spread
    // on top, so it overrides theme/themeVariables for diagrams that contain no
    // %%{init:...}%% block (charts with an inline init override this automatically).
    const userInit = parseMermaidInit(mermaidInit ?? '');
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
      ...userInit,
    });

    const renderChart = async () => {
      if (containerRef.current && chart) {
        try {
          const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await mermaid.render(id, chart);
          setSvg(svg);
        } catch (error) {
          console.error('Mermaid rendering failed:', error);
          setSvg(`<pre class="error">Failed to render diagram:\n\n${error instanceof Error ? error.message : String(error)}</pre>`);
        }
      }
    };

    renderChart();
  }, [chart, theme, mermaidInit]);

  return (
    <div
      ref={containerRef}
      className="mermaid"
      style={{ display: 'flex', justifyContent: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
// Mermaid END *****************************************************************
