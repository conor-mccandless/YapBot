export const STATIC_RESPONSES = [
  "The yap counter has reached critical mass.",
  "That was a whole lot of typing.",
  "The council has reviewed the message volume.",
  "A truly impressive commitment to the conversation.",
  "The keyboard has formally requested a break.",
] as const;

export function selectStaticResponse(random = Math.random): string {
  const index = Math.floor(random() * STATIC_RESPONSES.length);
  return (
    STATIC_RESPONSES[Math.min(index, STATIC_RESPONSES.length - 1)] ??
    "Yap detected."
  );
}
