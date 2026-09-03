import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useVerifyKeyboard, type VerifyKeyboardHandlers } from './use-verify-keyboard';

// Minimal host component: renders a focusable div so the hook is active and
// keyboard events fired on document bubble through the window listener.
function Harness({ handlers, enabled = true }: { handlers: VerifyKeyboardHandlers; enabled?: boolean }) {
  useVerifyKeyboard(handlers, enabled);
  return <div data-testid="root" tabIndex={0} />;
}

function makeHandlers(): VerifyKeyboardHandlers {
  return {
    onConfirm:          vi.fn(),
    onReject:           vi.fn(),
    onSkip:             vi.fn(),
    onZoomIn:           vi.fn(),
    onZoomOut:          vi.fn(),
    onFit:              vi.fn(),
    onToggleCheatsheet: vi.fn(),
    onTabGroup:         vi.fn(),
  };
}

describe('useVerifyKeyboard — global key bindings', () => {
  let handlers: VerifyKeyboardHandlers;

  beforeEach(() => {
    handlers = makeHandlers();
  });

  it('Enter triggers onConfirm', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('{Enter}');
    expect(handlers.onConfirm).toHaveBeenCalledOnce();
    expect(handlers.onReject).not.toHaveBeenCalled();
  });

  it('r triggers onReject (lowercase)', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('r');
    expect(handlers.onReject).toHaveBeenCalledOnce();
  });

  it('R triggers onReject (uppercase)', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('R');
    expect(handlers.onReject).toHaveBeenCalledOnce();
  });

  it('s triggers onSkip (lowercase)', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('s');
    expect(handlers.onSkip).toHaveBeenCalledOnce();
  });

  it('S triggers onSkip (uppercase)', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('S');
    expect(handlers.onSkip).toHaveBeenCalledOnce();
  });

  it('f triggers onFit (lowercase)', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('f');
    expect(handlers.onFit).toHaveBeenCalledOnce();
  });

  it('F triggers onFit (uppercase)', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('F');
    expect(handlers.onFit).toHaveBeenCalledOnce();
  });

  it('+ triggers onZoomIn', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('+');
    expect(handlers.onZoomIn).toHaveBeenCalledOnce();
  });

  it('= triggers onZoomIn (unshifted + on US keyboard)', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('=');
    expect(handlers.onZoomIn).toHaveBeenCalledOnce();
  });

  it('- triggers onZoomOut', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('-');
    expect(handlers.onZoomOut).toHaveBeenCalledOnce();
  });

  it('? triggers onToggleCheatsheet', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('?');
    expect(handlers.onToggleCheatsheet).toHaveBeenCalledOnce();
  });

  it('Tab calls onTabGroup(1) — forward group navigation', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('{Tab}');
    expect(handlers.onTabGroup).toHaveBeenCalledWith(1);
  });

  it('Shift+Tab calls onTabGroup(-1) — backward group navigation', async () => {
    const user = userEvent.setup();
    render(<Harness handlers={handlers} />);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(handlers.onTabGroup).toHaveBeenCalledWith(-1);
  });

  describe('hook disabled', () => {
    it('no handler fires when enabled=false', async () => {
      const user = userEvent.setup();
      render(<Harness handlers={handlers} enabled={false} />);
      await user.keyboard('{Enter}');
      await user.keyboard('r');
      await user.keyboard('s');
      expect(handlers.onConfirm).not.toHaveBeenCalled();
      expect(handlers.onReject).not.toHaveBeenCalled();
      expect(handlers.onSkip).not.toHaveBeenCalled();
    });
  });

  describe('typing suppression — keys inside a real text input do NOT fire global handlers', () => {
    // Phase 3 has no special editable identity cell. Every text input suppresses
    // global actions; order-line inputs own their editing keys locally.
    it('Enter inside a plain text input does not call onConfirm', async () => {
      const user = userEvent.setup();
      render(
        <>
          <Harness handlers={handlers} />
          <input data-testid="search" type="text" />
        </>,
      );
      await user.click(screen.getByTestId('search'));
      await user.keyboard('{Enter}');
      expect(handlers.onConfirm).not.toHaveBeenCalled();
    });

    it('r inside a plain text input does not call onReject', async () => {
      const user = userEvent.setup();
      render(
        <>
          <Harness handlers={handlers} />
          <input data-testid="search" type="text" />
        </>,
      );
      await user.click(screen.getByTestId('search'));
      await user.keyboard('r');
      expect(handlers.onReject).not.toHaveBeenCalled();
    });

    it('legacy data-verify-cell marker cannot restore an identity-edit shortcut', async () => {
      const user = userEvent.setup();
      render(
        <>
          <Harness handlers={handlers} />
          <input data-testid="cell" type="text" data-verify-cell="true" />
        </>,
      );
      await user.click(screen.getByTestId('cell'));
      await user.keyboard('{Enter}');
      expect(handlers.onConfirm).not.toHaveBeenCalled();
    });
  });
});
