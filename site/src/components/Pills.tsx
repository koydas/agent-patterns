import { STATUS_LABEL, type Status } from '../content/types';

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill st-${status}`}>{STATUS_LABEL[status]}</span>;
}
