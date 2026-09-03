import { apiFetch } from '@/lib/api-client';
import type {
  FormTemplateMode,
  ItemCategory,
  MenuFormStatus,
  MenuItem,
  MenuItemSummary,
} from '@/lib/types';

// The menu is a single global list — no session scope.
export function listMenu(): Promise<MenuItem[]> {
  return apiFetch<MenuItem[]>('/menu');
}

export function createMenuItem(name: string, price: number, category: ItemCategory): Promise<MenuItem> {
  return apiFetch<MenuItem>('/menu', {
    method: 'POST',
    body: JSON.stringify({ name, price, category }),
  });
}

export function updateMenuItem(
  itemId: string,
  body: { name?: string; price?: number; category?: ItemCategory; isActive?: boolean },
): Promise<MenuItem> {
  return apiFetch<MenuItem>(`/menu/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// Returns void — backend responds 204.
export function removeMenuItem(itemId: string): Promise<void> {
  return apiFetch<void>(`/menu/${itemId}`, { method: 'DELETE' });
}

export function reorderMenu(orderedItemIds: string[]): Promise<MenuItem[]> {
  return apiFetch<MenuItem[]>('/menu/reorder', {
    method: 'POST',
    body: JSON.stringify({ orderedItemIds }),
  });
}

// Kitchen summary for a single service date (defaults to today server-side).
export function getSummary(date?: string): Promise<MenuItemSummary[]> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return apiFetch<MenuItemSummary[]>(`/menu/summary${qs}`);
}

// Form-generation status. generatedAt non-null = menu locked (reorder/rename/
// hard-delete disabled), so the UI reads this rather than guessing.
export function getForm(): Promise<MenuFormStatus> {
  return apiFetch<MenuFormStatus>('/menu/form');
}

// Generates one A5 calibration template without replacing the other mode.
export function generateForm(mode: FormTemplateMode): Promise<{ pdfBase64: string }> {
  return apiFetch<{ pdfBase64: string }>('/menu/form', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}
