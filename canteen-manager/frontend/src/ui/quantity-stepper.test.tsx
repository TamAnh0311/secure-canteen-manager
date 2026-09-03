import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QuantityStepper } from './quantity-stepper';

function renderStepper(props: Partial<Parameters<typeof QuantityStepper>[0]> = {}) {
  const onChange = props.onChange ?? vi.fn();
  render(
    <QuantityStepper
      value={props.value ?? 0}
      onChange={onChange}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      decreaseLabel="decrease"
      increaseLabel="increase"
      size={props.size}
    />,
  );
  return { onChange };
}

describe('QuantityStepper', () => {
  it('renders the current value', () => {
    renderStepper({ value: 4 });
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('increments via the + control', async () => {
    const { onChange } = renderStepper({ value: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'increase' }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('decrements via the − control', async () => {
    const { onChange } = renderStepper({ value: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'decrease' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('disables − at min (default 0) and does not fire', async () => {
    const { onChange } = renderStepper({ value: 0 });
    const minus = screen.getByRole('button', { name: 'decrease' });
    expect(minus).toBeDisabled();
    await userEvent.click(minus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables + at max and does not fire', async () => {
    const { onChange } = renderStepper({ value: 99, max: 99 });
    const plus = screen.getByRole('button', { name: 'increase' });
    expect(plus).toBeDisabled();
    await userEvent.click(plus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('honours a custom min — − disabled when value equals min', () => {
    renderStepper({ value: 1, min: 1 });
    expect(screen.getByRole('button', { name: 'decrease' })).toBeDisabled();
  });

  it('disables both controls when disabled', () => {
    renderStepper({ value: 3, disabled: true });
    expect(screen.getByRole('button', { name: 'decrease' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'increase' })).toBeDisabled();
  });
});
