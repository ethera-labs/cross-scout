import type { Xt } from '@cross-scout/sdk';
import { STAGE_ROLLED_BACK } from '@cross-scout/sdk';
import { clock, timeAgo } from '../lib/format';

interface Step {
  title: string;
  copy: string;
  at: string | null;
  /** Milestones without an on-chain signal render as a single annotated hop. */
  offchain?: boolean;
}

/**
 * Observable lifecycle milestones with their real timestamps. The publisher's
 * 2PC phases (schedule, simulate, vote, decide) happen off-chain and leave no
 * public signal, so they render as one coordination hop instead of fabricated
 * per-stage entries.
 */
function buildSteps(xt: Xt): Step[] {
  const steps: Step[] = [
    {
      title: 'Requested',
      copy: 'Cross-chain request observed on the source rollup.',
      at: xt.firstSeenAt,
    },
  ];
  if (xt.preconfirmedAt) {
    steps.push({
      title: 'Pre-confirmed',
      copy: 'Builder pre-confirmation streamed before the sealing block.',
      at: xt.preconfirmedAt,
    });
  }
  steps.push(
    {
      title: 'Coordinated',
      copy: 'Publisher-led 2PC (schedule, simulate, vote, decide) runs off-chain; its outcome becomes visible at inclusion.',
      at: null,
      offchain: true,
    },
    {
      title: 'Included',
      copy: 'Mailbox writes sealed into the participating L2 blocks.',
      at: xt.includedAt,
    },
    {
      title: 'Superblock proposed',
      copy: 'Settled on L1 through a compose dispute game.',
      at: xt.settledAt,
    },
    {
      title: 'Finalized',
      copy: 'Anchor state registry accepted the superblock.',
      at: xt.finalizedAt,
    },
  );
  return steps;
}

export function Timeline({ xt }: { xt: Xt }) {
  const failed = xt.status === 'failed';
  const rolledBack = xt.stage === STAGE_ROLLED_BACK;
  const steps = buildSteps(xt);
  if (failed) {
    steps.push({
      title: rolledBack ? 'Rolled back' : 'Failed',
      copy: 'The request never reached a sealed inclusion and was rolled back.',
      at: xt.failedAt,
    });
  }

  const firstPending = steps.findIndex((step) => !step.offchain && step.at == null);

  return (
    <div className="timeline">
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        const isFailStep = failed && isLast;
        const done = step.at != null || (step.offchain && xt.includedAt != null);
        const current = !done && !isFailStep && idx === firstPending;
        const stateClass = isFailStep ? 'failed' : done ? 'done' : current ? 'current' : 'upcoming';
        return (
          <div className="timeline-step" key={step.title}>
            <span className={`timeline-rail ${isLast ? 'last' : ''}`} />
            <span className={`timeline-dot ${stateClass}`} />
            <div>
              <div className="timeline-title">
                <strong>{step.title}</strong>
                {step.offchain && <span className="timeline-tag upcoming">OFF-CHAIN</span>}
                {!step.offchain && stateClass !== 'upcoming' && (
                  <span className={`timeline-tag ${stateClass}`}>
                    {isFailStep ? 'FAILED' : current ? 'ACTIVE' : 'DONE'}
                  </span>
                )}
              </div>
              <p>{step.copy}</p>
              <small className="mono">
                {step.at ? `${clock(step.at)} - ${timeAgo(step.at)}` : step.offchain ? 'no public signal' : '-'}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
