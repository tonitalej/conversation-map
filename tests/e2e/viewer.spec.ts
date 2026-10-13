import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXAMPLE_HTML = join(import.meta.dirname, '../../examples/launch-planning/output/map.html');
const URL_ = pathToFileURL(EXAMPLE_HTML).href;

const inspectorTitle = (page: Page) => page.locator('#inspector-title');
const card = (page: Page, id: string) => page.locator(`.card[data-id="${id}"] .card-main`);

let problems: string[];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => {
    problems.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
});

test.afterEach(() => {
  expect(problems, 'no console errors, CSP violations, or dialogs').toEqual([]);
});

test('boots into the workspace with the overview selected', async ({ page }) => {
  await page.goto(URL_);
  await expect(page.locator('body')).toHaveClass(/cm-ready/);
  await expect(page.locator('.doc-title')).toHaveText('Notely 2.0 launch planning');
  await expect(inspectorTitle(page)).toHaveText('Notely 2.0 launch planning');
  await expect(page.locator('#static-outline')).toBeHidden();
  await expect(page.getByRole('tree', { name: 'Topics' }).getByRole('treeitem').first()).toBeVisible();
});

test('selecting a card shows its details and evidence and updates the deep link', async ({ page }) => {
  await page.goto(URL_);
  await card(page, 'pricing').click();
  await expect(inspectorTitle(page)).toHaveText('Pricing');
  await page.locator('.card[data-id="pricing"] .card-toggle').click();
  await card(page, 'pricing-two-tiers').click();
  await expect(inspectorTitle(page)).toContainText('two');
  await expect(page.locator('.inspector .evidence-item .verify.ok').first()).toHaveText('Verified quote');
  expect(new URL(page.url()).hash).toBe('#node=pricing-two-tiers');
});

test('deep link opens a node; relationship and parent navigation work', async ({ page }) => {
  await page.goto(`${URL_}#node=launch-march-3`);
  await expect(inspectorTitle(page)).toContainText('March 3');
  await expect(page.locator('.inspector')).toContainText('Not current');
  await page.locator('.inspector .callout [data-goto="launch-march-17"]').click();
  await expect(inspectorTitle(page)).toContainText('March 17');
  await expect(page.locator('.card[data-id="launch-march-3"]')).toHaveClass(/is-related/);
  await page.locator('[data-action="parent"]').click();
  await expect(inspectorTitle(page)).toHaveText('Launch date');
});

test('expand all and collapse all change what the canvas shows', async ({ page }) => {
  await page.goto(URL_);
  await page.locator('[data-action="collapse-all"]').click();
  await expect(page.locator('.card')).toHaveCount(7);
  await page.locator('[data-action="expand-all"]').click();
  await expect(page.locator('.card')).toHaveCount(29);
});

test('search finds entries, steps through results, and reports no results', async ({ page }) => {
  await page.goto(URL_);
  const search = page.locator('#cm-search');
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.fill('GDPR');
  await expect(page.locator('#cm-search-count')).toHaveText(/^1 of \d+$/);
  await search.press('Enter');
  await expect(inspectorTitle(page)).toContainText(/GDPR/i);
  await search.fill('zzqx nothing');
  await expect(page.locator('#cm-search-count')).toHaveText('No results');
  await search.press('Escape');
  await expect(search).toHaveValue('');
});

test('filter presets narrow the map and clear restores it', async ({ page }) => {
  await page.goto(URL_);
  await page.locator('[data-action="filters"]').click();
  const panel = page.locator('#cm-filters');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Open questions' }).click();
  await expect(page.locator('[data-action="filters"]')).toContainText('Filters (1)');
  const items = page.locator('.card.kind-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveClass(/cls-open-question/);
  await panel.locator('[data-action="clear-filters"]').click();
  await expect(page.locator('[data-action="filters"]')).toHaveText('Filters');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('explorer tree supports keyboard navigation', async ({ page }) => {
  await page.goto(URL_);
  const tree = page.getByRole('tree', { name: 'Topics' });
  const first = tree.locator('[role="treeitem"][data-id="pricing"]');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(inspectorTitle(page)).not.toHaveText('Pricing');
  await expect(inspectorTitle(page)).not.toHaveText('Notely 2.0 launch planning');
});

test('canvas keyboard navigation and zoom controls', async ({ page }) => {
  await page.goto(URL_);
  await card(page, 'root').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(inspectorTitle(page)).not.toHaveText('Notely 2.0 launch planning');
  const zoom = page.locator('.zoom-level');
  await page.locator('[data-action="reset"]').click();
  await expect(zoom).toHaveText('100%');
  await page.locator('[data-action="zoom-in"]').click();
  await expect(zoom).toHaveText('120%');
  await page.locator('[data-action="fit"]').click();
  await expect(zoom).not.toHaveText('120%');
});

test('untrusted transcript HTML is shown as text, never executed', async ({ page }) => {
  await page.goto(`${URL_}#node=customer-sync-feedback`);
  await expect(inspectorTitle(page)).toBeVisible();
  const toggle = page.locator('.inspector').getByRole('button', { name: 'Show full message' }).first();
  await toggle.click();
  const full = page.locator('.inspector .message-full').first();
  await expect(full).toContainText('<script>');
  await expect(full).toContainText('ignore previous instructions');
  expect(await page.locator('.inspector img, .app script, .inspector iframe').count()).toBe(0);
});

test('exports download Markdown, JSON and a working HTML copy', async ({ page }, info) => {
  await page.goto(URL_);
  const grab = async (label: string) => {
    await page.locator('[data-action="export"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-export="${label}"]`).click()]);
    const path = info.outputPath(dl.suggestedFilename());
    await dl.saveAs(path);
    return { name: dl.suggestedFilename(), text: readFileSync(path, 'utf8'), path };
  };
  const md = await grab('Markdown');
  expect(md.name).toBe('notely-2-0-launch-planning.md');
  expect(md.text).toContain('## Overview');
  const json = await grab('JSON data');
  expect(JSON.parse(json.text).schemaVersion).toBe('1');
  const html = await grab('Interactive HTML');
  const blocks = (s: string) => [...s.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
  expect(blocks(html.text)).toEqual(blocks(readFileSync(EXAMPLE_HTML, 'utf8')));
  expect(html.text).not.toMatch(/<body[^>]*cm-ready/);
  await page.goto(pathToFileURL(html.path).href);
  await expect(page.locator('body')).toHaveClass(/cm-ready/);
  await expect(inspectorTitle(page)).toHaveText('Notely 2.0 launch planning');
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('uses pane tabs and keeps actions accessible', async ({ page }) => {
    await page.goto(URL_);
    const tabs = page.getByRole('tablist', { name: 'Workspace panes' });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
    await tabs.getByRole('tab', { name: /Topics/ }).click();
    await expect(page.getByRole('tree', { name: 'Topics' })).toBeVisible();
    await page.locator('[role="treeitem"][data-id="compliance"]').click();
    await tabs.getByRole('tab', { name: /Details/ }).click();
    await expect(inspectorTitle(page)).toHaveText('Compliance');
  });
});

test.describe('fallbacks', () => {
  test.use({ javaScriptEnabled: false });

  test('without JavaScript the static outline shows the whole map', async ({ page }) => {
    await page.goto(URL_);
    const outline = page.locator('#static-outline');
    await expect(outline).toBeVisible();
    await expect(outline).toContainText('Pricing');
    await expect(outline).toContainText('GDPR');
  });
});

test('corrupted embedded data shows an error and the static outline', async ({ page }) => {
  const html = readFileSync(EXAMPLE_HTML, 'utf8').replace(
    /(<script type="application\/json" id="cm-data">)[\s\S]*?(<\/script>)/,
    '$1{"schemaVersion":"1","nodes":[]}$2',
  );
  const path = join(mkdtempSync(join(tmpdir(), 'cmap-e2e-')), 'broken.html');
  writeFileSync(path, html);
  await page.goto(pathToFileURL(path).href);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#static-outline')).toBeVisible();
  await expect(page.locator('#static-outline-reason')).toContainText('failed to start');
});
