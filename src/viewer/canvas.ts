import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import type { MapNode, Relation } from '../core/model.ts';
import { CLASSIFICATION_GLYPH, CLASSIFICATION_LABEL, RELATION_LABEL, STATUS_LABEL } from '../render/labels.ts';
import { clear, h, icon, prefersReducedMotion, svg } from './dom.ts';
import type { Change, Store } from './store.ts';

const CARD_W = 240;
const CARD_H = 64;
const ROOT_W = 260;
const ROW = 80;
const COL = 310;
const MIN_K = 0.15;
const MAX_K = 2.5;

interface Pos {
  x: number;
  y: number;
  w: number;
  depth: number;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

export class Canvas {
  readonly el: HTMLElement;
  private readonly store: Store;
  private readonly viewport: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly edges: SVGSVGElement;
  private readonly overlay: SVGGElement;
  private readonly treeEdges: SVGGElement;
  private readonly cards = new Map<string, HTMLElement>();
  private readonly zoomLabel: HTMLElement;
  private readonly live: HTMLElement;
  private positions = new Map<string, Pos>();
  private t: Transform = { x: 40, y: 0, k: 1 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { dist: number; k: number } | null = null;
  private dragMoved = false;
  private revealAfterRender: string | null = null;

  constructor(store: Store) {
    this.store = store;
    this.treeEdges = svg('g', { class: 'edges-tree' });
    this.overlay = svg('g', { class: 'edges-relations' });
    this.edges = svg(
      'svg',
      { class: 'edge-layer', 'aria-hidden': 'true', focusable: 'false' },
      this.treeEdges,
      this.overlay,
    );
    this.stage = h('div', { class: 'stage' }, this.edges);
    this.viewport = h(
      'div',
      {
        class: 'viewport',
        role: 'group',
        'aria-roledescription': 'mind map',
        'aria-label': 'Map canvas. Use arrow keys to move between nodes, Enter to select, plus and minus to zoom.',
      },
      this.stage,
    );
    this.zoomLabel = h('span', { class: 'zoom-level', 'aria-live': 'off' }, '100%');
    this.live = h('div', { class: 'sr-only', 'aria-live': 'polite' });

    const btn = (name: string, label: string, onclick: () => void, extra?: Record<string, string>) =>
      h(
        'button',
        { type: 'button', class: 'tool-btn', 'aria-label': label, title: label, onclick, ...extra },
        icon(name),
      );

    const controls = h(
      'div',
      { class: 'canvas-controls', role: 'toolbar', 'aria-label': 'Map view controls' },
      btn('plus', 'Zoom in (+)', () => this.zoomBy(1.2), { 'data-action': 'zoom-in' }),
      this.zoomLabel,
      btn('minus', 'Zoom out (−)', () => this.zoomBy(1 / 1.2), { 'data-action': 'zoom-out' }),
      h('span', { class: 'divider', 'aria-hidden': 'true' }),
      btn('fit', 'Fit map to view (F)', () => this.fit(), { 'data-action': 'fit' }),
      btn('reset', 'Reset view (0)', () => this.reset(), { 'data-action': 'reset' }),
      h('span', { class: 'divider', 'aria-hidden': 'true' }),
      btn('expand', 'Expand all branches', () => store.expandAll(), { 'data-action': 'expand-all' }),
      btn('collapse', 'Collapse all branches', () => store.collapseAll(), { 'data-action': 'collapse-all' }),
    );

    this.el = h('section', { class: 'canvas', 'aria-label': 'Map' }, this.viewport, controls, legend(), this.live);
    this.bindPointer();
    this.bindKeys();
    new ResizeObserver(() => this.applyTransform()).observe(this.viewport);
    store.subscribe((changes) => this.update(changes));
  }

  /** First render, after the element is attached and has a size. */
  mount() {
    this.render();
    this.fit(false, this.viewport.clientWidth < 600 ? 0.45 : 0.7);
  }

  private update(changes: ReadonlySet<Change>) {
    if (changes.has('expansion') || changes.has('filters') || changes.has('search')) this.render();
    else if (changes.has('selection')) this.paintState();
    if (this.revealAfterRender) {
      const id = this.revealAfterRender;
      this.revealAfterRender = null;
      if (this.store.state.expanded.has(id)) this.keepBranchInView(id);
    }
    if (this.store.centerRequest) {
      const id = this.store.centerRequest;
      this.store.centerRequest = null;
      this.centerOn(id);
    }
    if (changes.has('focus-request'))
      this.cards.get(this.store.state.selectedId)?.querySelector<HTMLElement>('.card-main')?.focus();
  }

  // --- Layout and drawing ---------------------------------------------------

  private layout() {
    const store = this.store;
    const rootData = store.index.root;
    const root = hierarchy<MapNode>(rootData, (n) => store.visibleChildren(n.id).map((id) => store.index.node(id)));
    const laid = tree<MapNode>()
      .nodeSize([ROW, COL])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(root);
    const positions = new Map<string, Pos>();
    laid.each((d: HierarchyPointNode<MapNode>) => {
      const w = d.data.kind === 'root' ? ROOT_W : CARD_W;
      positions.set(d.data.id, { x: d.y, y: d.x, w, depth: d.depth });
    });
    this.positions = positions;
    return laid;
  }

  render() {
    const laid = this.layout();
    const keep = new Set<string>();
    const selected = this.store.state.selectedId;
    const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.card')?.dataset['id'];

    for (const [id, p] of this.positions) {
      keep.add(id);
      let card = this.cards.get(id);
      if (!card) {
        card = this.createCard(this.store.index.node(id));
        this.cards.set(id, card);
        this.stage.appendChild(card);
      }
      card.style.transform = `translate(${p.x}px, ${p.y - CARD_H / 2}px)`;
    }
    for (const [id, card] of this.cards) {
      if (!keep.has(id)) {
        card.remove();
        this.cards.delete(id);
      }
    }

    clear(this.treeEdges);
    laid.links().forEach((l) => {
      const s = this.positions.get(l.source.data.id)!;
      const t = this.positions.get(l.target.data.id)!;
      this.treeEdges.appendChild(
        svg('path', { class: 'edge', d: curve(s.x + s.w, s.y, t.x, t.y), 'data-to': l.target.data.id }),
      );
    });

    this.paintState();
    if (focusedId && !this.cards.has(focusedId))
      this.cards.get(selected)?.querySelector<HTMLElement>('.card-main')?.focus();
  }

  private createCard(n: MapNode): HTMLElement {
    const main = h('button', { type: 'button', class: 'card-main', tabindex: -1, 'data-id': n.id });
    if (n.kind === 'item') {
      const cls = n.classification!;
      main.append(
        h('span', { class: 'glyph', 'aria-hidden': 'true' }, CLASSIFICATION_GLYPH[cls]),
        h(
          'span',
          { class: 'card-text' },
          h('span', { class: 'card-title' }, n.title),
          h(
            'span',
            { class: 'card-meta' },
            CLASSIFICATION_LABEL[cls] +
              (STATUS_LABEL[n.status] && !CLASSIFICATION_LABEL[cls].includes(STATUS_LABEL[n.status])
                ? ` · ${STATUS_LABEL[n.status]}`
                : ''),
            n.flags.includes('unsupported') ? h('span', { class: 'meta-flag' }, ' · no source') : null,
            n.flags.includes('in-conflict') ? h('span', { class: 'meta-flag' }, ' · conflict') : null,
          ),
        ),
      );
    } else {
      const total = n.childIds.length;
      main.append(
        h(
          'span',
          { class: 'card-text' },
          h('span', { class: 'card-title' }, n.title),
          h(
            'span',
            { class: 'card-meta' },
            n.kind === 'root' ? 'Conversation' : `Topic · ${total} ${total === 1 ? 'entry' : 'entries'}`,
          ),
        ),
      );
    }
    main.setAttribute('aria-label', describeNode(n));
    main.addEventListener('click', () => {
      if (this.dragMoved) return;
      this.store.select(n.id);
    });
    main.addEventListener('dblclick', () => this.toggleFromCanvas(n.id));

    const card = h('div', {
      class: `card kind-${n.kind}${n.classification ? ` cls-${n.classification.replace(/_/g, '-')}` : ''}${n.flags.map((f) => ` flag-${f}`).join('')}`,
      'data-id': n.id,
    });
    card.style.width = `${n.kind === 'root' ? ROOT_W : CARD_W}px`;
    card.append(main);
    if (n.kind === 'topic' && n.childIds.length > 0) {
      const toggle = h('button', { type: 'button', class: 'card-toggle', tabindex: -1, 'data-id': n.id });
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFromCanvas(n.id);
      });
      card.append(toggle);
    }
    return card;
  }

  /** Update classes that depend on selection, search and expansion without re-layout. */
  private paintState() {
    const { selectedId, results, resultIndex, expanded } = this.store.state;
    const matches = new Set(results);
    const current = results[resultIndex];
    const path = new Set(this.store.index.ancestors(selectedId).map((a) => a.id));
    const related = new Set<string>();
    for (const r of this.store.index.relationsOf.get(selectedId) ?? [])
      related.add(r.from === selectedId ? r.to : r.from);

    for (const [id, card] of this.cards) {
      card.classList.toggle('is-selected', id === selectedId);
      card.classList.toggle('is-path', path.has(id));
      card.classList.toggle('is-related', related.has(id));
      card.classList.toggle('is-match', matches.has(id));
      card.classList.toggle('is-current-match', id === current);
      const main = card.querySelector<HTMLElement>('.card-main')!;
      main.tabIndex = id === selectedId ? 0 : -1;
      main.setAttribute('aria-pressed', String(id === selectedId));
      const toggle = card.querySelector<HTMLElement>('.card-toggle');
      if (toggle) {
        const n = this.store.index.node(id);
        const open = expanded.has(id);
        const hiddenCount = n.childIds.length;
        toggle.textContent = open ? '−' : `+${hiddenCount}`;
        toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${n.title}`);
        toggle.setAttribute('aria-expanded', String(open));
        main.setAttribute('aria-expanded', String(open));
      }
    }
    // If the selected node is collapsed away, focus target falls back to the root.
    if (!this.cards.has(selectedId))
      this.cards.get(this.store.index.root.id)!.querySelector<HTMLElement>('.card-main')!.tabIndex = 0;
    const onPath = new Set([...path, selectedId]);
    for (const edge of Array.from(this.treeEdges.children)) {
      const to = edge.getAttribute('data-to') ?? '';
      edge.classList.toggle('is-path-edge', onPath.has(to) && to !== this.store.index.root.id);
    }
    this.drawRelations(selectedId);
  }

  private drawRelations(selectedId: string) {
    clear(this.overlay);
    const rels: Relation[] = this.store.index.relationsOf.get(selectedId) ?? [];
    for (const r of rels) {
      const otherId = r.from === selectedId ? r.to : r.from;
      const a = this.visibleAnchor(selectedId);
      const b = this.visibleAnchor(otherId);
      if (!a || !b || a === b) continue;
      const pa = this.positions.get(a)!;
      const pb = this.positions.get(b)!;
      // Route around the right-hand side of both cards so the arc and its label never sit under a card.
      const ax = pa.x + pa.w;
      const bx = pb.x + pb.w;
      const edgeX = Math.max(ax, bx);
      const bulge = 36 + Math.min(120, Math.abs(pb.y - pa.y) * 0.25);
      const d = `M${ax},${pa.y} C${edgeX + bulge},${pa.y} ${edgeX + bulge},${pb.y} ${bx},${pb.y}`;
      const label = r.from === selectedId ? RELATION_LABEL[r.type].out : RELATION_LABEL[r.type].in;
      this.overlay.append(
        svg('path', { class: `relation rel-${r.type.replace(/_/g, '-')}${b !== otherId ? ' rel-proxy' : ''}`, d }),
        svg(
          'text',
          { class: 'relation-label', x: edgeX + bulge * 0.75 + 6, y: (pa.y + pb.y) / 2 + 4, 'text-anchor': 'start' },
          label,
        ),
      );
    }
  }

  /** The node itself if drawn, otherwise its nearest drawn ancestor. */
  private visibleAnchor(id: string): string | null {
    if (this.positions.has(id)) return id;
    const anc = this.store.index.ancestors(id);
    for (let i = anc.length - 1; i >= 0; i--) if (this.positions.has(anc[i]!.id)) return anc[i]!.id;
    return null;
  }

  // --- View transform -------------------------------------------------------

  private applyTransform(animate = false) {
    this.stage.classList.toggle('animate', animate && !prefersReducedMotion());
    this.stage.style.transform = `translate(${this.t.x}px, ${this.t.y}px) scale(${this.t.k})`;
    this.zoomLabel.textContent = `${Math.round(this.t.k * 100)}%`;
  }

  private bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.positions.values()) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.w);
      minY = Math.min(minY, p.y - CARD_H / 2);
      maxY = Math.max(maxY, p.y + CARD_H / 2);
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Fit the drawn map into the viewport. With `minK`, never zoom out further than that;
   * if the map is still too large, anchor it at the root instead (used for the first view).
   */
  fit(animate = true, minK = MIN_K) {
    const vw = this.viewport.clientWidth || 800;
    const vh = this.viewport.clientHeight || 600;
    const b = this.bounds();
    const pad = 48;
    const ideal = Math.min((vw - pad * 2) / (b.maxX - b.minX), (vh - pad * 2) / (b.maxY - b.minY), 1.1);
    const k = clamp(Math.max(ideal, minK), MIN_K, MAX_K);
    if (ideal >= minK) {
      this.t = {
        k,
        x: (vw - (b.maxX - b.minX) * k) / 2 - b.minX * k,
        y: (vh - (b.maxY - b.minY) * k) / 2 - b.minY * k,
      };
    } else {
      this.t = { k, x: pad - b.minX * k, y: vh / 2 };
    }
    this.applyTransform(animate);
    this.announce(`Fitted map, zoom ${Math.round(k * 100)} percent`);
  }

  reset() {
    const vh = this.viewport.clientHeight || 600;
    this.t = { k: 1, x: 40, y: vh / 2 };
    this.applyTransform(true);
    this.announce('View reset');
  }

  zoomBy(factor: number, cx?: number, cy?: number) {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const px = cx ?? vw / 2;
    const py = cy ?? vh / 2;
    const k = clamp(this.t.k * factor, MIN_K, MAX_K);
    const ratio = k / this.t.k;
    this.t = { k, x: px - (px - this.t.x) * ratio, y: py - (py - this.t.y) * ratio };
    this.applyTransform(cx === undefined);
  }

  private toggleFromCanvas(id: string) {
    this.revealAfterRender = id;
    this.store.toggle(id);
  }

  /** Pan as little as possible so a topic and its visible children are on screen. */
  private keepBranchInView(id: string) {
    const ids = [id, ...this.store.visibleChildren(id)].filter((x) => this.positions.has(x));
    if (ids.length === 0) return;
    const { k, x, y } = this.t;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const m = 32;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const i of ids) {
      const p = this.positions.get(i)!;
      left = Math.min(left, x + p.x * k);
      right = Math.max(right, x + (p.x + p.w) * k);
      top = Math.min(top, y + (p.y - CARD_H / 2) * k);
      bottom = Math.max(bottom, y + (p.y + CARD_H / 2) * k);
    }
    let dx = right > vw - m ? vw - m - right : 0;
    if (left + dx < m) dx = m - left;
    let dy = bottom > vh - m ? vh - m - bottom : 0;
    if (top + dy < m) dy = m - top;
    if (dx === 0 && dy === 0) return;
    this.t = { k, x: x + dx, y: y + dy };
    this.applyTransform(true);
  }

  centerOn(id: string) {
    const anchor = this.visibleAnchor(id);
    const p = anchor ? this.positions.get(anchor) : undefined;
    if (!p) return;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const sx = this.t.x + (p.x + p.w / 2) * this.t.k;
    const sy = this.t.y + p.y * this.t.k;
    const margin = 60;
    if (sx > margin && sx < vw - margin && sy > margin && sy < vh - margin) return;
    this.t = { ...this.t, x: vw / 2 - (p.x + p.w / 2) * this.t.k, y: vh / 2 - p.y * this.t.k };
    this.applyTransform(true);
  }

  private announce(text: string) {
    this.live.textContent = text;
  }

  // --- Pointer: pan, wheel zoom, pinch ---------------------------------------

  private bindPointer() {
    const vp = this.viewport;
    vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = vp.getBoundingClientRect();
        if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
        } else {
          this.t.x -= e.deltaX;
          this.applyTransform();
        }
      },
      { passive: false },
    );
    vp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragMoved = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: this.t.k };
      }
    });
    vp.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        const rect = vp.getBoundingClientRect();
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const target = clamp((this.pinchStart.k * dist) / this.pinchStart.dist, MIN_K, MAX_K);
        this.zoomBy(target / this.t.k, (a!.x + b!.x) / 2 - rect.left, (a!.y + b!.y) / 2 - rect.top);
        this.dragMoved = true;
        return;
      }
      if (!this.dragMoved && Math.hypot(dx, dy) < 3) return;
      if (!this.dragMoved) {
        this.dragMoved = true;
        vp.setPointerCapture(e.pointerId);
        vp.classList.add('is-panning');
      }
      this.t.x += dx;
      this.t.y += dy;
      this.applyTransform();
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchStart = null;
      vp.classList.remove('is-panning');
      if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
      // Let the click handler see dragMoved, then reset.
      setTimeout(() => (this.dragMoved = false), 0);
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
  }

  // --- Keyboard ---------------------------------------------------------------

  private bindKeys() {
    this.viewport.addEventListener('keydown', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('.card');
      const id = target?.dataset['id'];
      if (!id) return;
      const n = this.store.index.node(id);
      const open = this.store.state.expanded.has(id);
      let next: string | null = null;
      switch (e.key) {
        case 'ArrowRight':
          if (n.kind === 'topic' && !open && n.childIds.length > 0) this.toggleFromCanvas(id);
          else next = this.store.visibleChildren(id)[0] ?? null;
          break;
        case 'ArrowLeft':
          if (n.kind === 'topic' && open) this.store.setExpanded(id, false);
          else next = n.parentId;
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          next = this.neighbor(id, e.key === 'ArrowUp' ? -1 : 1);
          break;
        case 'Home':
          next = this.store.index.root.id;
          break;
        case 'Enter':
        case ' ':
          this.store.select(id);
          if (n.kind === 'topic' && e.key === 'Enter' && e.shiftKey) this.toggleFromCanvas(id);
          break;
        default:
          return;
      }
      e.preventDefault();
      if (next) {
        this.store.select(next, { center: true });
        queueMicrotask(() =>
          queueMicrotask(() => this.cards.get(next!)?.querySelector<HTMLElement>('.card-main')?.focus()),
        );
      }
    });
  }

  /** Nearest drawn node in the same column, above or below. */
  private neighbor(id: string, dir: -1 | 1): string | null {
    const p = this.positions.get(id);
    if (!p) return null;
    let best: string | null = null;
    let bestDy = Infinity;
    for (const [other, q] of this.positions) {
      if (other === id || q.depth !== p.depth) continue;
      const dy = (q.y - p.y) * dir;
      if (dy > 0 && dy < bestDy) {
        bestDy = dy;
        best = other;
      }
    }
    return best;
  }
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function describeNode(n: MapNode): string {
  if (n.kind === 'root') return `${n.title}. Conversation root.`;
  if (n.kind === 'topic') return `${n.title}. Topic with ${n.childIds.length} entries.`;
  const status = STATUS_LABEL[n.status];
  const flags = [
    n.flags.includes('unsupported') ? 'no verified source' : '',
    n.flags.includes('in-conflict') ? 'in conflict' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `${n.title}. ${CLASSIFICATION_LABEL[n.classification!]}${status ? `, ${status}` : ''}${flags ? `, ${flags}` : ''}.`;
}

function legend(): HTMLElement {
  const entries: [string, string, string][] = [
    ['cls-decision', 'D', 'Decision (current)'],
    ['cls-suggestion', 'S', 'Suggestion (dashed)'],
    ['cls-open-question', '?', 'Question'],
    ['cls-action-item', 'T', 'Action'],
    ['cls-superseded-decision', 'D', 'Superseded / rejected (struck)'],
    ['cls-inference', 'I', 'Inference (dotted)'],
    ['cls-fact', 'F', 'Statement or fact'],
  ];
  return h(
    'details',
    { class: 'legend' },
    h('summary', {}, 'Legend'),
    h(
      'ul',
      {},
      ...entries.map(([cls, glyph, label]) =>
        h('li', { class: `legend-item ${cls}` }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph), label),
      ),
      h(
        'li',
        { class: 'legend-item' },
        h('span', { class: 'legend-line rel', 'aria-hidden': 'true' }),
        'Relationship of selected node',
      ),
    ),
  );
}
