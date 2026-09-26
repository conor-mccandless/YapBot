import type { DirectMessage, Participant } from "../src/direct-context.js";

export const freddy: Participant = {
  id: "fred-id",
  username: "fredrichnietze",
  displayName: "Freddy",
  bot: false,
};
export const steve: Participant = {
  id: "steve-id",
  username: "steve",
  displayName: "Steve",
  bot: false,
};
export const observer: Participant = {
  id: "observer",
  username: "observer",
  displayName: "Observer",
  bot: false,
};
export const bot: Participant = {
  id: "bot",
  username: "YapBot",
  displayName: "YapBot",
  bot: true,
};
export function msg(
  id: string,
  content: string,
  author = freddy,
  changes: Partial<DirectMessage> = {},
): DirectMessage {
  return {
    id,
    content,
    author,
    guildId: "g",
    channelId: "c",
    createdAtMs: 400_000,
    ignored: false,
    mentions: [],
    images: [],
    declaredImageCount: 0,
    ...changes,
  };
}
export const history = [
  msg("f", "Coffee is a meal."),
  msg("s", "It is a drink.", steve, { createdAtMs: 401_000 }),
];
export const request = (
  content: string,
  changes: Partial<DirectMessage> = {},
) => msg("r", content, observer, { createdAtMs: 402_000, ...changes });
