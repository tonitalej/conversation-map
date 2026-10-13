import type { Classification, NodeFlag, Status } from '../core/model.ts';
import { renderMarkdown } from '../render/markdown.ts';
import { CLASSIFICATION_GLYPH, CLASSIFICATION_LABEL, FLAG_LABEL, STATUS_LABEL } from '../render/labels.ts';
import { clear, h, icon, svg } from './dom.ts';
import type { Change, Store } from './store.ts';

const CLASS_GROUPS: { title: string; classes: Classification[] }[] = [
  { title: 'Decisions and proposals', classes: ['decision', 'suggestion', 'rejected_proposal', 'superseded_decision'] },
  { title: 'Questions', classes: ['open_question', 'answered_question'] },
  { title: 'Actions', classes: ['action_item', 'completed_action'] },
  { title: 'Statements', classes: ['user_statement', 'assistant_statement', 'fact', 'inference', 'unknown'] },
];
const STATUS_ORDER: Status[] = ['active', 'proposed', 'open', 'pending', 'done', 'answered', 'rejected', 'superseded'];
const FLAG_FILTERS: NodeFlag[] = ['in-conflict', 'unsupported', 'unverified-evidence'];

const PRESETS: { label: string; apply: (s: Store) => void; active: (s: Store) => boolean }[] = [
  { label: 'Open questions', ...classPreset(['open_question']) },
  { label: 'Pending actions', ...classPreset(['action_item']) },
  { label: 'Completed actions', ...classPreset(['completed_action']) },
  { label: 'Current decisions', ...classPreset(['decision']) },
  {
    label: 'Unresolved',
    apply: (s) =>
      s.setFilters((f) => {
        f.classes.clear();
        f.statuses = new Set<Status>(['open', 'pending', 'proposed']);
        f.flags.clear();
      }),
    active: (s) =>
      s.state.filters.statuses.size === 3 &&
      ['open', 'pending', 'proposed'].every((x) => s.state.filters.statuses.has(x as Status)),
  },
];

function classPreset(classes: Classification[]) {
  return {
    apply: (s: Store) =>
      s.setFilters((f) => {
        f.classes = new Set(classes);
        f.statuses.clear();
        f.flags.clear();
      }),
    active: (s: Store) => {
      const f = s.state.filters;
      return (
        f.statuses.size === 0 &&
        f.flags.size === 0 &&
        f.classes.size === classes.length &&
        classes.every((c) => f.classes.has(c))
      );
    },
  };
}

export interface HeaderOptions {
  pristineHtml: string;
  onToggleFilters?: (open: boolean) => void;
}

export class Header {
  readonly el: HTMLElement;
  readonly filterPanel: HTMLElement;
  private readonly store: Store;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly filterBtn: HTMLButtonElement;
  private readonly exportBtn: HTMLButtonElement;
  private readonly exportMenu: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pristineHtml: string;

  constructor(store: Store, opts: HeaderOptions) {
    this.store = store;
    this.pristineHtml = opts.pristineHtml;
    const map = store.index.map;

    this.input = h('input', {
      type: 'search',
      class: 'search-input',
      id: 'cm-search',
      placeholder: 'Search topics, details, quotes',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-describedby': 'cm-search-count',
    });
    this.count = h('span', { class: 'search-count', id: 'cm-search-count', 'aria-live': 'polite' });
    this.prev = h(
      'button',
      {
        type: 'button',
        class: 'tool-btn',
        'aria-label': 'Previous result (Shift+Enter)',
        title: 'Previous result',
        'data-action': 'prev-result',
      },
      icon('up'),
    );
    this.next = h(
      'button',
      {
        type: 'button',
        class: 'tool-btn',
        'aria-label': 'Next result (Enter)',
        title: 'Next result',
        'data-action': 'next-result',
      },
      icon('down'),
    );
    this.prev.addEventListener('click', () => store.stepResult(-1));
    this.next.addEventListener('click', () => store.stepResult(1));

    let debounce: ReturnType<typeof setTimeout> | undefined;
    this.input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => store.setQuery(this.input.value), 120);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounce);
        if (store.state.query !== this.input.value) store.setQuery(this.input.value);
        else store.stepResult(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape' && this.input.value !== '') {
        e.preventDefault();
        e.stopPropagation();
        this.input.value = '';
        store.setQuery('');
      }
    });

    const search = h(
      'div',
      { class: 'search', role: 'search' },
      h('label', { class: 'sr-only', for: 'cm-search' }, 'Search the map'),
      icon('search'),
      this.input,
      this.count,
      this.prev,
      this.next,
    );

    this.filterPanel = h('div', {
      class: 'filter-panel',
      id: 'cm-filters',
      hidden: true,
      role: 'region',
      'aria-label': 'Filters',
    });
    this.filterBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'aria-expanded': 'false',
        'aria-controls': 'cm-filters',
        'data-action': 'filters',
      },
      icon('filter'),
      h('span', {}, 'Filters'),
    );
    this.filterBtn.addEventListener('click', () => this.setFiltersOpen(this.filterPanel.hidden !== false));

    this.exportMenu = h(
      'div',
      { class: 'menu', id: 'cm-export', hidden: true },
      this.menuItem('Interactive HTML', 'Self-contained copy of this map', () => this.download('html')),
      this.menuItem('Markdown', 'Readable text outline', () => this.download('md')),
      this.menuItem('JSON data', 'Validated map data (schema v1)', () => this.download('json')),
      this.menuItem('Print', 'Printer-friendly outline', () => {
        this.closeMenu();
        window.print();
      }),
    );
    this.exportBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'aria-expanded': 'false',
        'aria-controls': 'cm-export',
        'aria-haspopup': 'true',
        'data-action': 'export',
      },
      icon('download'),
      h('span', {}, 'Export'),
    );
    this.exportBtn.addEventListener('click', () => (this.exportMenu.hidden ? this.openMenu() : this.closeMenu()));
    this.exportMenu.addEventListener('keydown', (e) => this.menuKeys(e));
    document.addEventListener('pointerdown', (e) => {
      if (!this.exportMenu.hidden && !(e.target as Element).closest('.export-wrap')) this.closeMenu(false);
    });

    this.status = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });

    this.el = h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'brand' },
        logo(),
        h(
          'div',
          { class: 'brand-text' },
          h('h1', { class: 'doc-title', title: map.title }, map.title),
          h(
            'p',
            { class: 'doc-meta' },
            `${map.stats.messages} messages · ${map.stats.topics} topics · ${map.stats.items} entries`,
            map.coverage.status === 'partial' ? h('span', { class: 'pill pill-warn' }, 'Partial coverage') : null,
          ),
        ),
      ),
      search,
      h(
        'div',
        { class: 'actions' },
        this.filterBtn,
        h('div', { class: 'export-wrap' }, this.exportBtn, this.exportMenu),
      ),
      this.status,
    );

    store.subscribe((changes) => this.update(changes));
    this.renderFilters();
    this.update(new Set<Change>(['search', 'filters']));
  }

  focusSearch() {
    this.input.focus();
    this.input.select();
  }

  closeOverlays(): boolean {
    if (!this.exportMenu.hidden) {
      this.closeMenu();
      return true;
    }
    if (!this.filterPanel.hidden) {
      this.setFiltersOpen(false);
      this.filterBtn.focus();
      return true;
    }
    return false;
  }

  private update(changes: ReadonlySet<Change>) {
    const { results, resultIndex, query } = this.store.state;
    if (changes.has('search') || changes.has('filters')) {
      const has = query.trim() !== '';
      this.count.textContent = !has
        ? ''
        : results.length === 0
          ? 'No results'
          : `${resultIndex + 1} of ${results.length}`;
      this.count.classList.toggle('none', has && results.length === 0);
      this.prev.disabled = results.length < 2;
      this.next.disabled = results.length < 2;
    }
    if (changes.has('filters')) {
      const f = this.store.state.filters;
      const n = f.classes.size + f.statuses.size + f.flags.size;
      this.filterBtn.classList.toggle('is-active', n > 0);
      this.filterBtn.querySelector('span')!.textContent = n > 0 ? `Filters (${n})` : 'Filters';
      this.renderFilters();
    }
  }

  private setFiltersOpen(open: boolean) {
    this.filterPanel.hidden = !open;
    this.filterBtn.setAttribute('aria-expanded', String(open));
    if (open) this.filterPanel.querySelector<HTMLElement>('button, input')?.focus();
  }

  private renderFilters() {
    const store = this.store;
    const f = store.state.filters;
    const stats = store.index.map.stats.byClassification;
    const statusCounts = new Map<Status, number>();
    const flagCounts = new Map<NodeFlag, number>();
    for (const n of store.index.order) {
      if (n.kind !== 'item') continue;
      statusCounts.set(n.status, (statusCounts.get(n.status) ?? 0) + 1);
      for (const fl of n.flags) flagCounts.set(fl, (flagCounts.get(fl) ?? 0) + 1);
    }
    const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.['filterKey'];

    const check = (
      key: string,
      label: string,
      count: number,
      checked: boolean,
      onChange: (on: boolean) => void,
      glyph?: HTMLElement,
    ) => {
      const id = `f-${key}`;
      const input = h('input', {
        type: 'checkbox',
        id,
        checked,
        disabled: count === 0 && !checked,
        'data-filter-key': key,
      });
      input.addEventListener('change', () => onChange(input.checked));
      return h(
        'label',
        { class: `check${count === 0 ? ' muted' : ''}`, for: id },
        input,
        glyph ?? null,
        h('span', { class: 'check-label' }, label),
        h('span', { class: 'check-count' }, String(count)),
      );
    };
    const toggleIn = <T>(set: Set<T>, v: T, on: boolean) => (on ? set.add(v) : set.delete(v));

    clear(this.filterPanel);
    this.filterPanel.append(
      h(
        'div',
        { class: 'filter-head' },
        h('h2', { class: 'panel-title' }, 'Filter entries'),
        h(
          'button',
          {
            type: 'button',
            class: 'ghost-btn',
            disabled: !store.filtersActive(),
            'data-action': 'clear-filters',
            'data-filter-key': 'clear',
            onclick: () => store.clearFilters(),
          },
          'Clear all',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'tool-btn',
            'aria-label': 'Close filters',
            onclick: () => {
              this.setFiltersOpen(false);
              this.filterBtn.focus();
            },
          },
          icon('close'),
        ),
      ),
      h(
        'div',
        { class: 'presets', role: 'group', 'aria-label': 'Quick filters' },
        ...PRESETS.map((p, i) => {
          const on = p.active(store);
          return h(
            'button',
            {
              type: 'button',
              class: `chip${on ? ' is-on' : ''}`,
              'aria-pressed': String(on),
              'data-filter-key': `preset-${i}`,
              onclick: () => (on ? store.clearFilters() : p.apply(store)),
            },
            p.label,
          );
        }),
      ),
      h(
        'div',
        { class: 'filter-cols' },
        h(
          'fieldset',
          {},
          h('legend', {}, 'Classification'),
          ...CLASS_GROUPS.map((g) =>
            h(
              'div',
              { class: 'filter-group' },
              h('p', { class: 'filter-group-title' }, g.title),
              ...g.classes.map((c) =>
                check(
                  c,
                  CLASSIFICATION_LABEL[c],
                  stats[c] ?? 0,
                  f.classes.has(c),
                  (on) => store.setFilters((x) => toggleIn(x.classes, c, on)),
                  h(
                    'span',
                    { class: `glyph cls-${c.replace(/_/g, '-')}`, 'aria-hidden': 'true' },
                    CLASSIFICATION_GLYPH[c],
                  ),
                ),
              ),
            ),
          ),
        ),
        h(
          'div',
          {},
          h(
            'fieldset',
            {},
            h('legend', {}, 'Status'),
            ...STATUS_ORDER.map((s) =>
              check(`status-${s}`, STATUS_LABEL[s], statusCounts.get(s) ?? 0, f.statuses.has(s), (on) =>
                store.setFilters((x) => toggleIn(x.statuses, s, on)),
              ),
            ),
          ),
          h(
            'fieldset',
            {},
            h('legend', {}, 'Needs attention'),
            ...FLAG_FILTERS.map((fl) =>
              check(`flag-${fl}`, FLAG_LABEL[fl], flagCounts.get(fl) ?? 0, f.flags.has(fl), (on) =>
                store.setFilters((x) => toggleIn(x.flags, fl, on)),
              ),
            ),
          ),
        ),
      ),
      h(
        'p',
        { class: 'help' },
        'Filters combine across groups (all must match) and within a group (any may match). Topics stay visible when they contain a match.',
      ),
    );
    if (focusedKey)
      this.filterPanel.querySelector<HTMLElement>(`[data-filter-key="${CSS.escape(focusedKey)}"]`)?.focus();
  }

  // --- Export menu --------------------------------------------------------

  private menuItem(label: string, hint: string, action: () => void): HTMLElement {
    const b = h(
      'button',
      { type: 'button', class: 'menu-item', 'data-export': label },
      h('span', { class: 'menu-label' }, label),
      h('span', { class: 'menu-hint' }, hint),
    );
    b.addEventListener('click', action);
    return b;
  }

  private openMenu() {
    this.exportMenu.hidden = false;
    this.exportBtn.setAttribute('aria-expanded', 'true');
    this.exportMenu.querySelector<HTMLElement>('button')?.focus();
  }

  private closeMenu(returnFocus = true) {
    this.exportMenu.hidden = true;
    this.exportBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.exportBtn.focus();
  }

  private menuKeys(e: KeyboardEvent) {
    const items = Array.from(this.exportMenu.querySelectorAll<HTMLElement>('button'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]!.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]!.focus();
    else if (e.key === 'Escape') this.closeMenu();
    else return;
    e.preventDefault();
  }

  private download(kind: 'html' | 'md' | 'json') {
    const map = this.store.index.map;
    const base = slug(map.title) || 'conversation-map';
    try {
      const [content, type, ext] =
        kind === 'html'
          ? [this.pristineHtml, 'text/html', 'html']
          : kind === 'md'
            ? [renderMarkdown(map), 'text/markdown', 'md']
            : [JSON.stringify(map, null, 2), 'application/json', 'json'];
      const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
      const a = h('a', {});
      a.href = url;
      a.download = `${base}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.status.textContent = `Downloaded ${base}.${ext}`;
    } catch (err) {
      this.status.textContent = `Export failed: ${(err as Error).message}. The map is unchanged; try another format.`;
    }
    this.closeMenu();
  }
}

function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function logo(): SVGSVGElement {
  return svg(
    'svg',
    { class: 'logo', viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { x: 1, y: 1, width: 30, height: 30, rx: 8, class: 'logo-bg' }),
    svg('path', { d: 'M10 16h4m4-5-4 5 4 5', class: 'logo-line', fill: 'none' }),
    svg('circle', { cx: 9, cy: 16, r: 3, class: 'logo-node' }),
    svg('circle', { cx: 21, cy: 10, r: 2.6, class: 'logo-node' }),
    svg('circle', { cx: 21, cy: 22, r: 2.6, class: 'logo-node' }),
  );
}
