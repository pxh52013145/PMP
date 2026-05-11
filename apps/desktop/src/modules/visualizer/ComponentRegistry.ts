import type { VisualizerComponent, VisualizerComponentDefinition } from './types';

export class ComponentRegistry {
  private readonly definitions = new Map<string, VisualizerComponentDefinition>();

  register(definition: VisualizerComponentDefinition): void {
    const id = definition.manifest.id.trim();
    if (!id) {
      throw new Error('[ComponentRegistry] manifest.id is required');
    }
    if (this.definitions.has(id)) {
      throw new Error(`[ComponentRegistry] duplicate component id: ${id}`);
    }
    this.definitions.set(id, definition);
  }

  registerMany(definitions: VisualizerComponentDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  get(id: string): VisualizerComponentDefinition | null {
    return this.definitions.get(id) ?? null;
  }

  create(id: string): VisualizerComponent | null {
    const definition = this.get(id);
    if (!definition) return null;
    return definition.create();
  }

  list(): VisualizerComponentDefinition[] {
    return [...this.definitions.values()];
  }

  dispose(): void {
    this.definitions.clear();
  }
}
