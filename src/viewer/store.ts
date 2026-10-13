import type {
  Classification,
  ConversationMap,
  MapNode,
  NodeFlag,
  Relation,
  SourceMessage,
  Status,
} from '../core/model.ts';

/** Read-only lookups derived once from the embedded map. */
export class MapIndex {
  readonly map: ConversationMap;
  readonly byId = new Map<string, MapNode>();
  readonly relationsOf = new Map<string, Relation[]>();
  readonly messages = new Map<string, SourceMessage>();
  /** Nodes in depth-first (outline) order. */
  readonly order: MapNode[] = [];
  readonly searchText = new Map<string, string>();

  constructor(map: ConversationMap) {
    this.map = map;
    for (const n of map.nodes) this.byId.set(n.id, n);
    for (const m of map.messages) this.messages.set(m.id, m);
    for (const r of map.relations) {
      for (const id of [r.from, r.to]) {
        const list = this.relationsOf.get(id) ?? [];
        list.push(r);
        this.relationsOf.set(id, list);
      }
    }
    const walk = (id: string) => {
      const n = this.byId.get(id)!;
      this.order.push(n);
      for (const c of n.childIds) walk(c);
    };
    walk(map.rootId);
    for (const n of this.order) {
      const parts = [
        n.title,
        n.summary,
        n.detail ?? '',
        n.rationale ?? '',
        n.owner ?? '',
        n.due ?? '',
        ...n.evidence.map((e) => e.quote),
      ];
      this.searchText.set(n.id, parts.join('\n').toLocaleLowerCase());
    }
  }

  get root(): MapNode {
    return this.byId.get(this.map.rootId)!;
  }

  node(id: string): MapNode {
    const n = this.byId.get(id);
    if (!n) throw new Error(`Unknown node "${id}".`);
    return n;
  }

  ancestors(id: string): MapNode[] {
    const out: MapNode[] = [];
    let p = this.byId.get(id)?.parentId ?? null;
    while (p !== null) {
      const n = this.byId.get(p)!;
      out.unshift(n);
      p = n.parentId;
    }
    return out;
  }
}

export interface Filters {
  classes: Set<Classification>;
  statuses: Set<Status>;
  flags: Set<NodeFlag>;
}

export interface ViewState {
  selectedId: string;
  expanded: Set<string>;
  query: string;
  results: string[];
  resultIndex: number;
  filters: Filters;
}

export type Change = 'selection' | 'expansion' | 'search' | 'filters' | 'focus-request';

type Listener = (changes: ReadonlySet<Change>) => void;

/**
 * Single source of truth for UI state. Components subscribe and re-render the parts that
 * changed; nothing else holds mutable view state.
 */
export class Store {
  readonly index: MapIndex;
  readonly state: ViewState;
  private listeners: Listener[] = [];
  private pending = new Set<Change>();
  private scheduled = false;
  /** Node the canvas should center on during the next render, if any. */
  centerRequest: string | null = null;

  constructor(index: MapIndex) {
    this.index = index;
    const expanded = new Set<string>([index.root.id]);
    // Small maps open fully; larger ones start at the topic overview (progressive disclosure).
    if (index.order.length <= 24) for (const n of index.order) if (n.kind === 'topic') expanded.add(n.id);
    this.state = {
      selectedId: index.root.id,
      expanded,
      query: '',
      results: [],
      resultIndex: -1,
      filters: { classes: new Set(), statuses: new Set(), flags: new Set() },
    };
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
  }

  private emit(change: Change) {
    this.pending.add(change);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      const changes = this.pending;
      this.pending = new Set();
      this.scheduled = false;
      for (const l of this.listeners) l(changes);
    });
  }

  // --- Filtering ----------------------------------------------------------

  filtersActive(): boolean {
    const f = this.state.filters;
    return f.classes.size + f.statuses.size + f.flags.size > 0;
  }

  /** Does this node itself satisfy the filters? Topics and the root never match directly. */
  matchesFilters(n: MapNode): boolean {
    if (n.kind !== 'item') return false;
    const f = this.state.filters;
    if (f.classes.size > 0 && !f.classes.has(n.classification!)) return false;
    if (f.statuses.size > 0 && !f.statuses.has(n.status)) return false;
    if (f.flags.size > 0 && !n.flags.some((fl) => f.flags.has(fl))) return false;
    return true;
  }

  private visibleCache: Set<string> | null = null;

  /** Nodes allowed by filters: matching items plus their ancestors. Without filters: everything. */
  filterVisible(): Set<string> {
    if (this.visibleCache) return this.visibleCache;
    const out = new Set<string>();
    if (!this.filtersActive()) {
      for (const n of this.index.order) out.add(n.id);
    } else {
      out.add(this.index.root.id);
      for (const n of this.index.order) {
        if (!this.matchesFilters(n)) continue;
        out.add(n.id);
        for (const a of this.index.ancestors(n.id)) out.add(a.id);
      }
    }
    this.visibleCache = out;
    return out;
  }

  /** Children shown under `id`, honoring both expansion and filters. */
  visibleChildren(id: string): string[] {
    if (!this.state.expanded.has(id)) return [];
    const allowed = this.filterVisible();
    return this.index.node(id).childIds.filter((c) => allowed.has(c));
  }

  isShown(id: string): boolean {
    if (!this.filterVisible().has(id)) return false;
    return this.index.ancestors(id).every((a) => this.state.expanded.has(a.id));
  }

  setFilters(mutator: (f: Filters) => void) {
    mutator(this.state.filters);
    this.visibleCache = null;
    if (this.filtersActive()) {
      // A filter is a request to see the matching entries, so open the topics that hold them.
      for (const id of this.filterVisible()) {
        const n = this.index.node(id);
        if (n.kind === 'topic') this.state.expanded.add(id);
      }
      this.emit('expansion');
    }
    this.runSearch();
    this.emit('filters');
  }

  clearFilters() {
    this.setFilters((f) => {
      f.classes.clear();
      f.statuses.clear();
      f.flags.clear();
    });
  }

  // --- Selection and expansion -------------------------------------------

  select(id: string, opts: { center?: boolean; reveal?: boolean } = {}) {
    if (!this.index.byId.has(id)) return;
    if (opts.reveal) this.reveal(id);
    this.state.selectedId = id;
    if (opts.center) this.centerRequest = id;
    this.emit('selection');
  }

  /** Expand every ancestor so `id` is visible on the canvas and in the explorer. */
  reveal(id: string) {
    let changed = false;
    for (const a of this.index.ancestors(id)) {
      if (!this.state.expanded.has(a.id)) {
        this.state.expanded.add(a.id);
        changed = true;
      }
    }
    if (changed) this.emit('expansion');
  }

  setExpanded(id: string, open: boolean) {
    const n = this.index.node(id);
    if (n.kind === 'item' || n.kind === 'root') return;
    if (open === this.state.expanded.has(id)) return;
    if (open) this.state.expanded.add(id);
    else {
      this.state.expanded.delete(id);
      // Keep the selection visible: move it to the collapsed node if it was inside.
      if (this.index.ancestors(this.state.selectedId).some((a) => a.id === id)) {
        this.state.selectedId = id;
        this.emit('selection');
      }
    }
    this.emit('expansion');
  }

  toggle(id: string) {
    this.setExpanded(id, !this.state.expanded.has(id));
  }

  expandAll() {
    for (const n of this.index.order) if (n.kind !== 'item') this.state.expanded.add(n.id);
    this.emit('expansion');
  }

  collapseAll() {
    this.state.expanded = new Set([this.index.root.id]);
    if (this.state.selectedId !== this.index.root.id) {
      const top = this.index.ancestors(this.state.selectedId)[1] ?? this.index.node(this.state.selectedId);
      this.state.selectedId = top.id;
      this.emit('selection');
    }
    this.emit('expansion');
  }

  // --- Search ---------------------------------------------------------------

  setQuery(query: string) {
    this.state.query = query;
    this.runSearch();
    this.emit('search');
    if (this.state.results.length > 0) this.goToResult(0);
  }

  private runSearch() {
    const q = this.state.query.trim().toLocaleLowerCase();
    if (q === '') {
      this.state.results = [];
      this.state.resultIndex = -1;
      return;
    }
    const terms = q.split(/\s+/);
    const allowed = this.filterVisible();
    this.state.results = this.index.order
      .filter((n) => n.kind !== 'root' && allowed.has(n.id))
      .filter((n) => {
        const text = this.index.searchText.get(n.id)!;
        return terms.every((t) => text.includes(t));
      })
      .map((n) => n.id);
    this.state.resultIndex = this.state.results.length > 0 ? 0 : -1;
  }

  goToResult(i: number) {
    const total = this.state.results.length;
    if (total === 0) return;
    this.state.resultIndex = ((i % total) + total) % total;
    this.select(this.state.results[this.state.resultIndex]!, { center: true, reveal: true });
    this.emit('search');
  }

  stepResult(delta: number) {
    this.goToResult(this.state.resultIndex + delta);
  }

  requestFocus() {
    this.emit('focus-request');
  }
}
