/**
 * Client half of the design-canvas bundle.
 *
 * T1 delivers the skeleton: a registered main panel (`design-canvas`) plus its
 * sidebar entry, rendering a placeholder. T3 replaces the placeholder with the
 * real canvas (frames, drag, zoom, comments, live refresh).
 *
 * Constraints that come from the Harness, not from us:
 * - The factory must stay side-effect free; register resources in `apply`.
 * - React comes from the browser module table; never require Harness Client
 *   packages (primitives and friends) as modules.
 * - Style with `--dsw-alias-*` theme tokens so light/dark keep working.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-design-canvas',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace for every visible string of this plugin. */
    const NS = 'dsh-design-canvas';
    /** Main-panel id; the sidebar entry id must match so the panel is selectable. */
    const PANEL_ID = 'design-canvas';

    /** English copy; mirrors locale/en.json for the running client. */
    const en = {
      panel: 'Design',
      title: 'Design Canvas',
      placeholder: 'Canvas skeleton is live. The design surface lands with T3.',
    };
    /** Chinese copy; mirrors locale/zh.json for the running client. */
    const zh = {
      panel: '设计',
      title: '设计画布',
      placeholder: '画布骨架已就绪，真正的设计界面在 T3 接入。',
    };

    /** Translation bound in apply(); components fall back to the key. */
    let t = (key) => key;

    /** Sidebar glyph: two overlapping artboards. */
    function DesignIcon() {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: 20, height: 20, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 6, y: 10, width: 32, height: 42, rx: 5, fill: 'none', stroke: 'currentColor', strokeWidth: 4 }),
        h('rect', { x: 26, y: 24, width: 32, height: 26, rx: 5, fill: 'currentColor', fillOpacity: 0.18, stroke: 'currentColor', strokeWidth: 4 }),
      );
    }

    /** Full-screen main panel that hosts the canvas. */
    function DesignCanvasPage() {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            padding: '16px 20px',
            boxSizing: 'border-box',
            gap: 12,
            color: 'var(--dsw-alias-text-primary, inherit)',
          },
        },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, t('title')),
        h(
          'div',
          {
            style: {
              flex: 1,
              minHeight: 0,
              display: 'grid',
              placeItems: 'center',
              border: '1px dashed var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
              borderRadius: 10,
              opacity: 0.75,
              fontSize: 13,
            },
          },
          h('p', { style: { margin: 0 } }, t('placeholder')),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'design-canvas:dictionaries');
        t = ctx.locale.bind(NS);

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, DesignCanvasPage),
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => t('panel'), locale: NS },
            DesignIcon,
          ),
        );
      },
    };
  },
});
