import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidProps {
  chart: string;
  theme: 'dark' | 'light';
}

//******************************************************************************
// Mermaid
//******************************************************************************
export const Mermaid: React.FC<MermaidProps> = ({ chart, theme }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    // Re-initialize mermaid with the correct theme
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
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
  }, [chart, theme]);

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
