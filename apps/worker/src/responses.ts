export const STATIC_RESPONSES = [
  "The yap counter just reached critical mass. Slow the posting down before the next batch achieves orbit.",
  "That was a whole lot of typing in a very small window. Bundle the next director's cut into one message.",
  "The council has reviewed your rapid-fire message volume. Consolidate the next bulletin before summoning us again.",
  "A truly impressive commitment to posting every thought separately. Let the channel breathe, then bring back the collected edition.",
  "Your keyboard just filed an overtime complaint. Slow down and combine the next few thoughts before its union rep arrives.",
] as const;

export function selectStaticResponse(random = Math.random): string {
  const index = Math.floor(random() * STATIC_RESPONSES.length);
  return (
    STATIC_RESPONSES[Math.min(index, STATIC_RESPONSES.length - 1)] ??
    "Yap detected at unsafe speeds. Ease off the send button and package the next thought together."
  );
}
