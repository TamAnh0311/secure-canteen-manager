import { describe, it, expect, afterEach } from 'vitest';
import i18n from '@/i18n';
import { DEFAULT_LANGUAGE, resolveLanguage } from './resolve-language';

describe('resolveLanguage', () => {
  afterEach(() => localStorage.clear());

  it('defaults to Vietnamese', () => {
    localStorage.clear();
    expect(DEFAULT_LANGUAGE).toBe('vi');
    expect(resolveLanguage()).toBe('vi');
  });

  it('honors a persisted English choice', () => {
    localStorage.setItem('canteen.lang', 'en');
    expect(resolveLanguage()).toBe('en');
  });

  it('ignores an unsupported stored value', () => {
    localStorage.setItem('canteen.lang', 'fr');
    expect(resolveLanguage()).toBe('vi');
  });
});

describe('i18n instance', () => {
  it('initializes with Vietnamese by default', () => {
    expect(i18n.language).toBe('vi');
  });

  it('renders the key (fallback) for a missing translation', () => {
    expect(i18n.t('common:__definitely_missing__')).toBe('__definitely_missing__');
  });
});
