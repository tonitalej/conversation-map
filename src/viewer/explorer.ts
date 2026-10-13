import type { MapNode } from '../core/model.ts';
import { CLASSIFICATION_GLYPH, CLASSIFICATION_LABEL, STATUS_LABEL } from '../render/labels.ts';
import { clear, h } from './dom.ts';
import type { Change, Store } from './store.ts';

/**
 * Hierarchical explorer following the WAI-ARIA tree pattern. Shares expansion, selection,
 * search and filter state with the canvas through the store.
 */
export class Explorer {
  readonly el: HTMLElement;
  private readonly store: Store;
  private readonly tree: HTMLElement;
  private readonly summary: HTMLElement;
  private rows = new Map<string, HTMLElement>();

  constructor(store: Store) {
    this.store = store;
    this.tree = h('ul', { class: 'tree', role: 'tree', 'aria-label': 'Topics' });
    this.summary = h('p', { class: 'explorer-summary', 'aria-live': 'polite' });
    this.el = h(
      'nav',
      { class: 'explorer', 'aria-label': 'Topic explorer' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Topics'), this.summary),
      this.tree,
    );
    this.tree.addEventListener('keydown', (e) => this.onKey(e));
    store.subscribe((changes) => this.update(changes));
    this.render();
  }

  private update(changes: ReadonlySet<Change>) {
    if (changes.has('expansion') || changes.has('filters') || changes.has('search')) this.render();
    else if (changes.has('selection')) this.paintSelection(true);
  }

  render() {
    const store = this.store;
    const focusedId = this.tree.contains(document.activeElement)
      ? ((document.activeElement as HTMLElement).closest<HTMLElement>('[role="treeitem"]')?.dataset['id'] ?? '')
      : null;
    clear(this.tree);
    this.rows.clear();
    const matches = new Set(store.state.results);
    const allowed = store.filterVisible();

    const build = (n: MapNode, level: number, container: HTMLElement) => {
      const kids = n.childIds.filter((c) => allowed.has(c));
      const expandable = n.kind === 'topic' && kids.length > 0;
      const open = store.state.expanded.has(n.id);
      const row = h(
        'div',
        { class: 'tree-row' },
        expandable
          ? h('span', { class: `twisty${open ? ' open' : ''}`, 'aria-hidden': 'true', 'data-twisty': n.id })
          : h('span', { class: 'twisty-spacer', 'aria-hidden': 'true' }),
        n.kind === 'item'
          ? h(
              'span',
              { class: `glyph cls-${n.classification!.replace(/_/g, '-')}`, 'aria-hidden': 'true' },
              CLASSIFICATION_GLYPH[n.classification!],
            )
          : null,
        h('span', { class: 'tree-label' }, n.title),
        n.kind === 'topic' ? topicBadges(n, store) : null,
      );
      const li = h(
        'li',
        {
          role: 'treeitem',
          class: `tree-item kind-${n.kind}${matches.has(n.id) ? ' is-match' : ''}`,
          'aria-level': level,
          'aria-selected': 'false',
          'aria-label': treeLabel(n),
          tabindex: -1,
          'data-id': n.id,
        },
        row,
      );
      if (expandable) li.setAttribute('aria-expanded', String(open));
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const twisty = (e.target as HTMLElement).closest('[data-twisty]');
        if (twisty) store.toggle(n.id);
        else store.select(n.id, { center: true });
      });
      container.appendChild(li);
      this.rows.set(n.id, li);
      if (expandable && open) {
        const group = h('ul', { role: 'group' });
        li.appendChild(group);
        for (const c of kids) build(store.index.node(c), level + 1, group);
      }
    };
    for (const c of store.index.root.childIds) if (allowed.has(c)) build(store.index.node(c), 1, this.tree);

    if (this.rows.size === 0) {
      this.tree.appendChild(
        h(
          'li',
          { class: 'tree-empty', role: 'none' },
          store.filtersActive() ? 'No entries match the current filters.' : 'This map has no topics.',
        ),
      );
    }
    const items = store.index.order.filter((n) => n.kind === 'item');
    const shown = items.filter((n) => allowed.has(n.id)).length;
    this.summary.textContent = store.filtersActive()
      ? `${shown} of ${items.length} entries match filters`
      : `${store.index.map.stats.topics} topics · ${items.length} entries`;
    this.paintSelection(false);
    if (focusedId !== null) {
      // Re-rendering replaced the focused row; put keyboard focus back where it was.
      const target =
        this.rows.get(focusedId) ??
        this.rows.get(store.state.selectedId) ??
        (this.rows.values().next().value as HTMLElement | undefined);
      if (target) {
        for (const li of this.rows.values()) li.tabIndex = -1;
        target.tabIndex = 0;
        target.focus();
      }
    }
  }

  private paintSelection(moveFocus: boolean) {
    const sel = this.store.state.selectedId;
    let focusTarget: HTMLElement | undefined;
    for (const [id, li] of this.rows) {
      const on = id === sel;
      li.setAttribute('aria-selected', String(on));
      li.tabIndex = on ? 0 : -1;
      if (on) focusTarget = li;
    }
    if (!focusTarget) {
      const first = this.rows.values().next().value as HTMLElement | undefined;
      if (first) first.tabIndex = 0;
    } else {
      focusTarget.scrollIntoView({ block: 'nearest' });
      if (moveFocus && this.tree.contains(document.activeElement)) focusTarget.focus();
    }
  }

  private visibleOrder(): string[] {
    return Array.from(this.tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).map((el) => el.dataset['id']!);
  }

  private onKey(e: KeyboardEvent) {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const id = li?.dataset['id'];
    if (!id) return;
    const order = this.visibleOrder();
    const i = order.indexOf(id);
    const n = this.store.index.node(id);
    const expandable = li!.hasAttribute('aria-expanded');
    const open = li!.getAttribute('aria-expanded') === 'true';
    let next: string | undefined;
    switch (e.key) {
      case 'ArrowDown':
        next = order[i + 1];
        break;
      case 'ArrowUp':
        next = order[i - 1];
        break;
      case 'Home':
        next = order[0];
        break;
      case 'End':
        next = order[order.length - 1];
        break;
      case 'ArrowRight':
        if (expandable && !open) this.store.setExpanded(id, true);
        else if (expandable) next = order[i + 1];
        break;
      case 'ArrowLeft':
        if (expandable && open) this.store.setExpanded(id, false);
        else if (n.parentId && n.parentId !== this.store.index.root.id) next = n.parentId;
        break;
      case 'Enter':
      case ' ':
        this.store.select(id, { center: true });
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) {
      this.store.select(next, { center: true });
      this.rows.get(next)?.focus();
    }
  }
}

function topicBadges(n: MapNode, store: Store): HTMLElement | null {
  let open = 0;
  let pending = 0;
  let conflicts = 0;
  const visit = (id: string) => {
    const c = store.index.node(id);
    if (c.status === 'open') open++;
    if (c.status === 'pending') pending++;
    if (c.flags.includes('in-conflict')) conflicts++;
    for (const k of c.childIds) visit(k);
  };
  for (const c of n.childIds) visit(c);
  const parts: HTMLElement[] = [];
  if (open) parts.push(h('span', { class: 'badge badge-open', title: `${open} open question(s)` }, `${open}?`));
  if (pending)
    parts.push(h('span', { class: 'badge badge-pending', title: `${pending} pending action(s)` }, `${pending}☐`));
  if (conflicts)
    parts.push(
      h('span', { class: 'badge badge-conflict', title: `${conflicts} item(s) in conflict` }, `${conflicts}!`),
    );
  return parts.length > 0 ? h('span', { class: 'badges', 'aria-hidden': 'true' }, ...parts) : null;
}

function treeLabel(n: MapNode): string {
  if (n.kind === 'topic') return `${n.title}, topic, ${n.childIds.length} entries`;
  const status = STATUS_LABEL[n.status];
  return `${n.title}, ${CLASSIFICATION_LABEL[n.classification!]}${status ? `, ${status}` : ''}`;
}
