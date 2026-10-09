import { isMap, isNode, isScalar, isSeq, type Document } from "yaml";

export type Span = [start: number, end: number];

/**
 * Finds the source span for a validation path such as `["ecosystems", 0, "type"]`.
 *
 * A value in a map is reported together with its key (`type: yarn`), so the user sees which
 * field is wrong. If the path leads to something that isn't in the source, such as a missing
 * required field, the span is the first line of the closest node that does exist.
 */
export function locate(
  source: string,
  doc: Document,
  path: readonly PropertyKey[],
): Span | undefined {
  let node: unknown = doc.contents;
  let span = spanOf(node);

  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find((item) => isScalar(item.key) && item.key.value === segment);
      if (pair === undefined) return span && firstLineOf(source, span);
      const keySpan = spanOf(pair.key);
      span = keySpan && [keySpan[0], spanOf(pair.value)?.[1] ?? keySpan[1]];
      node = pair.value;
    } else if (isSeq(node) && typeof segment === "number" && isNode(node.items[segment])) {
      node = node.items[segment];
      span = spanOf(node);
    } else {
      return span && firstLineOf(source, span);
    }
  }
  return span;
}

function spanOf(node: unknown): Span | undefined {
  if (!isNode(node) || node.range == null) return undefined;
  return [node.range[0], node.range[1]];
}

function firstLineOf(source: string, [start, end]: Span): Span {
  const lineEnd = source.indexOf("\n", start);
  return [start, lineEnd === -1 ? end : Math.min(end, lineEnd)];
}
