import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { rasterizeSvg, svgIntrinsicSize } from '../lib/svg-raster';
import { DIAGRAM_PNG_ATTR } from '../lib/preview-copy';
import { PREVIEW_THEME_COLORS } from '../lib/preview-theme';

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
  /**
   * When true, the copy of this diagram kept for the clipboard is rendered
   * light-on-white whatever `theme` says (REQ-LTTCE-MRC-00005). What is on
   * screen is unaffected either way.
   */
  copyLight?: boolean;
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
// renderLightCopy
//******************************************************************************
/**
 * IMPL-LTTCE-MRC-00003 — render `chart` a second time, off-screen, in light
 * colours, for the clipboard copy (REQ-LTTCE-MRC-00005). Returns the detached
 * `<svg>`, or `null` if it could not be produced.
 *
 * The light theme is requested with an `%%{init:…}%%` directive prepended to
 * the diagram source rather than through `mermaid.initialize`. `initialize` is
 * global: several diagrams render concurrently, and flipping the theme under
 * them mid-flight would repaint the wrong ones. A directive is scoped to the
 * one render.
 *
 * Precedence, loosest to tightest:
 *   1. `theme: 'default'` — our light default,
 *   2. the user's Default-Mermaid-Init, which keeps their fonts and colours
 *      and may name a theme of its own,
 *   3. an `%%{init:…}%%` written into the diagram itself, which Mermaid
 *      applies last and therefore always wins.
 *
 * That order means a user who has deliberately chosen a theme keeps it; the
 * setting only decides the background and supplies a light default for
 * diagrams that never expressed a preference.
 */
async function renderLightCopy(chart: string, mermaidInit?: string): Promise<SVGSVGElement | null> {
  try {
    const init = { theme: 'default', ...parseMermaidInit(mermaidInit ?? '') };
    const directive = `%%{init: ${JSON.stringify(init)}}%%\n`;
    const id = `mermaid-copy-${Math.random().toString(36).slice(2, 11)}`;
    const { svg } = await mermaid.render(id, directive + chart);

    const holder = document.createElement('div');
    holder.innerHTML = svg;
    return holder.querySelector('svg');
  } catch (error) {
    // Benign: the caller falls back to rasterising what is on screen.
    console.error('Light copy render failed:', error);
    return null;
  }
} // renderLightCopy END *******************************************************


//******************************************************************************
// Mermaid
//******************************************************************************
export const Mermaid: React.FC<MermaidProps> = ({ chart, theme, mermaidInit, copyLight = true }) => {
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


  //****************************************************************************
  // Cache a PNG of the rendered diagram (IMPL-LTTCE-MRC-00001)
  //****************************************************************************
  // Rasterising here rather than at copy time is what lets the copy handler
  // stay synchronous: a `copy` listener has to fill the clipboard before it
  // returns, and decoding an SVG through an <img> is asynchronous. The result
  // is parked on the container, which is also the node a cloned selection
  // carries — so the copy path needs no lookup back into the live DOM.
  //
  // Deferred to an idle slot: the user may never copy the diagram, and this
  // must not compete with rendering the rest of the document.
  //
  // In dark theme with "Copy Diagrams On Light Background" on, the diagram is
  // rendered a *second* time off-screen with Mermaid's light theme, and that
  // is what gets rasterised. Re-backgrounding the dark rendering would not do:
  // Mermaid draws dark-theme diagrams in light colours, so white behind them
  // gives white-on-white. Only the clipboard copy is affected — the diagram on
  // screen keeps the theme the user chose.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !svg) return;

    const wantLight = copyLight && theme === 'dark';
    const background = PREVIEW_THEME_COLORS[wantLight ? 'light' : theme].backgroundColor;

    let cancelled = false;

    const cache = async (el: SVGSVGElement, size: { width: number; height: number }) => {
      const png = await rasterizeSvg(el, background, size.width > 0 ? size : undefined);
      if (cancelled || !png) return;
      container.setAttribute(DIAGRAM_PNG_ATTR, png);
      if (size.width > 0) container.setAttribute('data-lattice-diagram-width', String(Math.round(size.width)));
      if (size.height > 0) container.setAttribute('data-lattice-diagram-height', String(Math.round(size.height)));
    };

    const run = () => {
      const onScreen = container.querySelector('svg') as SVGSVGElement | null;
      if (cancelled || !onScreen) return;

      // The on-screen SVG is the only one that has actually been laid out, so
      // it is the honest source of the size the user sees. The light re-render
      // is measured off it rather than off its own (unlaid-out) box.
      const size = svgIntrinsicSize(onScreen);

      if (!wantLight) {
        void cache(onScreen, size);
        return;
      }

      void renderLightCopy(chart, mermaidInit).then((lightSvg) => {
        if (cancelled) return;
        void cache(lightSvg ?? onScreen, size);
      });
    };

    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
    }).requestIdleCallback;
    const handle = idle ? idle(run) : window.setTimeout(run, 0);

    return () => {
      cancelled = true;
      if (!idle) clearTimeout(handle);
    };
  }, [svg, theme, chart, mermaidInit, copyLight]);
  // PNG cache END *************************************************************

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
