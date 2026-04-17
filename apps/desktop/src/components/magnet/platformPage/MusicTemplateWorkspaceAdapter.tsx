import type { MusicTemplateWorkspaceProps } from './MusicTemplateWorkspace';
import { MusicTemplateWorkspace } from './MusicTemplateWorkspace';

export type MusicTemplateWorkspaceToolbarProps = Record<string, never>;

export function MusicTemplateWorkspaceToolbar(): JSX.Element | null {
  return null;
}

export function MusicTemplateWorkspaceAdapter(props: MusicTemplateWorkspaceProps): JSX.Element {
  return <MusicTemplateWorkspace {...props} />;
}
