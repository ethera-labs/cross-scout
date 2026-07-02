import type { Xt } from '@cross-scout/sdk';
import { clock, stageName } from '../lib/format';

const lifecycleStages = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function timelineCopy(stage: string): string {
  switch (stage) {
    case 'requested':
      return 'XTRequest accepted by the host rollup.';
    case 'scheduled':
      return 'Shared Publisher assigned the period and instance sequence.';
    case 'simulating':
      return 'Participating sequencers exchanged mailbox reads.';
    case 'voting':
      return '2PC votes collected from participating sequencers.';
    case 'decided':
      return 'Shared Publisher broadcast the commit decision.';
    case 'included':
      return 'Writes sealed into the participating L2 blocks.';
    case 'settled':
      return 'Block range tagged into the superblock batch.';
    case 'validated':
      return 'Aggregated proof validated for the superblock.';
    default:
      return 'Final state anchored on L1 settlement.';
  }
}

export function Timeline({ xt }: { xt: Xt }) {
  const completed = xt.status === 'failed' ? Math.min(xt.stage, 5) : Math.min(xt.stage, 9);
  return (
    <div className="timeline">
      {lifecycleStages.map((step, idx) => {
        const name = stageName(step);
        const failed = xt.status === 'failed' && step === completed;
        const done = step < completed || (step === completed && xt.status === 'finalized');
        const current = step === completed && xt.status !== 'finalized' && !failed;
        const stateClass = failed ? 'failed' : done ? 'done' : current ? 'current' : 'upcoming';
        return (
          <div className="timeline-step" key={step}>
            <span className={`timeline-rail ${idx === lifecycleStages.length - 1 ? 'last' : ''}`} />
            <span className={`timeline-dot ${stateClass}`} />
            <div>
              <div className="timeline-title">
                <strong>{name}</strong>
                {stateClass !== 'upcoming' && (
                  <span className={`timeline-tag ${stateClass}`}>
                    {failed ? 'FAILED' : current ? 'ACTIVE' : 'DONE'}
                  </span>
                )}
              </div>
              <p>{timelineCopy(name)}</p>
              <small className="mono">{stateClass === 'upcoming' ? '-' : clock(xt.updatedAt)}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
