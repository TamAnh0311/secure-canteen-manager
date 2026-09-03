import { useTranslation } from 'react-i18next';

export type ReviewStepStatus = 'complete' | 'attention' | 'blocked';

interface ReviewStepGuideProps {
  identityStatus: ReviewStepStatus;
  itemsStatus: ReviewStepStatus;
  actionStatus: ReviewStepStatus;
  currentStep: 'identity' | 'items' | 'actions';
  onSelect: (target: 'identity' | 'items' | 'actions') => void;
}

const statusClass: Record<ReviewStepStatus, string> = {
  complete: 'border-success/40 bg-success-bg text-success',
  attention: 'border-warning/50 bg-warning-bg text-warning-fg',
  blocked: 'border-danger/40 bg-danger-bg text-danger',
};

export function ReviewStepGuide({
  identityStatus,
  itemsStatus,
  actionStatus,
  currentStep,
  onSelect,
}: ReviewStepGuideProps) {
  const { t } = useTranslation('verify');
  const steps = [
    { id: 'identity' as const, status: identityStatus, label: t('reviewStepIdentity') },
    { id: 'items' as const, status: itemsStatus, label: t('reviewStepItems') },
    { id: 'actions' as const, status: actionStatus, label: t('reviewStepActions') },
  ];

  return (
    <nav className="border-b border-border bg-card px-5 py-3" aria-label={t('reviewStepsLabel')}>
      <ol className="grid grid-cols-3 gap-2">
        {steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              aria-current={currentStep === step.id ? 'step' : undefined}
              className={[
                'flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                statusClass[step.status],
              ].join(' ')}
              onClick={() => onSelect(step.id)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">
                {step.status === 'complete' ? '✓' : '•'}
              </span>
              <span>
                <span className="block">{step.label}</span>
                <span className="block text-xs font-normal">{t(`reviewStepStatus.${step.status}`)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
