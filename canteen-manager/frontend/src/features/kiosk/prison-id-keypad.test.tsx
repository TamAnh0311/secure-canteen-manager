import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { PrisonIdKeypad } from './prison-id-keypad';

function renderKeypad(value = '', onChange = vi.fn(), onSubmit = vi.fn()) {
  return render(
    <PrisonIdKeypad value={value} onChange={onChange} onSubmit={onSubmit} />,
  );
}

describe('PrisonIdKeypad — digit appending', () => {
  it('clicking a digit calls onChange with the appended value', async () => {
    const onChange = vi.fn();
    renderKeypad('12', onChange);
    // Digit "5" button
    await userEvent.click(screen.getByRole('button', { name: /chữ số 5/i }));
    expect(onChange).toHaveBeenCalledWith('125');
  });

  it('clicking digit 0 appends 0', async () => {
    const onChange = vi.fn();
    renderKeypad('3', onChange);
    await userEvent.click(screen.getByRole('button', { name: /chữ số 0/i }));
    expect(onChange).toHaveBeenCalledWith('30');
  });
});

describe('PrisonIdKeypad — backspace', () => {
  it('backspace removes the last character', async () => {
    const onChange = vi.fn();
    renderKeypad('123', onChange);
    await userEvent.click(screen.getByRole('button', { name: /xóa ký tự cuối/i }));
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('backspace on empty value stays empty', async () => {
    const onChange = vi.fn();
    renderKeypad('', onChange);
    await userEvent.click(screen.getByRole('button', { name: /xóa ký tự cuối/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('PrisonIdKeypad — clear', () => {
  it('clear resets value to empty string', async () => {
    const onChange = vi.fn();
    renderKeypad('9876', onChange);
    await userEvent.click(screen.getByRole('button', { name: /xóa toàn bộ/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('PrisonIdKeypad — submit', () => {
  it('submit fires with the current value', async () => {
    const onSubmit = vi.fn();
    renderKeypad('42', vi.fn(), onSubmit);
    await userEvent.click(screen.getByRole('button', { name: /xác nhận/i }));
    expect(onSubmit).toHaveBeenCalledWith('42');
  });

  it('submit button is disabled when value is empty', () => {
    renderKeypad('', vi.fn(), vi.fn());
    const submitBtn = screen.getByRole('button', { name: /xác nhận/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submit button is enabled when value is non-empty', () => {
    renderKeypad('7', vi.fn(), vi.fn());
    const submitBtn = screen.getByRole('button', { name: /xác nhận/i });
    expect(submitBtn).not.toBeDisabled();
  });
});
