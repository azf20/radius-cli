import type { TypedDataDefinition } from 'viem';

/** Parse EIP-712 typed data: JSON with `types`, `primaryType`, `message` and (usually) `domain`. */
export function parseTypedData(json: string): TypedDataDefinition {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('Typed data must be valid JSON: {"domain":…,"types":…,"primaryType":…,"message":…}');
  }
  for (const key of ['types', 'primaryType', 'message'] as const) {
    if (data[key] === undefined || data[key] === null) throw new Error(`Typed data is missing '${key}'`);
  }
  if (typeof data.primaryType !== 'string') throw new Error("Typed data 'primaryType' must be a string");
  return data as unknown as TypedDataDefinition;
}
