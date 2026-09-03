import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RejectConfirmationDialog } from './reject-confirmation-dialog';

describe('RejectConfirmationDialog', () => {
  it('requires the explicit destructive confirmation before rejecting', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RejectConfirmationDialog
        open
        saving={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /tiếp tục kiểm tra/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^từ chối phiếu$/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
