import type { Classification, Evidence, MapNode } from '../core/model.ts';
import {
  CLASSIFICATION_GLYPH,
  CLASSIFICATION_HELP,
  CLASSIFICATION_LABEL,
  FLAG_LABEL,
  RELATION_LABEL,
  SPEAKER_LABEL,
  STATUS_LABEL,
} from '../render/labels.ts';
import { clear, h, icon } from './dom.ts';
import type { Change, Store } from './store.ts';

export class Inspector {
  readonly el: HTMLElement;
  private readonly store: Store;
  private readonly body: HTMLElement;

  constructor(store: Store) {
    this.store = store;
    this.body = h('div', { class: 'inspector-body' });
    this.el = h('aside', { class: 'inspector', 'aria-label': 'Details', tabindex: -1 }, this.body);
    store.subscribe((changes: ReadonlySet<Change>) => {
      if (changes.has('selection') || changes.has('filters')) this.render();
    });
    this.render();
  }

  render() {
    clear(this.body);
    const n = this.store.index.node(this.store.state.selectedId);
    this.body.scrollTop = 0;
    if (n.kind === 'root') this.renderOverview(n);
    else this.renderNode(n);
  }

  private link(id: string, extra?: string): HTMLElement {
    const n = this.store.index.node(id);
    return h(
      'button',
      {
        type: 'button',
        class: 'node-link',
        'data-goto': id,
        onclick: () => this.store.select(id, { center: true, reveal: true }),
      },
      n.kind === 'item' ? chip(n.classification!) : null,
      h('span', { class: 'node-link-title' }, n.title),
      extra ? h('span', { class: 'node-link-extra' }, extra) : null,
    );
  }

  private renderNode(n: MapNode) {
    const store = this.store;
    const crumbs = store.index.ancestors(n.id);
    const nav = h(
      'nav',
      { class: 'crumbs', 'aria-label': 'Location in map' },
      h(
        'ol',
        {},
        ...crumbs.map((a) =>
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', class: 'crumb', onclick: () => store.select(a.id, { center: true }) },
              a.kind === 'root' ? 'Overview' : a.title,
            ),
          ),
        ),
      ),
    );
    const parentBtn = n.parentId
      ? h(
          'button',
          {
            type: 'button',
            class: 'ghost-btn',
            'data-action': 'parent',
            onclick: () => store.select(n.parentId!, { center: true }),
          },
          icon('parent'),
          'Parent',
        )
      : null;

    const header = h(
      'header',
      { class: 'inspector-head' },
      h('div', { class: 'inspector-nav' }, nav, parentBtn),
      h('h2', { class: 'inspector-title', id: 'inspector-title' }, n.title),
      h(
        'div',
        { class: 'tags' },
        n.kind === 'topic'
          ? h('span', { class: 'tag tag-topic' }, 'Topic')
          : h(
              'span',
              { class: `tag tag-cls cls-${n.classification!.replace(/_/g, '-')}` },
              chip(n.classification!),
              CLASSIFICATION_LABEL[n.classification!],
            ),
        n.kind === 'item' &&
          STATUS_LABEL[n.status] &&
          !CLASSIFICATION_LABEL[n.classification!].includes(STATUS_LABEL[n.status])
          ? h('span', { class: `tag tag-status status-${n.status}` }, `Status: ${STATUS_LABEL[n.status]}`)
          : null,
        ...n.flags
          .filter((f) => f !== 'merged')
          .map((f) => h('span', { class: `tag tag-flag flag-${f}` }, icon('warning'), FLAG_LABEL[f])),
      ),
    );
    this.body.append(header);

    if (store.filtersActive() && !store.filterVisible().has(n.id)) {
      this.body.append(
        callout('info', 'Hidden by current filters', 'This entry is not shown on the map with the active filters.'),
      );
    }
    for (const c of this.callouts(n)) this.body.append(c);

    if (n.summary) this.body.append(section('Summary', h('p', { class: 'prose' }, n.summary)));
    if (n.detail) this.body.append(section('Details', h('p', { class: 'prose prose-pre' }, n.detail)));

    if (n.kind === 'item') {
      const facts: [string, string][] = [];
      facts.push([
        'Said by',
        n.speakers.length > 0
          ? n.speakers.map((s) => SPEAKER_LABEL[s]).join(', ')
          : 'Not established from a verified quote',
      ]);
      if (n.owner) facts.push(['Owner', n.owner]);
      if (n.due) facts.push(['Due', n.due]);
      this.body.append(
        section(
          'Attribution',
          h('dl', { class: 'facts' }, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        ),
      );
      this.body.append(
        section(
          'Why this classification',
          h('p', { class: 'prose' }, n.rationale ?? 'The analyst did not record a reason.'),
          h(
            'p',
            { class: 'help' },
            `${CLASSIFICATION_LABEL[n.classification!]}: ${CLASSIFICATION_HELP[n.classification!]}`,
          ),
        ),
      );
    }

    this.body.append(section(`Evidence (${n.evidence.length})`, this.evidenceList(n.evidence)));

    const rels = store.index.relationsOf.get(n.id) ?? [];
    if (rels.length > 0) {
      const groups = new Map<string, HTMLElement[]>();
      for (const r of rels) {
        const outgoing = r.from === n.id;
        const label = outgoing ? RELATION_LABEL[r.type].out : RELATION_LABEL[r.type].in;
        const list = groups.get(label) ?? [];
        list.push(h('li', {}, this.link(outgoing ? r.to : r.from), r.note ? h('p', { class: 'help' }, r.note) : null));
        groups.set(label, list);
      }
      this.body.append(
        section(
          `Relationships (${rels.length})`,
          ...[...groups].map(([label, items]) =>
            h('div', { class: 'rel-group' }, h('h4', {}, label), h('ul', { class: 'link-list' }, ...items)),
          ),
        ),
      );
    }

    if (n.childIds.length > 0) {
      this.body.append(
        section(
          `Contents (${n.childIds.length})`,
          h('ul', { class: 'link-list' }, ...n.childIds.map((c) => h('li', {}, this.link(c)))),
        ),
      );
    }

    const diags = store.index.map.diagnostics.filter((d) => d.node === n.id && d.level !== 'info');
    if (diags.length > 0) {
      this.body.append(
        section(
          'Validation notes',
          h(
            'ul',
            { class: 'diag-list' },
            ...diags.map((d) => h('li', { class: `diag diag-${d.level}` }, d.repaired ? 'Repaired: ' : '', d.message)),
          ),
        ),
      );
    }
  }

  private callouts(n: MapNode): HTMLElement[] {
    const out: HTMLElement[] = [];
    const rels = this.store.index.relationsOf.get(n.id) ?? [];
    if (n.classification === 'inference') {
      out.push(
        callout(
          'info',
          'Interpretation',
          'This was inferred by the analyst. It was not stated explicitly in the conversation.',
        ),
      );
    }
    if (n.classification === 'superseded_decision') {
      const by = rels.filter((r) => r.type === 'supersedes' && r.to === n.id).map((r) => r.from);
      out.push(
        callout(
          'warning',
          'Not current',
          by.length > 0
            ? 'This decision was later replaced by:'
            : 'This decision was later replaced. The replacement is not linked.',
          ...by.map((id) => this.link(id)),
        ),
      );
    }
    if (n.classification === 'suggestion') {
      out.push(callout('info', 'Not a decision', 'This was proposed but not explicitly accepted in the conversation.'));
    }
    if (n.flags.includes('in-conflict')) {
      const others = rels.filter((r) => r.type === 'contradicts').map((r) => (r.from === n.id ? r.to : r.from));
      out.push(callout('warning', 'Unresolved conflict', 'This conflicts with:', ...others.map((id) => this.link(id))));
    }
    if (n.flags.includes('unsupported')) {
      out.push(
        callout(
          'warning',
          'No verified source',
          'No supporting quote could be found in the transcript. Treat this entry with caution.',
        ),
      );
    }
    if (n.flags.includes('attribution-mismatch')) {
      out.push(callout('warning', 'Attribution unclear', 'The supporting quotes come from different speakers.'));
    }
    return out;
  }

  private evidenceList(evidence: Evidence[]): HTMLElement {
    if (evidence.length === 0) return h('p', { class: 'empty' }, 'No source reference available for this entry.');
    return h(
      'ol',
      { class: 'evidence' },
      ...evidence.map((e) => {
        const msg = this.store.index.messages.get(e.messageId);
        const who = e.speaker ? SPEAKER_LABEL[e.speaker] : 'Unknown speaker';
        const label = e.label && e.label.toLowerCase() !== who.toLowerCase() ? ` (${e.label})` : '';
        const full = msg
          ? h('div', { class: 'message-full', hidden: true }, h('p', { class: 'prose prose-pre' }, msg.text))
          : null;
        const toggle = msg
          ? h(
              'button',
              {
                type: 'button',
                class: 'ghost-btn small',
                'aria-expanded': 'false',
                onclick: (ev: Event) => {
                  const btn = ev.currentTarget as HTMLElement;
                  const open = btn.getAttribute('aria-expanded') !== 'true';
                  btn.setAttribute('aria-expanded', String(open));
                  btn.textContent = open ? 'Hide full message' : 'Show full message';
                  full!.hidden = !open;
                },
              },
              'Show full message',
            )
          : null;
        return h(
          'li',
          { class: `evidence-item${e.verified ? '' : ' unverified'}` },
          h(
            'div',
            { class: 'evidence-meta' },
            h('span', { class: `speaker speaker-${e.speaker ?? 'other'}` }, who + label),
            h(
              'span',
              { class: 'msg-ref' },
              `Message ${e.messageId}${e.index !== undefined ? ` · #${e.index + 1}` : ''}`,
            ),
            msg?.timestamp ? h('span', { class: 'msg-ref' }, msg.timestamp) : null,
            h(
              'span',
              { class: `verify ${e.verified ? 'ok' : 'no'}` },
              e.verified ? 'Verified quote' : 'Quote not found in source',
            ),
          ),
          h('blockquote', { class: 'quote' }, e.quote),
          toggle,
          full,
        );
      }),
    );
  }

  private renderOverview(root: MapNode) {
    const { map } = this.store.index;
    const s = map.stats;
    const count = (c: Classification) => s.byClassification[c] ?? 0;
    this.body.append(
      h(
        'header',
        { class: 'inspector-head' },
        h('p', { class: 'eyebrow' }, 'Overview'),
        h('h2', { class: 'inspector-title', id: 'inspector-title' }, root.title),
        h(
          'p',
          { class: 'help' },
          `${s.messages} messages analyzed · coverage ${map.coverage.status}`,
          map.coverage.status === 'partial' ? ' (some content may be missing)' : '',
        ),
      ),
    );
    if (map.coverage.note)
      this.body.append(callout(map.coverage.status === 'partial' ? 'warning' : 'info', 'Coverage', map.coverage.note));

    const stat = (value: number, label: string, cls: string, filter?: () => void) =>
      h(
        'button',
        {
          type: 'button',
          class: `stat ${cls}`,
          onclick: filter,
          disabled: !filter || value === 0,
          'aria-label': `${value} ${label}${filter ? ', show only these' : ''}`,
        },
        h('span', { class: 'stat-value' }, String(value)),
        h('span', { class: 'stat-label' }, label),
      );
    const only = (c: Classification) => () => {
      this.store.setFilters((f) => {
        f.classes = new Set([c]);
        f.statuses.clear();
        f.flags.clear();
      });
    };
    this.body.append(
      h(
        'div',
        { class: 'stats' },
        stat(count('decision'), 'Current decisions', 'cls-decision', only('decision')),
        stat(count('open_question'), 'Open questions', 'cls-open-question', only('open_question')),
        stat(count('action_item'), 'Pending actions', 'cls-action-item', only('action_item')),
        stat(count('completed_action'), 'Completed actions', 'cls-completed-action', only('completed_action')),
      ),
    );

    const list = (title: string, classes: Classification[], empty: string) => {
      const nodes = this.store.index.order.filter((n) => n.classification && classes.includes(n.classification));
      return section(
        `${title} (${nodes.length})`,
        nodes.length > 0
          ? h(
              'ul',
              { class: 'link-list' },
              ...nodes.map((n) =>
                h('li', {}, this.link(n.id, [n.owner, n.due].filter(Boolean).join(' · ') || undefined)),
              ),
            )
          : h('p', { class: 'empty' }, empty),
      );
    };
    this.body.append(
      list('Decisions', ['decision'], 'No explicit decisions were recorded.'),
      list('Open questions', ['open_question'], 'No unanswered questions were recorded.'),
      list('Next actions', ['action_item'], 'No pending actions were recorded.'),
    );
    const conflicts = this.store.index.order.filter((n) => n.flags.includes('in-conflict'));
    if (conflicts.length > 0)
      this.body.append(
        section(
          `Unresolved conflicts (${conflicts.length})`,
          h('ul', { class: 'link-list' }, ...conflicts.map((n) => h('li', {}, this.link(n.id)))),
        ),
      );
    const changed = this.store.index.order.filter(
      (n) => n.classification === 'superseded_decision' || n.classification === 'rejected_proposal',
    );
    if (changed.length > 0)
      this.body.append(
        section(
          `Superseded or rejected (${changed.length})`,
          h('ul', { class: 'link-list' }, ...changed.map((n) => h('li', {}, this.link(n.id)))),
        ),
      );

    if (map.analystNotes.length > 0) {
      this.body.append(
        section('Analyst notes', h('ul', { class: 'plain-list' }, ...map.analystNotes.map((t) => h('li', {}, t)))),
      );
    }

    const issues = map.diagnostics.filter((d) => d.level !== 'info');
    const infos = map.diagnostics.filter((d) => d.level === 'info');
    this.body.append(
      section(
        'Source quality',
        h(
          'dl',
          { class: 'facts' },
          h('dt', {}, 'Verified quotes'),
          h('dd', {}, String(s.verifiedEvidence)),
          h('dt', {}, 'Unverified quotes'),
          h('dd', {}, String(s.unverifiedEvidence)),
          h('dt', {}, 'Entries without a verified source'),
          h('dd', {}, String(s.unsupportedItems)),
        ),
        issues.length + infos.length > 0
          ? h(
              'details',
              { class: 'diag-details' },
              h('summary', {}, `Validation log (${issues.length} warnings or repairs, ${infos.length} notes)`),
              h(
                'ul',
                { class: 'diag-list' },
                ...[...issues, ...infos].map((d) =>
                  h(
                    'li',
                    { class: `diag diag-${d.level}` },
                    d.level === 'error' ? 'Repaired: ' : d.level === 'warning' ? 'Warning: ' : 'Note: ',
                    d.message,
                    d.node && this.store.index.byId.has(d.node) ? h('span', {}, ' ', this.link(d.node)) : null,
                  ),
                ),
              ),
            )
          : h('p', { class: 'empty' }, 'No validation problems.'),
      ),
    );
  }
}

function chip(c: Classification): HTMLElement {
  return h('span', { class: `glyph cls-${c.replace(/_/g, '-')}`, 'aria-hidden': 'true' }, CLASSIFICATION_GLYPH[c]);
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'insp-section' }, h('h3', { class: 'insp-h' }, title), ...children);
}

function callout(kind: 'info' | 'warning', title: string, text: string, ...extra: Node[]): HTMLElement {
  return h(
    'div',
    { class: `callout callout-${kind}`, role: kind === 'warning' ? 'note' : null },
    icon(kind === 'warning' ? 'warning' : 'info'),
    h(
      'div',
      {},
      h('strong', {}, title),
      h('p', {}, text),
      extra.length > 0 ? h('div', { class: 'callout-links' }, ...extra) : null,
    ),
  );
}
