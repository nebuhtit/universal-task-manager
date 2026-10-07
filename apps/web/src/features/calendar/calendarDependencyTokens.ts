/** Exact, collision-free content tokens. Immutable object hits avoid repeated
 * serialization; a cloned-but-equal item keeps its token. Scoped to one evaluator.
 * Never trust revision alone (imports and optimistic drafts may retain it).
 */
export function createCalendarDependencyTokens() {
  let next = 0;
  let characters = 0;
  const objects = new WeakMap<object, number>();
  const latest = new Map<string, { json: string | undefined; token: number }>();
  return (key: string, value: object): number => {
    const hit = objects.get(value);
    if (hit !== undefined) return hit;
    const json = JSON.stringify(value);
    const prior = latest.get(key);
    const token = prior?.json === json ? prior.token : ++next;
    if (prior) characters -= prior.json?.length ?? 0;
    latest.delete(key);
    while (latest.size && (latest.size >= 20_000 || characters + (json?.length ?? 0) > 2_000_000)) {
      const oldest = latest.keys().next().value!;
      characters -= latest.get(oldest)!.json?.length ?? 0;
      latest.delete(oldest);
    }
    // Very large notes still work; do not retain their serialized contents.
    if ((json?.length ?? 0) > 2_000_000) { objects.set(value, token); return token; }
    latest.set(key, { json, token });
    characters += json?.length ?? 0;
    objects.set(value, token);
    return token;
  };
}
