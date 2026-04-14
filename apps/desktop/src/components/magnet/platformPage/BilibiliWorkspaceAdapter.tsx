import type { BilibiliWorkspaceProps } from './BilibiliWorkspace';
import { BilibiliWorkspace } from './BilibiliWorkspace';

export interface BilibiliWorkspaceToolbarProps {}

export function BilibiliWorkspaceToolbar(_: BilibiliWorkspaceToolbarProps): JSX.Element {
  return <></>;
}

export function BilibiliWorkspaceAdapter(props: BilibiliWorkspaceProps): JSX.Element {
  return <BilibiliWorkspace {...props} />;
}
