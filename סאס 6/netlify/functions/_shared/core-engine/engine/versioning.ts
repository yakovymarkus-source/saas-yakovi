export const ENGINE_VERSION = '1.0.0' as const;
export type EngineVersion = typeof ENGINE_VERSION;

export function buildVersionedKey(inputHash: string, version: string = ENGINE_VERSION): string {
  return `${version}:${inputHash}`;
}
