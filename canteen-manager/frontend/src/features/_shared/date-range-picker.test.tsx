import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DateRangePicker } from './date-range-picker';
import { today, tomorrow } from '@/lib/today';

describe('DateRangePicker', () => {
  it('renders the controlled from/to values', () => {
    render(
      <DateRangePicker value={{ dateFrom: '2026-06-01', dateTo: '2026-06-18' }} onChange={vi.fn()} />,
    );
    const from = screen.getByLabelText(/from|từ ngày/i) as HTMLInputElement;
    const to = screen.getByLabelText(/^to$|đến ngày/i) as HTMLInputElement;
    expect(from.value).toBe('2026-06-01');
    expect(to.value).toBe('2026-06-18');
  });

  // Fixed controlled values (not today()) so a change event always fires: a date input
  // emits no change when the new value equals the current value, which would make these
  // assertions silently pass/fail depending on the wall-clock day the suite runs.
  it('emits a new range when the from date changes', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker value={{ dateFrom: '2026-06-01', dateTo: '2026-06-30' }} onChange={onChange} />,
    );
    const from = screen.getByLabelText(/from|từ ngày/i);
    fireEvent.change(from, { target: { value: '2026-06-10' } });
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-06-10', dateTo: '2026-06-30' });
  });

  it('emits a new range when the to date changes', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker value={{ dateFrom: '2026-06-01', dateTo: '2026-06-30' }} onChange={onChange} />,
    );
    const to = screen.getByLabelText(/^to$|đến ngày/i);
    fireEvent.change(to, { target: { value: '2026-06-20' } });
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-06-01', dateTo: '2026-06-20' });
  });
});

describe('todayRange', () => {
  it('defaults both bounds to today', async () => {
    const { todayRange } = await import('./date-range-picker');
    expect(todayRange()).toEqual({ dateFrom: today(), dateTo: today() });
  });
});

describe('tomorrowRange', () => {
  it('defaults both bounds to tomorrow (the next collection day)', async () => {
    const { tomorrowRange } = await import('./date-range-picker');
    expect(tomorrowRange()).toEqual({ dateFrom: tomorrow(), dateTo: tomorrow() });
  });
});
