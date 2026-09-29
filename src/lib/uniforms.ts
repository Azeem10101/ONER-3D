/**
 * MUTABLE UNIFORM BAGS
 * ====================
 * A thin class wrapper around shader uniforms.
 *
 * ## Why not a plain object
 *
 * Because the React Compiler's immutability lint rule rejects mutating a value
 * produced by `useMemo`, and it is right to: a plain object is invisible to
 * the dependency tracker, so anything derived from it would be memoised
 * incorrectly. Shader uniforms are exactly the case that rule cannot model —
 * they are an external system that the render loop legitimately writes to
 * every frame.
 *
 * Methods on a class instance the compiler can follow, so this is both
 * lint-clean and correct. Same approach as `QualityStore` in scene/quality.ts.
 *
 * The uniforms object itself is still handed to the material verbatim — the
 * material holds a reference to these exact value objects and reads them at
 * draw time.
 */
export class Uniforms<T extends Record<string, { value: unknown }>> {
  readonly values: T;

  constructor(values: T) {
    this.values = values;
  }

  get(name: keyof T): T[keyof T]["value"] {
    return this.values[name].value as T[keyof T]["value"];
  }

  set(name: keyof T, value: T[keyof T]["value"]) {
    this.values[name].value = value;
  }
}
