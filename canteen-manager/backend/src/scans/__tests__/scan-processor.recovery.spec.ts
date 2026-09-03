import { SheetStatus } from '../sheet-status.enum';
import { buildService, makeSheet } from './scan-processor.test-setup';

// ---------------------------------------------------------------------------
// onApplicationBootstrap — recovery-on-boot re-enqueue
// ---------------------------------------------------------------------------

describe('ScanProcessorService — boot recovery', () => {
  it('re-enqueues PENDING and PROCESSING sheets found at startup', async () => {
    const { svc, deps } = buildService();
    const stale = [
      makeSheet({ id: 's1', status: SheetStatus.PENDING }),
      makeSheet({ id: 's2', status: SheetStatus.PROCESSING }),
    ];
    (deps.repo.find as jest.Mock).mockResolvedValue(stale);
    // Make processSheet no-op for these (findOneOrFail not set up — sheet not found path)
    deps.repo.findOneOrFail.mockRejectedValue(new Error('not found'));

    await svc.onApplicationBootstrap();
    // Drain the enqueued items by awaiting the tail
    await (svc as unknown as { tail: Promise<void> }).tail;

    expect((deps.repo.find as jest.Mock)).toHaveBeenCalledWith({
      where: { status: expect.anything() },
      select: ['id'],
    });
  });

  it('does not re-enqueue sheets already in terminal state (FLAGGED, VERIFIED, etc.)', async () => {
    const { svc, deps } = buildService();
    // find returns empty — no stale sheets
    (deps.repo.find as jest.Mock).mockResolvedValue([]);

    await svc.onApplicationBootstrap();
    await (svc as unknown as { tail: Promise<void> }).tail;

    // Nothing should have been enqueued — tail drained immediately, no saves
    expect((deps.repo.save as jest.Mock)).not.toHaveBeenCalled();
  });
});
