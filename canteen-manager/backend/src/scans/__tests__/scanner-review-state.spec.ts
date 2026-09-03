import { MenuItem } from '../../menu/menu-item.entity';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';
import { evaluateScannerReviewState, scannerCatalogueVersion } from '../scanner-review-state';
import { ScannerArtifactJob, ScannerArtifactJobState } from '../webhook/scanner-artifact-job.entity';

const menu = [{
  id: 'menu-1',
  code: '001',
  name: 'Pho',
  isActive: true,
  category: MenuItemCategory.FOOD,
}] as MenuItem[];

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outcome: 'accepted',
    ma_luu_ky: { value: '000001' },
    buong_giam: { value: 'A1' },
    items: [{
      row_index: 0,
      catalogue_item_id: '001',
      item: { warnings: [] },
      quantity: { value: 2, warnings: [] },
    }],
    artifacts: [],
    warnings: [],
    versions: { catalogue: scannerCatalogueVersion(menu) },
    ...overrides,
  };
}

function artifact(state: ScannerArtifactJobState): ScannerArtifactJob {
  return { artifactId: 'crop-1', state, relativePath: state === ScannerArtifactJobState.AVAILABLE ? 'scanner/crop-1.png' : null } as ScannerArtifactJob;
}

describe('evaluateScannerReviewState', () => {
  it('marks only accepted, identity-safe, current, warning-free evidence as ready', () => {
    expect(evaluateScannerReviewState({
      result: result(),
      identityExactMatch: true,
      menuItems: menu,
      artifactJobs: [],
    })).toEqual({ state: 'ready', blockers: [] });
  });

  it.each([
    ['identity mismatch', { identityExactMatch: false }, 'SCANNER.IDENTITY_UNRESOLVED'],
    ['catalogue drift', { result: result({ versions: { catalogue: 'stale' } }) }, 'SCANNER.CATALOGUE_DRIFT'],
    ['item warning', { result: result({ items: [{ catalogue_item_id: '001', item: { warnings: [{ code: 'uncertain' }] }, quantity: { value: 2, warnings: [] } }] }) }, 'SCANNER.ITEM_0_WARNINGS'],
    ['quantity warning', { result: result({ items: [{ catalogue_item_id: '001', item: { warnings: [] }, quantity: { value: 2, warnings: [{ code: 'uncertain' }] } }] }) }, 'SCANNER.QUANTITY_0_WARNINGS'],
    ['item candidates', { result: result({ items: [{ catalogue_item_id: null, item: { candidates: [{ catalogue_item_id: '001' }], warnings: [] }, quantity: { value: 2, warnings: [] } }] }) }, 'SCANNER.ITEM_0_CANDIDATES'],
    ['quantity candidates', { result: result({ items: [{ catalogue_item_id: '001', item: { warnings: [] }, quantity: { value: null, candidates: [{ value: 2 }], warnings: [] } }] }) }, 'SCANNER.QUANTITY_0_CANDIDATES'],
  ])('does not call %s ready', (_label, override, blocker) => {
    const evaluation = evaluateScannerReviewState({
      result: 'result' in override ? override.result as Record<string, unknown> : result(),
      identityExactMatch: 'identityExactMatch' in override ? Boolean(override.identityExactMatch) : true,
      menuItems: menu,
      artifactJobs: [],
    });
    expect(evaluation.state).toBe('needs_review');
    expect(evaluation.blockers).toContain(blocker);
  });

  it('distinguishes pending evidence from terminal evidence faults', () => {
    const withArtifact = result({ artifacts: [{ artifact_id: 'crop-1' }] });
    expect(evaluateScannerReviewState({
      result: withArtifact,
      identityExactMatch: true,
      menuItems: menu,
      artifactJobs: [artifact(ScannerArtifactJobState.RETRYING)],
    }).state).toBe('evidence_pending');
    expect(evaluateScannerReviewState({
      result: withArtifact,
      identityExactMatch: true,
      menuItems: menu,
      artifactJobs: [artifact(ScannerArtifactJobState.INTEGRITY_FAULT)],
    }).state).toBe('evidence_fault');
  });

  it('treats an available artifact without a manager-owned path as an evidence fault', () => {
    const withArtifact = result({ artifacts: [{ artifact_id: 'crop-1' }] });
    expect(evaluateScannerReviewState({
      result: withArtifact,
      identityExactMatch: true,
      menuItems: menu,
      artifactJobs: [{ ...artifact(ScannerArtifactJobState.AVAILABLE), relativePath: null }],
    })).toEqual(expect.objectContaining({ state: 'evidence_fault', blockers: ['SCANNER.EVIDENCE_FAULT'] }));
  });
});
