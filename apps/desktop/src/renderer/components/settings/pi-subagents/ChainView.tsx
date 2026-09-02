import type { PiChainDef } from '@/../main/pi-agent/piTypes';
import { Box, Users } from 'lucide-react';

import { useTranslation } from 'react-i18next';

interface ChainViewProps {
  chain: PiChainDef;
}

function StepIcon({ agent }: { agent: string }) {
  const isParallel = agent.includes('|');
  if (isParallel) return <Users className="h-4 w-4" style={{ color: 'var(--purple, #a855f7)' }} />;
  return <Box className="h-4 w-4" style={{ color: 'var(--accent-emphasis)' }} />;
}

export function ChainView({ chain }: ChainViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h2
        className="text-base font-semibold"
        style={{ color: 'var(--settings-text-primary)' }}
      >
        {chain.name}
      </h2>
      <p className="text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
        {chain.description}
      </p>

      <div className="space-y-3">
        <span
          className="text-xs font-medium"
          style={{ color: 'var(--settings-text-tertiary)' }}
        >
          {t('settings.piSubagents.pipeline')}
        </span>
        <div className="relative">
          <div
            className="absolute left-4 top-2 bottom-2 w-0.5"
            style={{ backgroundColor: 'var(--settings-border)' }}
          />

          {chain.steps.map((step, i) => (
            <div key={i} className="relative flex items-start gap-4 pb-4 last:pb-0">
              <div
                className="z-10 flex h-8 w-8 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'var(--settings-border)',
                  backgroundColor: 'var(--settings-bg-secondary)',
                }}
              >
                <StepIcon agent={step.agent} />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <p
                  className="text-sm"
                  style={{ color: 'var(--settings-text-primary)' }}
                >
                  {step.agent.split('|').map((a, j) => (
                    <span key={j}>
                      {j > 0 && (
                        <span
                          className="mx-1"
                          style={{ color: 'var(--settings-text-tertiary)' }}
                        >
                          |
                        </span>
                      )}
                      <code
                        className="rounded px-1 py-0.5 font-mono text-xs"
                        style={{
                          backgroundColor: 'var(--settings-bg-tertiary)',
                          color: 'var(--accent-emphasis)',
                        }}
                      >
                        {a.trim()}
                      </code>
                    </span>
                  ))}
                </p>
                <div
                  className="mt-1 flex flex-wrap gap-2 text-xs"
                  style={{ color: 'var(--settings-text-tertiary)' }}
                >
                  {step.phase && (
                    <span>
                      {t('settings.piSubagents.phase')}: {step.phase}
                    </span>
                  )}
                  {step.label && (
                    <span>
                      {t('settings.piSubagents.label')}: {step.label}
                    </span>
                  )}
                  {step.output && (
                    <span>
                      {t('settings.piSubagents.output')}: {step.output}
                    </span>
                  )}
                </div>
              </div>
              <span
                className="shrink-0 text-xs"
                style={{ color: 'var(--settings-text-tertiary)' }}
              >
                #{i + 1}
              </span>
            </div>
          ))}
        </div>
      </div>

      {chain.body && (
        <div>
          <span
            className="text-xs"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSubagents.chainBody')}
          </span>
          <pre
            className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border p-3 whitespace-pre-wrap font-mono text-xs"
            style={{
              borderColor: 'var(--settings-border)',
              backgroundColor: 'var(--settings-bg-tertiary)',
              color: 'var(--settings-text-secondary)',
            }}
          >
            {chain.body}
          </pre>
        </div>
      )}
    </div>
  );
}
