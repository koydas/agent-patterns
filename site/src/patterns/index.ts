import type { PatternSim } from '../engine/types';
import { acTraceability } from './ac-traceability';
import { boundedFeedbackInjection } from './bounded-feedback-injection';
import { checkpointResume } from './checkpoint-resume';
import { criticPair } from './critic-pair';
import { escalationLadder } from './escalation-ladder';
import { evalGateRatchet } from './eval-gate-ratchet';
import { fanOut } from './fan-out';
import { humanGate } from './human-gate';
import { labelDrivenStateMachine } from './label-driven-state-machine';
import { loopWithGuard } from './loop-with-guard';
import { readOnlyMetaLoop } from './read-only-meta-loop';
import { reflexiveLoop } from './reflexive-loop';
import { resumableApprovalGate } from './resumable-approval-gate';
import { router } from './router';
import { sequentialPipeline } from './sequential-pipeline';
import { speculativeRace } from './speculative-race';
import { stagedPromptSeparation } from './staged-prompt-separation';
import { statefulUpgradeVerification } from './stateful-upgrade-verification';
import { toolGroundedReview } from './tool-grounded-review';
import { typedEvidenceChain } from './typed-evidence-chain';
import { validatorFirst } from './validator-first';

/** One simulation per pattern directory; src/test/registry.test.ts checks the set matches patterns/. */
export const ALL: PatternSim[] = [
  sequentialPipeline, router, labelDrivenStateMachine, escalationLadder, fanOut, speculativeRace,
  validatorFirst, loopWithGuard, evalGateRatchet, toolGroundedReview, criticPair, acTraceability,
  typedEvidenceChain, humanGate, resumableApprovalGate, boundedFeedbackInjection,
  statefulUpgradeVerification, checkpointResume, stagedPromptSeparation, reflexiveLoop, readOnlyMetaLoop,
];
export const SIMS: Record<string, PatternSim> = Object.fromEntries(ALL.map((s) => [s.slug, s]));
