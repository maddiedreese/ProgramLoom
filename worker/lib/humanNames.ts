export function collapseRepeatedFullName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const words = normalized.split(" ");
  if (words.length >= 2 && words.length % 2 === 0) {
    const midpoint = words.length / 2;
    const firstHalf = words.slice(0, midpoint).join(" ");
    const secondHalf = words.slice(midpoint).join(" ");
    if (
      firstHalf.localeCompare(secondHalf, undefined, {
        sensitivity: "base",
      }) === 0
    )
      return firstHalf;
  }
  return normalized;
}

export function humanNameParts(value: string) {
  const normalized = collapseRepeatedFullName(value);
  const words = normalized.split(" ").filter(Boolean);
  return {
    firstName: words[0] || normalized,
    lastName: words.slice(1).join(" ") || "—",
  };
}

export function normalizeStoredNameParts(
  firstName: unknown,
  lastName: unknown,
) {
  const first = String(firstName ?? "").trim();
  const last = String(lastName ?? "").trim();
  if (
    first &&
    first.localeCompare(last, undefined, { sensitivity: "base" }) === 0
  )
    return humanNameParts(first);
  return { firstName: first, lastName: last };
}
